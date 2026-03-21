const { initAdmin, admin, setCors } = require('./_sso-utils');

function expiresAtToMillis(exp) {
  if (exp == null) return null;
  if (typeof exp.toMillis === 'function') return exp.toMillis();
  if (typeof exp._seconds === 'number') return exp._seconds * 1000;
  if (typeof exp.seconds === 'number') return exp.seconds * 1000;
  return null;
}

/**
 * Wygaszanie ofert bazaru (ACTIVE → EXPIRED po expires_at).
 * Produkcja Vercel: GET/POST /api/bazar-cron-expire (plik api/bazar-cron-expire.js).
 *
 * Zapytanie: tylko where('status','==','ACTIVE') — bez drugiego filtra w Firestore,
 * zeby nie wymagac indeksu zlozonego (unika 500 / FAILED_PRECONDITION na swiezym projekcie).
 * Filtrowanie expires_at odbywa sie w pamieci (do limitu odczytu).
 */
async function handleBazarExpireCron(req, res) {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    initAdmin();
    const expected = String(
      process.env.BAZAR_CRON_SECRET || process.env.CRON_SECRET || ''
    ).trim();
    const h = req.headers || {};
    const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    const got = String(h['x-bazar-cron-secret'] || '').trim() || bearer;

    if (!expected) {
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail:
          'Ustaw w Vercel (Production) zmienna BAZAR_CRON_SECRET lub CRON_SECRET — ta sama wartość co w Authorization: Bearer … przy ręcznym curl.',
      });
    }
    if (got !== expected) {
      return res.status(401).json({
        success: false,
        error: 'Brak autoryzacji crona',
        hint: 'Wartość Bearer musi być identyczna z BAZAR_CRON_SECRET lub CRON_SECRET (bez dodatkowych spacji na końcu wiersza w panelu Vercel).',
      });
    }

    const db = admin.firestore();
    const nowMs = Date.now();

    const snap = await db.collection('bazarOffers').where('status', '==', 'ACTIVE').limit(500).get();

    const refsToExpire = [];
    snap.forEach((d) => {
      const ms = expiresAtToMillis(d.data().expires_at);
      if (ms != null && ms <= nowMs) refsToExpire.push(d.ref);
    });

    const CHUNK = 400;
    let expired = 0;
    for (let i = 0; i < refsToExpire.length; i += CHUNK) {
      const slice = refsToExpire.slice(i, i + CHUNK);
      const batch = db.batch();
      slice.forEach((ref) => batch.update(ref, { status: 'EXPIRED' }));
      await batch.commit();
      expired += slice.length;
    }

    return res.status(200).json({ success: true, expired, scanned: snap.size });
  } catch (e) {
    console.error('Bazar expire cron:', e);
    const msg = e?.message || String(e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Blad serwera',
        detail: msg,
        hint:
          /credential|Could not load|default credentials/i.test(msg)
            ? 'Ustaw FIREBASE_SERVICE_ACCOUNT_KEY (JSON) w Vercel Environment Variables'
            : undefined,
      });
    }
  }
}

module.exports = { handleBazarExpireCron };
