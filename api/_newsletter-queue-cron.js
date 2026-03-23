// =============================================================================
// Worker kolejki newslettera — wywoływany przez Vercel Cron (Authorization: Bearer)
// =============================================================================

const { initAdmin, admin, setCors } = require('./_sso-utils');
const { resolveExpectedCronSecret } = require('./_bazar-expire-cron');
const { sendTransactionalEmail } = require('./_transactional-mail');

const DEFAULT_BATCH = 15;
const DEFAULT_LEASE_MS = 4 * 60 * 1000;

function normalizeSubscriberEntry(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry === 'object' && entry.email) return String(entry.email).trim();
  return String(entry).trim();
}

function cronAuth(req, expected) {
  const h = req.headers || {};
  const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const got =
    String(h['x-newsletter-cron-secret'] || '').trim() ||
    String(h['x-bazar-cron-secret'] || '').trim() ||
    bearer;
  return got === expected;
}

async function handleNewsletterQueueCron(req, res) {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    initAdmin();
    const { expected, secretDiag } = await resolveExpectedCronSecret();
    if (!expected) {
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail:
          'Ustaw CRON_SECRET lub STRZELCA_BAZAR_EXPIRE_SECRET / BAZAR_CRON_SECRET w Vercel (jak przy cronie bazaru), albo pole cronSecret w Firestore: serverSecrets/bazarCronExpire.',
        diag: secretDiag,
      });
    }
    if (!cronAuth(req, expected)) {
      return res.status(401).json({
        success: false,
        error: 'Brak autoryzacji crona',
        hint: 'Authorization: Bearer <sekret> albo x-newsletter-cron-secret / x-bazar-cron-secret.',
      });
    }

    const db = admin.firestore();
    const nowMs = Date.now();
    const ts = admin.firestore.FieldValue.serverTimestamp();
    const leaseUntil = admin.firestore.Timestamp.fromMillis(nowMs + DEFAULT_LEASE_MS);
    const batchLimit = Math.max(
      1,
      Math.min(
        50,
        parseInt(process.env.NEWSLETTER_CRON_BATCH || String(DEFAULT_BATCH), 10) || DEFAULT_BATCH
      )
    );

    const pendingQ = await db
      .collection('newsletterQueue')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    let docRef;
    let claimMode;

    if (!pendingQ.empty) {
      docRef = pendingQ.docs[0].ref;
      claimMode = 'pending';
    } else {
      const procQ = await db
        .collection('newsletterQueue')
        .where('status', '==', 'processing')
        .orderBy('updatedAt', 'asc')
        .limit(1)
        .get();
      if (procQ.empty) {
        return res.status(200).json({
          success: true,
          message: 'Kolejka newslettera pusta',
          sentInRun: 0,
        });
      }
      docRef = procQ.docs[0].ref;
      claimMode = 'processing';
    }

    if (claimMode === 'pending') {
      const claimed = await db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        const data = snap.data() || {};
        if (data.status !== 'pending') return false;
        t.update(docRef, {
          status: 'processing',
          nextSubscriberIndex:
            typeof data.nextSubscriberIndex === 'number' ? data.nextSubscriberIndex : 0,
          sendLeaseUntil: leaseUntil,
          updatedAt: ts,
        });
        return true;
      });
      if (!claimed) {
        return res.status(200).json({
          success: true,
          message: 'Rekord został już przejęty przez inny worker.',
          skipped: true,
        });
      }
    } else {
      const leased = await db.runTransaction(async (t) => {
        const snap = await t.get(docRef);
        const data = snap.data() || {};
        if (data.status !== 'processing') return 'skip';
        const lease = data.sendLeaseUntil;
        if (lease && typeof lease.toMillis === 'function' && lease.toMillis() > nowMs) {
          return 'busy';
        }
        const subs = Array.isArray(data.subscribers) ? data.subscribers : [];
        const startIndex = typeof data.nextSubscriberIndex === 'number' ? data.nextSubscriberIndex : 0;
        const emails = subs.map(normalizeSubscriberEntry).filter((e) => e.includes('@'));
        if (!emails.length) {
          t.update(docRef, {
            status: 'failed',
            lastError: 'brak_poprawnych_emaili',
            sendLeaseUntil: admin.firestore.FieldValue.delete(),
            updatedAt: ts,
          });
          return 'nofail';
        }
        if (startIndex >= emails.length) {
          t.update(docRef, {
            status: 'completed',
            completedAt: ts,
            updatedAt: ts,
            sendLeaseUntil: admin.firestore.FieldValue.delete(),
          });
          return 'done';
        }
        t.update(docRef, { sendLeaseUntil: leaseUntil, updatedAt: ts });
        return 'ok';
      });
      if (leased === 'busy') {
        return res.status(200).json({
          success: true,
          message: 'Newsletter w trakcie wysyłki (aktywny lease) — pominięto.',
          skipped: true,
        });
      }
      if (leased === 'skip') {
        return res.status(200).json({
          success: true,
          message: 'Status dokumentu zmienił się — pominięto.',
          skipped: true,
        });
      }
      if (leased === 'nofail') {
        return res.status(200).json({
          success: false,
          error: 'Brak poprawnych adresów e-mail',
          jobId: docRef.id,
        });
      }
      if (leased === 'done') {
        return res.status(200).json({
          success: true,
          message: 'Newsletter już ukończony',
          completed: true,
          jobId: docRef.id,
        });
      }
    }

    const fresh = await docRef.get();
    const job = fresh.data() || {};
    const startIndex = typeof job.nextSubscriberIndex === 'number' ? job.nextSubscriberIndex : 0;
    const subs = Array.isArray(job.subscribers) ? job.subscribers : [];
    const emails = subs.map(normalizeSubscriberEntry).filter((e) => e.includes('@'));
    const subject = String(job.subject || '').trim() || 'Newsletter strzelca.pl';
    const html = String(job.content || '');
    const replyTo = String(job.senderEmail || '').trim() || undefined;
    const fromDisplayName = String(job.senderName || 'Strzelca.pl').trim();

    if (!emails.length) {
      await docRef.update({
        status: 'failed',
        lastError: 'brak_poprawnych_emaili',
        sendLeaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: ts,
      });
      return res.status(200).json({
        success: false,
        error: 'Brak poprawnych adresów e-mail',
        jobId: docRef.id,
      });
    }

    if (startIndex >= emails.length) {
      await docRef.update({
        status: 'completed',
        completedAt: ts,
        sendLeaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: ts,
      });
      return res.status(200).json({
        success: true,
        message: 'Newsletter już ukończony',
        completed: true,
        jobId: docRef.id,
      });
    }

    const endIndex = Math.min(startIndex + batchLimit, emails.length);
    let sentOk = 0;
    let sentFail = 0;
    /** Po błędzie SMTP nie przesuwaj kolejki — w poprzedniej logice cała partia była „zużywana” mimo 0 dostarczeń. */
    let nextSubscriberIndex = startIndex;
    let lastError = '';

    for (let i = startIndex; i < endIndex; i++) {
      const to = emails[i];
      try {
        await sendTransactionalEmail({
          to,
          subject,
          html,
          replyTo,
          fromDisplayName,
          logCategory: 'newsletter_queue',
          logMeta: { jobId: docRef.id, index: String(i) },
        });
        sentOk++;
        nextSubscriberIndex = i + 1;
      } catch (e) {
        sentFail++;
        lastError = String(e?.message || e || '').substring(0, 800);
        console.error('newsletter-queue-cron: send failed', {
          jobId: docRef.id,
          index: i,
          err: e?.message || String(e),
        });
        break;
      }
    }

    const done = nextSubscriberIndex >= emails.length;
    await docRef.update({
      nextSubscriberIndex,
      status: done ? 'completed' : 'processing',
      updatedAt: ts,
      sendLeaseUntil: admin.firestore.FieldValue.delete(),
      ...(done ? { completedAt: ts } : {}),
      lastBatchSentOk: sentOk,
      lastBatchSentFail: sentFail,
      ...(lastError
        ? {
            lastError,
            lastErrorAt: ts,
          }
        : {}),
    });

    return res.status(200).json({
      success: true,
      jobId: docRef.id,
      sentOk,
      sentFail,
      progressedTo: nextSubscriberIndex,
      total: emails.length,
      completed: done,
      ...(lastError ? { lastError } : {}),
    });
  } catch (e) {
    console.error('newsletter-queue-cron:', e);
    const msg = e?.message || String(e);
    if (!res.headersSent) {
      const hint = /index|FAILED_PRECONDITION|failed-precondition/i.test(msg)
        ? 'Wdróż indeksy Firestore dla kolekcji newsletterQueue (status+createdAt, status+updatedAt) — firebase deploy --only firestore:indexes'
        : undefined;
      return res.status(500).json({
        success: false,
        error: 'Błąd przetwarzania kolejki newslettera',
        detail: msg,
        hint,
      });
    }
  }
}

module.exports = { handleNewsletterQueueCron };
