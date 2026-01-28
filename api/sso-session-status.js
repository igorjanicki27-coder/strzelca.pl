const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require("./_sso-utils");

module.exports = async (req, res) => {
  setCors(req, res, { methods: "GET, OPTIONS" });

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
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

    const decoded = verifyLocalSessionJwt(sessionCookie);
    res.status(200).json({
      success: true,
      authenticated: true,
      uid: decoded.uid,
      email: null,
      emailVerified: decoded.emailVerified === true,
    });
  } catch {
    res.status(200).json({ success: true, authenticated: false });
  }
};

