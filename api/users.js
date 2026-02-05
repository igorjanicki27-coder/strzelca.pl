// =============================================================================
// API: USERS (search by displayName prefix) - Firestore (Vercel Serverless)
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require("./_sso-utils");

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

function clampInt(n, min, max, fallback) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
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
  const uid = sessionUser?.uid || null;
  if (!uid) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = ((req.query?.q ?? url.searchParams.get("q")) || "").toString().trim().toLowerCase();
  const limit = clampInt(req.query?.limit ?? url.searchParams.get("limit"), 1, 20, 10);

  // Prosty limit, żeby nie robić enumeracji
  if (q.length < 2) {
    res.status(200).json({ success: true, data: { users: [] } });
    return;
  }

  try {
    initAdmin();
    const db = admin.firestore();
    const { FieldPath } = admin.firestore;
    const end = `${q}\uf8ff`;

    const snap = await db
      .collection("displayNames")
      .where(FieldPath.documentId(), ">=", q)
      .where(FieldPath.documentId(), "<=", end)
      .limit(limit)
      .get();

    const hits = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((x) => x && typeof x.userId === "string" && x.userId.length > 8)
      .map((x) => ({
        uid: x.userId,
        displayName: typeof x.displayName === "string" ? x.displayName : null,
      }))
      // nie pokazuj siebie
      .filter((x) => x.uid !== uid);

    // dołącz avatar z publicProfiles (best-effort)
    const profSnaps = await Promise.all(
      hits.map((h) => db.collection("publicProfiles").doc(h.uid).get().catch(() => null))
    );
    const users = hits.map((h, i) => {
      const ps = profSnaps[i];
      const d = ps && ps.exists ? ps.data() : null;
      return {
        uid: h.uid,
        displayName: h.displayName || (typeof d?.displayName === "string" ? d.displayName : null) || null,
        avatar: typeof d?.avatar === "string" ? d.avatar : null,
      };
    });

    res.status(200).json({ success: true, data: { users } });
  } catch (e) {
    console.error("users search error:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

