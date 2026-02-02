const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require("./_sso-utils");

function pickProfile(data) {
  if (!data || typeof data !== "object") return { displayName: null, avatar: null };
  return {
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    avatar: typeof data.avatar === "string" ? data.avatar : null,
  };
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "GET, OPTIONS" });
  res.setHeader("Cache-Control", "no-store");

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
    const uid = decoded.uid;
    const emailVerified = decoded.emailVerified === true;

    let profile = { displayName: null, avatar: null };
    try {
      const db = admin.firestore();
      const snap = await db.collection("userProfiles").doc(uid).get();
      if (snap.exists) profile = pickProfile(snap.data());
    } catch {
      // best-effort: jeśli Firestore nie działa, nadal zwracamy sam fakt zalogowania
    }

    res.status(200).json({
      success: true,
      authenticated: true,
      uid,
      emailVerified,
      profile,
    });
  } catch {
    res.status(200).json({ success: true, authenticated: false });
  }
};

