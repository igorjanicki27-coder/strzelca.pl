const {
  initAdmin,
  admin,
  getAdminProjectInfo,
  setCors,
  readJsonBody,
  setSessionCookie,
  getCookieMaxAgeSeconds,
} = require("./_sso-utils");

function safeDecodeJwtDebug(idToken) {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const json = Buffer.from(payloadB64 + pad, "base64").toString("utf8");
    const payload = JSON.parse(json);
    // Zwracamy tylko bezpieczne pola diagnostyczne (bez uid/email)
    return {
      aud: payload.aud || null,
      iss: payload.iss || null,
      iat: payload.iat || null,
      exp: payload.exp || null,
    };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "POST, OPTIONS" });

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const body = readJsonBody(req) || {};
  const idToken = (body.idToken || "").toString().trim();

  if (!idToken) {
    res.status(400).json({ success: false, error: "Missing idToken" });
    return;
  }

  try {
    initAdmin();

    const decoded = await admin.auth().verifyIdToken(idToken);

    const expiresIn = getCookieMaxAgeSeconds() * 1000; // ms
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

    setSessionCookie(res, sessionCookie);

    res.status(200).json({
      success: true,
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: decoded.email_verified === true,
    });
  } catch (e) {
    console.error("sso-session-login error:", e);
    // Nie zwracaj 401, bo przeglądarka spamuje "Failed to load resource" w konsoli.
    // To odświeżanie cookie jest best-effort.
    res.status(200).json({
      success: false,
      error: "Invalid token",
      code: e?.code || e?.errorInfo?.code || null,
      message: (e?.message || "").slice(0, 200) || null,
      debug: safeDecodeJwtDebug(idToken),
      project: getAdminProjectInfo ? getAdminProjectInfo() : null,
    });
  }
};

