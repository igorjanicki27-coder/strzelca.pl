const { initAdmin, admin } = require('./_sso-utils');
const { sendTransactionalEmail } = require('./_transactional-mail');
const {
  BAZAR_PURCHASES,
  grantTokens,
} = require('./_bazar-commerce');
const {
  createBazarInvoiceDocument,
  buildBazarInvoicePdfBuffer,
} = require('./_bazar-sales-invoice');

function normalizeText(value, maxLen = 400) {
  return String(value || '').trim().slice(0, maxLen);
}

function formatCurrencyFromCents(cents) {
  const value = Math.max(0, Number(cents) || 0) / 100;
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildPurchaseThankYouHtml(purchase, invoiceId) {
  const packageLabel = normalizeText(purchase.packageLabel || `${purchase.tokens || 0} tokenow`, 120);
  const total = `${formatCurrencyFromCents(purchase.amountCents || 0)} zl`;
  const invoiceUrl = invoiceId
    ? `https://strzelca.pl/api/bazar-invoice-download?invoiceId=${encodeURIComponent(invoiceId)}`
    : '';
  return `<!doctype html>
<html lang="pl">
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #27272a;">
    <h2 style="color:#c19a6b;">Dziekujemy za zakup tokenow Bazaru</h2>
    <p>Zakup zostal poprawnie zaksiegowany.</p>
    <ul>
      <li><strong>Pakiet:</strong> ${packageLabel}</li>
      <li><strong>Liczba tokenow:</strong> ${purchase.tokens || 0}</li>
      <li><strong>Kwota:</strong> ${total}</li>
    </ul>
    <p>Tokeny sa juz dostepne na Twoim koncie i mozesz wykorzystac je do publikacji ogloszen oraz uslug premium Bazaru.</p>
    ${
      invoiceUrl
        ? `<p><a href="${invoiceUrl}" style="color:#c19a6b;">Pobierz dokument sprzedazy</a></p>`
        : ''
    }
    <p>Dokument zostal wystawiony jako <strong>faktura zwolniona z VAT</strong>.</p>
    <p>Pozdrawiamy,<br />Zespol STRZELCA.PL</p>
  </body>
</html>`;
}

async function processCompletedBazarPurchase({ db, purchaseId }) {
  const purchaseRef = db.collection(BAZAR_PURCHASES).doc(purchaseId);
  const purchaseSnap = await purchaseRef.get();
  if (!purchaseSnap.exists) {
    throw new Error('Zakup tokenow nie istnieje.');
  }
  const purchase = { id: purchaseSnap.id, ...(purchaseSnap.data() || {}) };
  if (purchase.status !== 'paid') {
    throw new Error('Zakup nie jest jeszcze oznaczony jako oplacony.');
  }
  if (purchase.processingStatus === 'completed') {
    return {
      purchase,
      invoiceId: normalizeText(purchase.invoiceId || '', 120),
      skipped: true,
    };
  }

  await purchaseRef.set(
    {
      processingStatus: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: '',
    },
    { merge: true },
  );

  let invoiceId = normalizeText(purchase.invoiceId || '', 120);
  let invoicePdfBuffer = null;
  let granted = false;

  try {
    if (!purchase.tokensGrantedAt) {
      await grantTokens(db, {
        userId: purchase.userId,
        tokens: purchase.tokens,
        packageId: purchase.packageId,
        packageLabel: purchase.packageLabel,
        purchaseId: purchase.id,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        createdBy: 'stripe_webhook',
        validityDays: purchase.roleSnapshot === 'company' ? 365 : 365,
        reasonKey: 'token_purchase',
        reasonLabel: 'Zakup tokenow Bazaru',
        note: `Stripe checkout: ${normalizeText(purchase.stripeSessionId || '', 120)}`,
      });
      granted = true;
      await purchaseRef.set(
        {
          tokensGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
          tokenGrantStatus: 'granted',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (!invoiceId) {
      const invoice = await createBazarInvoiceDocument(db, purchase, purchase.buyerSnapshot || {});
      invoiceId = invoice.id;
      invoicePdfBuffer = await buildBazarInvoicePdfBuffer(invoice);
      await purchaseRef.set(
        {
          invoiceId,
          invoiceNumber: normalizeText(invoice.invoiceNumber || '', 120),
          invoiceStatus: 'created',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      const invoiceSnap = await db.collection('adminInvoices').doc(invoiceId).get();
      if (invoiceSnap.exists) {
        invoicePdfBuffer = await buildBazarInvoicePdfBuffer({ id: invoiceSnap.id, ...(invoiceSnap.data() || {}) });
      }
    }

    if (!purchase.emailSentAt) {
      const buyerEmail = normalizeText(purchase.buyerSnapshot?.email || '', 180);
      if (buyerEmail) {
        await sendTransactionalEmail({
          to: buyerEmail,
          subject: `Tokeny Bazaru: ${normalizeText(purchase.packageLabel || '', 120)} - strzelca.pl`,
          html: buildPurchaseThankYouHtml(purchase, invoiceId),
          attachments:
            invoicePdfBuffer && invoiceId
              ? [
                  {
                    filename: `faktura-${normalizeText(purchase.invoiceNumber || invoiceId, 120)}.pdf`,
                    content: invoicePdfBuffer,
                    contentType: 'application/pdf',
                  },
                ]
              : [],
          logCategory: 'bazar_tokens_purchase',
          logMeta: {
            purchaseId: purchase.id,
            invoiceId,
          },
        });
        await purchaseRef.set(
          {
            emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            emailStatus: 'sent',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    await purchaseRef.set(
      {
        processingStatus: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      purchase: { ...purchase, invoiceId },
      invoiceId,
      granted,
      skipped: false,
    };
  } catch (error) {
    await purchaseRef.set(
      {
        processingStatus: 'error',
        lastError: normalizeText(error?.message || error, 1000),
        retryCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    throw error;
  }
}

module.exports = {
  processCompletedBazarPurchase,
};
