const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');
const {
  getUserRoleProfile,
  isAdminRoleProfile,
} = require('./_moderation');
const {
  createAdminBroadcast,
  createInfoWindow,
  cleanString,
} = require('./_notifications');

async function requireAdmin(req, res) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser?.uid) {
    res.status(401).json({ success: false, error: 'Brak autoryzacji.' });
    return null;
  }

  const db = admin.firestore();
  const roleProfile = await getUserRoleProfile(db, sessionUser.uid);
  if (!isAdminRoleProfile(roleProfile)) {
    res.status(403).json({ success: false, error: 'Brak uprawnień administratora.' });
    return null;
  }

  const profileSnap = await db.collection('userProfiles').doc(sessionUser.uid).get();
  const profileData = profileSnap.exists ? profileSnap.data() || {} : {};

  return {
    uid: sessionUser.uid,
    displayName: cleanString(profileData.displayName || sessionUser.email || 'Administrator', 120) || 'Administrator',
  };
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const actor = await requireAdmin(req, res);
    if (!actor) return;

    const body = readJsonBody(req) || {};
    const kind = cleanString(body.kind, 40).toLowerCase();
    const db = admin.firestore();

    if (kind === 'notification') {
      const result = await createAdminBroadcast(db, actor, body);
      return res.status(200).json({
        success: true,
        kind,
        campaignId: result.id,
        deliveredCount: result.deliveredCount,
      });
    }

    if (kind === 'info') {
      const result = await createInfoWindow(db, actor, body);
      return res.status(200).json({
        success: true,
        kind,
        infoId: result.id,
        recipientCount: result.recipientCount,
      });
    }

    return res.status(400).json({ success: false, error: 'Nieznany typ komunikatu.' });
  } catch (error) {
    console.error('admin-notifications:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Błąd serwera',
    });
  }
};
