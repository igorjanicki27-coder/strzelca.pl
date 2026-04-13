const FirestoreDatabaseManager = require('../firestore-db');
const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');
const {
  PROMO_CODES_COLLECTION,
  PROMO_CODE_USAGES_COLLECTION,
  evaluatePromoCodeForOrder,
  sanitizePromoCodeInput,
  serializePromoCodeForAdmin,
} = require('./_promo-codes');

let dbManager = null;
const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    initAdmin();
    const profileDoc = await admin.firestore().collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    return profileDoc.data()?.role === 'admin';
  } catch (error) {
    console.error('promo-codes isAdmin:', error);
    return false;
  }
}

async function requireAdmin(sessionUser, res) {
  if (!sessionUser) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  if (!(await isAdmin(sessionUser.uid))) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

function readBooleanQuery(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  return false;
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,POST,PUT,OPTIONS' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    initAdmin();
    await initDatabase();
    const sessionUser = await getSessionUser(req);
    const db = admin.firestore();

    if (req.method === 'POST') {
      const body = readJsonBody(req);
      if (!body) {
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
      }

      if (body.action === 'validate') {
        if (!sessionUser) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }

        const evaluation = await evaluatePromoCodeForOrder({
          db,
          rawCode: body.code,
          userId: sessionUser.uid,
          context: body.context,
          trainingId: body.trainingId,
          basePrice: body.basePrice,
        });

        res.status(200).json({
          success: true,
          data: evaluation.ok
            ? {
                ok: true,
                application: evaluation.application,
                discountAmount: evaluation.discountAmount,
                finalPrice: evaluation.finalPrice,
                customerMessage: evaluation.customerMessage,
                trainingTitle: String(evaluation.codeData?.targetTrainingTitle || '').trim(),
                discountType: String(evaluation.codeData?.discountType || '').trim(),
                discountValue: Number(evaluation.codeData?.discountValue || 0),
              }
            : evaluation,
        });
        return;
      }

      if (!(await requireAdmin(sessionUser, res))) return;

      const sanitized = sanitizePromoCodeInput(body);
      const duplicateCheck = await db
        .collection(PROMO_CODES_COLLECTION)
        .where('lookupHash', '==', sanitized.lookupHash)
        .limit(1)
        .get();
      if (!duplicateCheck.empty) {
        res.status(409).json({ success: false, error: 'Taki kod już istnieje.' });
        return;
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const docRef = db.collection(PROMO_CODES_COLLECTION).doc();
      await docRef.set({
        ...sanitized,
        redemptionCount: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: sessionUser.uid,
        updatedBy: sessionUser.uid,
      });

      const created = await docRef.get();
      res.status(201).json({
        success: true,
        data: serializePromoCodeForAdmin(created),
      });
      return;
    }

    if (req.method === 'GET') {
      if (!(await requireAdmin(sessionUser, res))) return;

      if (String(req.query?.view || '').trim() === 'usages') {
        const snapshot = await db
          .collection(PROMO_CODE_USAGES_COLLECTION)
          .orderBy('redeemedAt', 'desc')
          .limit(300)
          .get();
        const data = await Promise.all(snapshot.docs.map(async (docSnap) => {
          const row = docSnap.data() || {};
          const userId = String(row.userId || '').trim();
          let displayName = '';
          let email = '';
          if (userId) {
            try {
              const profileDoc = await db.collection('userProfiles').doc(userId).get();
              const profile = profileDoc.exists ? profileDoc.data() || {} : {};
              displayName = String(profile.displayName || '').trim();
              email = String(profile.email || '').trim();
            } catch (_) {}
          }
          return {
            id: docSnap.id,
            codeId: String(row.codeId || '').trim(),
            userId,
            displayName,
            email,
            orderId: String(row.orderId || '').trim(),
            orderNumber: String(row.orderNumber || '').trim(),
            context: String(row.context || '').trim(),
            itemTitle: String(row.itemTitle || '').trim(),
            purpose: String(row.purpose || '').trim(),
            redeemedAt: row.redeemedAt || null,
            maskedCode: String(row.maskedCode || '').trim(),
          };
        }));
        res.status(200).json({ success: true, data });
        return;
      }

      const includeExpired = readBooleanQuery(req.query?.includeExpired, false);
      const snapshot = await db
        .collection(PROMO_CODES_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();

      let rows = snapshot.docs.map((doc) => serializePromoCodeForAdmin(doc));
      if (!includeExpired) {
        rows = rows.filter((row) => row.isPerpetual === true || row.expired !== true);
      }

      res.status(200).json({ success: true, data: rows });
      return;
    }

    if (req.method === 'PUT') {
      if (!(await requireAdmin(sessionUser, res))) return;

      const body = readJsonBody(req);
      if (!body?.id) {
        res.status(400).json({ success: false, error: 'ID kodu jest wymagane.' });
        return;
      }

      const docRef = db.collection(PROMO_CODES_COLLECTION).doc(String(body.id).trim());
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, error: 'Kod nie istnieje.' });
        return;
      }

      const existing = snap.data() || {};
      const onlyToggle =
        Object.keys(body).every((key) => key === 'id' || key === 'isActive');

      let updatePayload;
      if (onlyToggle) {
        updatePayload = {
          isActive: body.isActive === true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: sessionUser.uid,
        };
      } else {
        const sanitized = sanitizePromoCodeInput(body, existing);
        const duplicateCheck = await db
          .collection(PROMO_CODES_COLLECTION)
          .where('lookupHash', '==', sanitized.lookupHash)
          .limit(5)
          .get();
        const collidingDoc = duplicateCheck.docs.find((doc) => doc.id !== docRef.id);
        if (collidingDoc) {
          res.status(409).json({ success: false, error: 'Taki kod już istnieje.' });
          return;
        }
        updatePayload = {
          ...sanitized,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: sessionUser.uid,
        };
      }

      await docRef.update(updatePayload);
      const updated = await docRef.get();
      res.status(200).json({
        success: true,
        data: serializePromoCodeForAdmin(updated),
      });
      return;
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('promo-codes error:', error);
    const message = String(error?.message || '');
    const missingSecrets =
      message.includes('PROMO_CODE_LOOKUP_SECRET') ||
      message.includes('PROMO_CODE_ENCRYPTION_KEY');
    res.status(500).json({
      success: false,
      error: missingSecrets
        ? 'Konfiguracja kodów promocyjnych nie jest jeszcze ustawiona na serwerze.'
        : error?.message || 'Internal server error',
    });
  }
};
