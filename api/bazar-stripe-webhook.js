const {
  initAdmin,
  admin,
  setCors,
} = require('./_sso-utils');
const {
  createWebhookLog,
  getStripeClient,
  getStripeWebhookSecret,
  BAZAR_PURCHASES,
} = require('./_bazar-commerce');
const { processCompletedBazarPurchase } = require('./_bazar-purchase-processor');

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST,OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    const stripe = getStripeClient();
    const sig = req.headers['stripe-signature'] || req.headers['Stripe-Signature'] || '';
    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret) {
      return res.status(503).json({ success: false, error: 'Brak konfiguracji STRIPE_WEBHOOK_SECRET.' });
    }
    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    const payloadSummary = {
      objectId: event?.data?.object?.id || '',
      mode: event?.data?.object?.mode || '',
      paymentStatus: event?.data?.object?.payment_status || '',
    };
    await createWebhookLog(db, {
      eventId: event.id,
      type: event.type,
      status: 'received',
      payloadSummary,
    });

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object || {};
      const purchaseId = String(session.metadata?.purchaseId || '').trim();
      if (!purchaseId) {
        await createWebhookLog(db, {
          eventId: event.id,
          type: event.type,
          status: 'ignored',
          message: 'Brak purchaseId w metadata checkout session.',
          payloadSummary,
        });
        return res.status(200).json({ received: true, ignored: true });
      }
      const purchaseRef = db.collection(BAZAR_PURCHASES).doc(purchaseId);
      await purchaseRef.set(
        {
          status: 'paid',
          processingStatus: 'queued',
          stripeSessionId: session.id,
          stripePaymentIntentId: String(session.payment_intent || '').trim(),
          paymentStatus: String(session.payment_status || '').trim(),
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        const result = await processCompletedBazarPurchase({ db, purchaseId });
        await createWebhookLog(db, {
          eventId: event.id,
          type: event.type,
          purchaseId,
          status: 'processed',
          message: result.skipped ? 'Zakup byl juz przetworzony.' : 'Zakup tokenow zostal przetworzony.',
          payloadSummary,
        });
      } catch (processingError) {
        await createWebhookLog(db, {
          eventId: event.id,
          type: event.type,
          purchaseId,
          status: 'error',
          message: processingError?.message || String(processingError),
          payloadSummary,
        });
        throw processingError;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('bazar-stripe-webhook error:', error);
    return res.status(400).json({
      success: false,
      error: error?.message || 'Webhook verification failed',
    });
  }
};
