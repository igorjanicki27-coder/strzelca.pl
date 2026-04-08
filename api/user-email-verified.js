// =============================================================================
// API: USER EMAIL VERIFIED - Sprawdza weryfikację emaila użytkownika
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  syncEmailVerifiedToProfileStores,
} = require("./_sso-utils");
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require("./_moderation");

function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionCookie = cookies[getCookieName()];
    if (!sessionCookie) return null;
    const decoded = verifyLocalSessionJwt(sessionCookie);
    if (!decoded?.uid) return null;
    return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
  } catch {
    return null;
  }
}

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function isAdminOrSuperAdmin(uid) {
  if (!uid) return false;
  try {
    initAdmin();
    const db = admin.firestore();
    const profile = await getUserRoleProfile(db, uid);
    return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, "users");
  } catch {
    return false;
  }
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

  // Sprawdź czy użytkownik jest zalogowany i jest administratorem
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.uid) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }

  const isAdmin = await isAdminOrSuperAdmin(sessionUser.uid);
  if (!isAdmin) {
    res.status(403).json({ success: false, error: "Forbidden - Admin access required" });
    return;
  }

  // Pobierz uid z parametrów zapytania
  const url = new URL(req.url, `http://${req.headers.host}`);
  const uid = url.searchParams.get("uid");

  if (!uid || typeof uid !== "string" || uid.length === 0) {
    res.status(400).json({ success: false, error: "Missing or invalid uid parameter" });
    return;
  }

  try {
    initAdmin();
    
    // Pobierz informację o weryfikacji emaila z Firebase Auth
    const userRecord = await admin.auth().getUser(uid);
    const emailVerified = userRecord.emailVerified === true;

    await syncEmailVerifiedToProfileStores(uid, emailVerified);

    res.status(200).json({
      success: true,
      emailVerified,
      uid: userRecord.uid,
    });
  } catch (error) {
    console.error("Error checking email verification:", error);
    
    // Jeśli użytkownik nie istnieje, zwróć błąd
    if (error.code === "auth/user-not-found") {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
