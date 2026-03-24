// Odszyfrowanie szczegółów logu USER_CREATED — wyłącznie dla administratora (token Firebase).
const { initAdmin, admin, setCors, readJsonBody } = require("./_sso-utils");
const { decryptActivityPayload } = require("./_activity-log-crypto");
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require("./_moderation");

const SUPERADMIN_UID = "nCMUz2fc8MM9WhhMVBLZ1pdR7O43";

async function isAdminOrSuperAdmin(uid) {
  if (!uid) return false;
  try {
    const profile = await getUserRoleProfile(admin.firestore(), uid);
    return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, "users");
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  setCors(req, res);
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
    const body = readJsonBody(req);
    const { idToken, logId } = body || {};
    if (!idToken || !logId) {
      res.status(400).json({ success: false, error: "Missing idToken or logId" });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!(await isAdminOrSuperAdmin(decoded.uid))) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const docRef = admin.firestore().collection("activityLogs").doc(String(logId));
    const snap = await docRef.get();
    if (!snap.exists) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }

    const data = snap.data();
    if (data.action !== "USER_CREATED") {
      res.status(400).json({ success: false, error: "Unsupported action" });
      return;
    }

    if (data.details && typeof data.details === "object") {
      res.status(200).json({ success: true, details: data.details, source: "plaintext" });
      return;
    }

    if (!data.detailsEncrypted) {
      res.status(200).json({ success: true, details: null });
      return;
    }

    const details = decryptActivityPayload(data.detailsEncrypted);
    if (!details) {
      res.status(500).json({
        success: false,
        error: "Nie udało się odszyfrować (sprawdź ACTIVITY_LOG_ENCRYPTION_KEY na serwerze).",
      });
      return;
    }

    res.status(200).json({ success: true, details, source: "encrypted" });
  } catch (e) {
    console.error("activity-log-decrypt-details:", e);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
