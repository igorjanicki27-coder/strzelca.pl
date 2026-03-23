// =============================================================================
// Wewnętrzna wysyłka e-mail (SMTP) — używana z API serwera bez sesji admina
// =============================================================================

const nodemailer = require('nodemailer');
const { initAdmin, admin } = require('./_sso-utils');

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

const FIRESTORE_SMTP_SECRET_PATH = 'serverSecrets/smtpTransport';
const SMTP_SECRET_CACHE_TTL_MS = 60 * 1000;
let smtpSecretCache = { at: 0, value: null };

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

function getRuntimeDiagBase() {
  const e = process.env || {};
  return {
    vercelEnv: e.VERCEL_ENV || null,
    vercelProjectId: e.VERCEL_PROJECT_ID || null,
    vercelProjectProductionUrl: e.VERCEL_PROJECT_PRODUCTION_URL || null,
  };
}

async function getSmtpFirestoreFallback() {
  const now = Date.now();
  if (smtpSecretCache.value && now - smtpSecretCache.at < SMTP_SECRET_CACHE_TTL_MS) {
    return smtpSecretCache.value;
  }
  try {
    initAdmin();
    const snap = await admin.firestore().doc(FIRESTORE_SMTP_SECRET_PATH).get();
    if (!snap.exists) {
      smtpSecretCache = { at: now, value: null };
      return null;
    }
    const d = snap.data() || {};
    const row = {
      host: d.host != null ? String(d.host).trim() : '',
      port: d.port != null ? parseInt(String(d.port), 10) : NaN,
      secure: d.secure === true || String(d.secure || '').trim().toLowerCase() === 'true',
      user: d.user != null ? String(d.user).trim() : '',
      password: d.password != null ? String(d.password) : '',
    };
    smtpSecretCache = { at: now, value: row };
    return row;
  } catch (e) {
    console.error('[smtp firestore fallback]', e?.message || e);
    smtpSecretCache = { at: now, value: null };
    return null;
  }
}

async function resolveSmtpConfig() {
  const env = getSmtpEnvConfig();
  if (env.password.trim()) {
    return {
      host: env.host,
      port: env.port,
      secure: env.secure,
      user: env.user,
      password: env.password,
      source: 'env',
      diag: {
        ...getRuntimeDiagBase(),
        ...env.diag,
        smtpConfigSource: 'env',
      },
    };
  }

  const fs = await getSmtpFirestoreFallback();
  if (fs && String(fs.password || '').trim()) {
    const host = fs.host || env.host;
    const port = Number.isFinite(fs.port) && fs.port > 0 ? fs.port : env.port;
    const secure = fs.secure === true || String(port) === '465';
    const user = fs.user || env.user;
    return {
      host,
      port,
      secure,
      user,
      password: fs.password,
      source: 'firestore',
      diag: {
        ...getRuntimeDiagBase(),
        ...env.diag,
        smtpConfigSource: 'firestore',
        firestorePath: FIRESTORE_SMTP_SECRET_PATH,
      },
    };
  }

  return {
    host: env.host,
    port: env.port,
    secure: env.secure,
    user: env.user,
    password: '',
    source: 'none',
    diag: {
      ...getRuntimeDiagBase(),
      ...env.diag,
      smtpConfigSource: 'none',
      firestorePath: FIRESTORE_SMTP_SECRET_PATH,
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

function createTransporter(cfg) {
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

async function assertSmtpConfigured() {
  const cfg = await resolveSmtpConfig();
  if (!String(cfg.password || '').trim()) {
    const err = new Error(
      'SMTP nie skonfigurowany: ustaw SMTP_PASSWORD (i ewent. SMTP_HOST/SMTP_USER) w zmiennych środowiska Vercel.',
    );
    err.code = 'SMTP_NOT_CONFIGURED';
    err.diag = cfg.diag || null;
    throw err;
  }
  return cfg;
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
  const smtpCfg = await assertSmtpConfigured();
  const transporter = createTransporter(smtpCfg);
  const smtpUser = smtpCfg.user;
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
