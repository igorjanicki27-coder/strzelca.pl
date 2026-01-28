const admin = require("firebase-admin");

let __ssoProjectInfo = null;

function initAdmin() {
  if (admin.apps.length) return;

  let serviceAccount = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  }

  if (serviceAccount) {
    __ssoProjectInfo = {
      configuredProjectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
      credentialProjectId: serviceAccount.project_id || null,
    };
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
    });
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    __ssoProjectInfo = {
      configuredProjectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
      credentialProjectId: null,
    };
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
    });
    return;
  }

  // Fallback (dev) - bez credentials verifyIdToken/verifySessionCookie nie zadziała
  __ssoProjectInfo = {
    configuredProjectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
    credentialProjectId: null,
  };
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
  });
}

function getAdminProjectInfo() {
  return __ssoProjectInfo;
}

function isAllowedOrigin(origin) {
  if (!origin) return false;

  // Produkcja: wszystkie subdomeny + root
  const re = /^https:\/\/([a-z0-9-]+\.)*strzelca\.pl$/i;
  if (re.test(origin)) return true;

  // Dev (opcjonalnie)
  if (process.env.ALLOW_LOCALHOST === "true") {
    const devRe = /^http:\/\/localhost:\d+$/i;
    if (devRe.test(origin)) return true;
  }

  return false;
}

function setCors(req, res, { methods = "GET,POST,OPTIONS" } = {}) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function readJsonBody(req) {
  // Vercel zwykle parsuje JSON do req.body, ale wspieramy też string
  if (!req.body) return null;
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function getCookieName() {
  return process.env.SSO_COOKIE_NAME || "__session";
}

function getCookieDomain() {
  return process.env.SSO_COOKIE_DOMAIN || ".strzelca.pl";
}

function getCookieMaxAgeSeconds() {
  const days = Number(process.env.SSO_COOKIE_DAYS || "14");
  if (!Number.isFinite(days) || days <= 0) return 14 * 24 * 60 * 60;
  return Math.floor(days * 24 * 60 * 60);
}

function setSessionCookie(res, value) {
  const name = getCookieName();
  const domain = getCookieDomain();
  const maxAge = getCookieMaxAgeSeconds();

  // Subdomeny (*.strzelca.pl) są "same-site", więc SameSite=Lax jest wystarczające
  // i mniej podatne na blokady third‑party cookies.
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; Domain=${domain}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  const name = getCookieName();
  const domain = getCookieDomain();
  res.setHeader(
    "Set-Cookie",
    `${name}=; Path=/; Domain=${domain}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
  );
}

module.exports = {
  admin,
  initAdmin,
  getAdminProjectInfo,
  setCors,
  readJsonBody,
  parseCookies,
  getCookieName,
  getCookieMaxAgeSeconds,
  setSessionCookie,
  clearSessionCookie,
};

