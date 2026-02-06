const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require("./_sso-utils");

const SUPERADMIN_UID = "nCMUz2fc8MM9WhhMVBLZ1pdR7O43";

function pickProfile(data) {
  if (!data || typeof data !== "object") return { displayName: null, avatar: null };
  return {
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    avatar: typeof data.avatar === "string" ? data.avatar : null,
    role: typeof data.role === "string" ? data.role : null,
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

    let profile = { displayName: null, avatar: null, role: null };
    try {
      const db = admin.firestore();
      const snap = await db.collection("userProfiles").doc(uid).get();
      if (snap.exists) profile = pickProfile(snap.data());
    } catch {
      // best-effort: jeśli Firestore nie działa, nadal zwracamy sam fakt zalogowania
    }

    const role = profile?.role || null;
    const isAdmin = uid === SUPERADMIN_UID || role === "admin";

    res.status(200).json({
      success: true,
      authenticated: true,
      uid,
      emailVerified,
      profile,
      role,
      isAdmin,
    });
  } catch {
    res.status(200).json({ success: true, authenticated: false });
  }
};

