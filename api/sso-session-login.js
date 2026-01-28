const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  setSessionCookie,
  getCookieMaxAgeSeconds,
} = require("./_sso-utils");

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
      code: e?.code || null,
    });
  }
};

