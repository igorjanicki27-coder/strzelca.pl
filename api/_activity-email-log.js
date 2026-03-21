// =============================================================================
// Zapis niepowodzeń wysyłki e-mail do activityLogs (panel admina)
// =============================================================================

const { initAdmin, admin } = require('./_sso-utils');

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const u = email.slice(0, at);
  const d = email.slice(at + 1);
  if (u.length <= 2) return `**@${d}`;
  return `${u[0]}${'*'.repeat(Math.min(4, u.length - 1))}@${d}`;
}

/**
 * @param {object} opts
 * @param {string} opts.category - np. transactional_smtp, contact_form, admin_smtp, order_notification, newsletter_queue, bazar_template
 * @param {string} [opts.to] - odbiorca (zostanie zmaskowany)
 * @param {string} [opts.subject]
 * @param {string} opts.errorMessage
 * @param {Record<string,string>} [opts.meta]
 */
async function logEmailDeliveryFailure(opts) {
  const { category, to, subject, errorMessage, meta = {} } = opts || {};
  try {
    initAdmin();
    const db = admin.firestore();
    const safeMeta = {};
    for (const [k, v] of Object.entries(meta)) {
      if (v == null) continue;
      const s = typeof v === 'string' ? v : String(v);
      safeMeta[String(k).substring(0, 64)] = s.substring(0, 400);
    }
    await db.collection('activityLogs').add({
      userId: 'system',
      action: 'EMAIL_DELIVERY_FAILED',
      details: {
        category: String(category || 'unknown').substring(0, 80),
        toMasked: maskEmail(to),
        subject: String(subject || '').substring(0, 200),
        error: String(errorMessage || '').substring(0, 800),
        ...safeMeta,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: 'server/strzelca-api',
    });
  } catch (e) {
    console.error('[logEmailDeliveryFailure]', e?.message || e);
  }
}

module.exports = { logEmailDeliveryFailure, maskEmail };
