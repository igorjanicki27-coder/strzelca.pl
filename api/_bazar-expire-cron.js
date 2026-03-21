const { initAdmin, admin, setCors } = require('./_sso-utils');

/**
 * Wygaszanie ofert bazaru (ACTIVE → EXPIRED po expires_at).
 * Wywolywane z /api/bazar/cron/expire (Vercel Cron) lub z routera api/bazar.js.
 */
async function handleBazarExpireCron(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const expected = process.env.BAZAR_CRON_SECRET || process.env.CRON_SECRET || '';
    const got =
      req.headers['x-bazar-cron-secret'] ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!expected || got !== expected) {
      return res.status(401).json({ success: false, error: 'Brak autoryzacji crona' });
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const snap = await db
      .collection('bazarOffers')
      .where('status', '==', 'ACTIVE')
      .where('expires_at', '<=', now)
      .limit(300)
      .get();

    let expired = 0;
    const batch = db.batch();
    snap.forEach((d) => {
      batch.update(d.ref, { status: 'EXPIRED' });
      expired++;
    });
    if (expired) await batch.commit();
    return res.json({ success: true, expired });
  } catch (e) {
    console.error('Bazar expire cron:', e);
    return res.status(500).json({ success: false, error: 'Blad serwera' });
  }
}

module.exports = { handleBazarExpireCron };
