// =============================================================================
// Wewnętrzna wysyłka e-mail (SMTP) — używana z API serwera bez sesji admina
// =============================================================================

const nodemailer = require('nodemailer');

const SMTP_ENV = (() => {
  const j = (parts) => parts.join('_');
  return {
    host: j(['SMTP', 'HOST']),
    port: j(['SMTP', 'PORT']),
    secure: j(['SMTP', 'SECURE']),
    user: j(['SMTP', 'USER']),
    password: j(['SMTP', 'PASSWORD']),
  };
})();

function getSmtpEnvConfig() {
  const e = process.env;
  const hostRaw = e[SMTP_ENV.host];
  const portRaw = e[SMTP_ENV.port];
  const secureRaw = e[SMTP_ENV.secure];
  const userRaw = e[SMTP_ENV.user];
  const passRaw = e[SMTP_ENV.password];
  return {
    host: String(hostRaw || 'ssl0.ovh.net').trim(),
    port: parseInt(String(portRaw || '465'), 10) || 465,
    secure: String(secureRaw || '').trim().toLowerCase() === 'true' || String(portRaw || '').trim() === '465',
    user: String(userRaw || 'kontakt@strzelca.pl').trim(),
    password: String(passRaw || ''),
    diag: {
      smtpHostPresent: hostRaw !== undefined,
      smtpPortPresent: portRaw !== undefined,
      smtpSecurePresent: secureRaw !== undefined,
      smtpUserPresent: userRaw !== undefined,
      smtpPasswordPresent: passRaw !== undefined,
      smtpPasswordTrimmedLength: passRaw != null ? String(passRaw).trim().length : 0,
    },
  };
}

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
  const cfg = getSmtpEnvConfig();
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    connectionTimeout: 25_000,
    greetingTimeout: 20_000,
    socketTimeout: 25_000,
    auth: {
      user: cfg.user,
      pass: cfg.password,
    },
  });
}

function getSmtpConfigStatus() {
  const cfg = getSmtpEnvConfig();
  const pass = cfg.password;
  return {
    configured: Boolean(pass.trim()),
    host: cfg.host,
    user: cfg.user,
    passwordPresent: pass.trim().length > 0,
    diag: cfg.diag,
  };
}

function assertSmtpConfigured() {
  const status = getSmtpConfigStatus();
  if (!status.configured) {
    const err = new Error(
      'SMTP nie skonfigurowany: ustaw SMTP_PASSWORD (i ewent. SMTP_HOST/SMTP_USER) w zmiennych środowiska Vercel.',
    );
    err.code = 'SMTP_NOT_CONFIGURED';
    err.diag = status.diag || null;
    throw err;
  }
  return status;
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
  assertSmtpConfigured();
  const transporter = createTransporter();
  const smtpUser = getSmtpEnvConfig().user;
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
  getSmtpConfigStatus,
  assertSmtpConfigured,
};
