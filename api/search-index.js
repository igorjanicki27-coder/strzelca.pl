const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');

const {
  SEARCH_TYPES,
  TYPE_USER,
  syncEntryFromSource,
  deleteIndexEntry,
  rebuildSearchIndex,
} = require('./_search-index');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function isAdminOrSuperAdmin(db, uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    const snap = await db.collection('userProfiles').doc(uid).get();
    if (!snap.exists) return false;
    return String(snap.data()?.role || '').toLowerCase() === 'admin';
  } catch {
    return false;
  }
}

function isSupportedType(type) {
  return SEARCH_TYPES.includes(type);
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'POST,OPTIONS' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    initAdmin();
    const db = admin.firestore();
    const sessionUser = await getSessionUser(req);

    if (!sessionUser?.uid) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const body = readJsonBody(req) || {};
    const action = String(body.action || '').trim().toLowerCase();

    if (!action) {
      res.status(400).json({ success: false, error: 'Missing action' });
      return;
    }

    const isAdmin = await isAdminOrSuperAdmin(db, sessionUser.uid);

    if (action === 'reindex') {
      if (!isAdmin) {
        res.status(403).json({ success: false, error: 'Forbidden - admin only' });
        return;
      }

      const requestedType = String(body.type || 'all').trim().toLowerCase();
      const type = requestedType === 'all' ? 'all' : requestedType;
      if (type !== 'all' && !isSupportedType(type)) {
        res.status(400).json({ success: false, error: 'Unsupported type for reindex' });
        return;
      }

      const dryRun = body.dryRun === true;
      const summary = await rebuildSearchIndex({ db, admin, type, dryRun });
      res.status(200).json({ success: true, data: { type, dryRun, summary } });
      return;
    }

    if (action === 'sync') {
      const type = String(body.type || '').trim().toLowerCase();
      const sourceId = String(body.sourceId || '').trim();
      if (!isSupportedType(type) || !sourceId) {
        res.status(400).json({ success: false, error: 'Missing or invalid type/sourceId' });
        return;
      }

      const isSelfUserSync = type === TYPE_USER && sourceId === sessionUser.uid;
      if (!isAdmin && !isSelfUserSync) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }

      let emailVerified = null;
      if (type === TYPE_USER) {
        try {
          const userRecord = await admin.auth().getUser(sourceId);
          emailVerified = userRecord.emailVerified === true;

          // Trzymaj userProfiles.emailVerified spójne z Firebase Auth,
          // żeby warunki "verified" były równoważne niezależnie od pola.
          await db.collection('userProfiles').doc(sourceId).set(
            {
              emailVerified,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } catch (_) {
          emailVerified = sessionUser.emailVerified === true;
        }
      }

      const result = await syncEntryFromSource({ db, admin, type, sourceId, emailVerified });
      res.status(200).json({ success: true, data: result });
      return;
    }

    if (action === 'delete') {
      const type = String(body.type || '').trim().toLowerCase();
      const sourceId = String(body.sourceId || '').trim();
      if (!isSupportedType(type) || !sourceId) {
        res.status(400).json({ success: false, error: 'Missing or invalid type/sourceId' });
        return;
      }

      const isSelfUserDelete = type === TYPE_USER && sourceId === sessionUser.uid;
      if (!isAdmin && !isSelfUserDelete) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }

      await deleteIndexEntry(db, type, sourceId);
      res.status(200).json({ success: true, data: { deleted: true } });
      return;
    }

    res.status(400).json({ success: false, error: 'Unsupported action' });
  } catch (error) {
    console.error('search-index API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
