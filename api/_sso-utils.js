const admin = require("firebase-admin");
const crypto = require("crypto");

let __ssoProjectInfo = null;
let __saForSigning = null;
let __saPublicKeyPem = null;

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
    // Przygotuj klucz do lokalnego podpisywania cookie SSO (żeby nie zależeć od IAM/Google API)
    if (serviceAccount.private_key && serviceAccount.client_email) {
      __saForSigning = {
        project_id: serviceAccount.project_id || null,
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      };
      try {
        __saPublicKeyPem = crypto.createPublicKey(serviceAccount.private_key).export({
          type: "spki",
          format: "pem",
        });
      } catch {
        __saPublicKeyPem = null;
      }
    }
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

function getServiceAccountForSigning() {
  return __saForSigning;
}

function getServiceAccountPublicKeyPem() {
  return __saPublicKeyPem;
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecodeToBuffer(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function signLocalSessionJwt(payload) {
  if (!__saForSigning?.private_key) {
    throw new Error("Missing service account private_key for signing");
  }
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(__saForSigning.private_key);
  return `${data}.${base64urlEncode(sig)}`;
}

function verifyLocalSessionJwt(token) {
  if (!__saPublicKeyPem) throw new Error("Missing public key for verify");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const sig = base64urlDecodeToBuffer(s);

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(data);
  verifier.end();
  const ok = verifier.verify(__saPublicKeyPem, sig);
  if (!ok) throw new Error("Invalid signature");

  const payloadJson = base64urlDecodeToBuffer(p).toString("utf8");
  const payload = JSON.parse(payloadJson);
  if (payload?.exp && typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) throw new Error("Expired");
  }
  return payload;
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
  getServiceAccountForSigning,
  getServiceAccountPublicKeyPem,
  signLocalSessionJwt,
  verifyLocalSessionJwt,
  setCors,
  readJsonBody,
  parseCookies,
  getCookieName,
  getCookieMaxAgeSeconds,
  setSessionCookie,
  clearSessionCookie,
};

