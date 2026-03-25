// =============================================================================
// API: USER LOGIN METHOD - Sprawdza metodę logowania użytkownika
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
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
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

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

function getLoginMethodInfo(userRecord) {
  const providers = Array.from(
    new Set(
      (userRecord?.providerData || [])
        .map((provider) => String(provider?.providerId || "").trim())
        .filter(Boolean),
    ),
  );
  const hasGoogle = providers.includes("google.com");
  const hasPassword = providers.includes("password");

  if (hasGoogle && hasPassword) {
    return {
      loginMethod: "email_google",
      loginMethodLabel: "Łączone (mail+google)",
      providers,
    };
  }

  if (hasGoogle) {
    return {
      loginMethod: "google",
      loginMethodLabel: "Google",
      providers,
    };
  }

  return {
    loginMethod: "email",
    loginMethodLabel: "e-mail",
    providers: hasPassword ? providers : ["password", ...providers].filter(Boolean),
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

  const url = new URL(req.url, `http://${req.headers.host}`);
  const uid = url.searchParams.get("uid");

  if (!uid || typeof uid !== "string" || uid.length === 0) {
    res.status(400).json({ success: false, error: "Missing or invalid uid parameter" });
    return;
  }

  try {
    initAdmin();
    const userRecord = await admin.auth().getUser(uid);
    const loginMethodInfo = getLoginMethodInfo(userRecord);

    res.status(200).json({
      success: true,
      uid: userRecord.uid,
      ...loginMethodInfo,
    });
  } catch (error) {
    console.error("Error checking login method:", error);

    if (error.code === "auth/user-not-found") {
      res.status(404).json({ success: false, error: "User not found" });
      return;
    }

    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
