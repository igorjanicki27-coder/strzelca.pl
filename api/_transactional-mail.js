// =============================================================================
// Wewnętrzna wysyłka e-mail (SMTP) — używana z API serwera bez sesji admina
// =============================================================================

const nodemailer = require('nodemailer');

function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables || {})) {
    const safe = value == null ? '' : String(value);
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, safe);
  }
  return result;
}

function createTransporter() {
  const pass = process.env.SMTP_PASSWORD || '';
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'ssl0.ovh.net',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    connectionTimeout: 25_000,
    greetingTimeout: 20_000,
    socketTimeout: 25_000,
    auth: {
      user: process.env.SMTP_USER || 'kontakt@strzelca.pl',
      pass,
    },
  });
}

async function sendTransactionalEmail(opts) {
  const {
    to,
    subject,
    html,
    logCategory,
    logMeta,
    skipFailureLog,
    replyTo,
    fromDisplayName,
  } = opts || {};
  if (!to || !subject || !html) {
    throw new Error('sendTransactionalEmail: brak to, subject lub html');
  }
  if (!String(process.env.SMTP_PASSWORD || '').trim()) {
    throw new Error(
      'SMTP nie skonfigurowany: ustaw SMTP_PASSWORD (i ewent. SMTP_HOST/SMTP_USER) w zmiennych środowiska Vercel.',
    );
  }
  const transporter = createTransporter();
  const smtpUser = process.env.SMTP_USER || 'kontakt@strzelca.pl';
  const name = String(fromDisplayName || 'Strzelca.pl').replace(/"/g, "'");
  try {
    await transporter.sendMail({
      from: `"${name}" <${smtpUser}>`,
      to,
      replyTo: replyTo || undefined,
      subject,
      html,
    });
  } catch (err) {
    if (!skipFailureLog) {
      const { logEmailDeliveryFailure } = require('./_activity-email-log');
      await logEmailDeliveryFailure({
        category: logCategory || 'transactional_smtp',
        to,
        subject,
        errorMessage: err.message || String(err),
        meta: logMeta || {},
      });
    }
    throw err;
  }
}

module.exports = {
  replaceTemplateVariables,
  sendTransactionalEmail,
};
