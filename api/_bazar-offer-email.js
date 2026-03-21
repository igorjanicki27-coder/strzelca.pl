// =============================================================================
// E-mail do sprzedawcy (szablony Firestore emailTemplates)
// =============================================================================

const { replaceTemplateVariables, sendTransactionalEmail } = require('./_transactional-mail');

function expiresAtToDate(exp) {
  if (exp == null) return null;
  if (typeof exp.toDate === 'function') return exp.toDate();
  if (typeof exp._seconds === 'number') return new Date(exp._seconds * 1000);
  if (typeof exp.seconds === 'number') return new Date(exp.seconds * 1000);
  return null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} templateId
 * @param {object} offerData — pola oferty z Firestore
 * @param {object} [extraVars] — rejectionReason, daysLeft
 */
async function sendBazarOfferTemplateEmail(db, templateId, offerData, extraVars = {}) {
  try {
    const sellerId = offerData.seller_id;
    if (!sellerId) return false;

    const profileDoc = await db.collection('userProfiles').doc(sellerId).get();
    const email = profileDoc.exists ? String(profileDoc.data().email || '').trim() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;

    const tdoc = await db.collection('emailTemplates').doc(templateId).get();
    if (!tdoc.exists) return false;
    const t = tdoc.data();

    const rawSlug = (offerData.slug || '').trim();
    const pathSeg = encodeURIComponent(rawSlug || offerData.id || '');
    const offerUrl = pathSeg
      ? `https://bazar.strzelca.pl/oferta/${pathSeg}`
      : 'https://bazar.strzelca.pl/';
    const bazarUrl = 'https://bazar.strzelca.pl/';

    const sellerName = String(offerData.seller_name || '').trim();
    const sellerGreeting = sellerName ? ` ${sellerName}` : '';

    const expD = expiresAtToDate(offerData.expires_at);
    const expiresAt = expD
      ? expD.toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })
      : '';

    const vars = {
      sellerGreeting,
      offerTitle: offerData.title || 'Oferta',
      offerUrl,
      bazarUrl,
      expiresAt,
      rejectionReason: String(
        extraVars.rejectionReason != null ? extraVars.rejectionReason : offerData.rejection_reason || '',
      ),
      daysLeft: extraVars.daysLeft != null ? String(extraVars.daysLeft) : '',
    };

    const subject = replaceTemplateVariables(t.subject || '', vars);
    const html = replaceTemplateVariables(t.html || '', vars);
    await sendTransactionalEmail({
      to: email,
      subject,
      html,
      logCategory: 'bazar_template',
      logMeta: { templateId: String(templateId) },
    });
    return true;
  } catch (e) {
    console.error('sendBazarOfferTemplateEmail', templateId, e?.message || e);
    return false;
  }
}

module.exports = { sendBazarOfferTemplateEmail, expiresAtToDate };
