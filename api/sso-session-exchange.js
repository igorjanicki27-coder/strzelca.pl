const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
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

  try {
    initAdmin();

    const cookies = parseCookies(req.headers.cookie || "");
    const sessionCookie = cookies[getCookieName()];

    if (!sessionCookie) {
      res.status(200).json({ success: true, authenticated: false });
      return;
    }

    const decoded = await admin.auth().verifySessionCookie(sessionCookie, false);
    const customToken = await admin.auth().createCustomToken(decoded.uid);

    res.status(200).json({
      success: true,
      authenticated: true,
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: decoded.email_verified === true,
      customToken,
    });
  } catch (e) {
    console.warn("sso-session-exchange failed:", e?.message || e);
    // Best-effort: zwróć powód do debugowania (bez wycieku danych)
    res.status(200).json({
      success: true,
      authenticated: false,
      reason: e?.code || e?.message || "unknown",
    });
  }
};

