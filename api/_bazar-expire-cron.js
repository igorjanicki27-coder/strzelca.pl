const { initAdmin, admin, setCors } = require('./_sso-utils');

/**
 * Odczyt sekretów crona wyłącznie przez dynamiczny klucz (process.env[key] w pętli).
 * Bundler Vercel (@vercel/node / esbuild) potrafi w czasie buildu podstawić
 * process.env.CRON_SECRET wartością z etapu kompilacji (często pustą), przez co
 * w runtime zmienna z panelu Vercel „znika”. Dynamiczny dostęp tego unika.
 */
const CRON_SECRET_ENV = (() => {
  const j = (parts) => parts.join('_');
  return {
    entries: [
      { key: j(['STRZELCA', 'BAZAR', 'EXPIRE', 'SECRET']), diagPrefix: 'strzelcaBazarExpireSecret' },
      { key: j(['BAZAR', 'CRON', 'SECRET']), diagPrefix: 'bazarCronSecret' },
      { key: j(['CRON', 'SECRET']), diagPrefix: 'cronSecret' },
    ],
  };
})();

function resolveCronSecretFromEnv() {
  const e = process.env;
  let expected = '';
  const diag = {
    vercelEnv: e.VERCEL_ENV || null,
    vercelProjectId: e.VERCEL_PROJECT_ID || null,
    vercelProjectProductionUrl: e.VERCEL_PROJECT_PRODUCTION_URL || null,
  };
  for (const { key, diagPrefix } of CRON_SECRET_ENV.entries) {
    const raw = e[key];
    diag[`${diagPrefix}KeyPresent`] = raw !== undefined;
    diag[`${diagPrefix}TrimmedLength`] = raw != null ? String(raw).trim().length : 0;
    if (!expected && raw != null && String(raw).trim() !== '') {
      expected = String(raw).trim();
    }
  }
  return { expected, diag };
}

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
 * Sekret (pierwsza niepusta wartość): STRZELCA_BAZAR_EXPIRE_SECRET → BAZAR_CRON_SECRET → CRON_SECRET.
 * Unikalna nazwa STRZELCA_* pomaga uniknac pomyłki (inne projekty Vercel / zarezerwowane nazwy).
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
    const { expected, diag: secretDiag } = resolveCronSecretFromEnv();
    const h = req.headers || {};
    const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    const got = String(h['x-bazar-cron-secret'] || '').trim() || bearer;

    if (!expected) {
      console.error(
        '[bazar-cron-expire] Brak sekretu crona (dynamiczny odczyt STRZELCA_* / BAZAR_* / CRON_*)',
        secretDiag
      );
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail:
          'Brak niepustego sekretu w process.env (nazwy: STRZELCA_BAZAR_EXPIRE_SECRET, BAZAR_CRON_SECRET, CRON_SECRET). Sprawdź Production + Redeploy. Ta wersja API czyta zmienne dynamicznie (ominięcie podstawiania przy buildzie). Jeśli diag nadal pokazuje *_KeyPresent: false — zmienna nie jest wstrzykiwana do tego deploymentu (inny projekt / Custom Environment / zły zakres).',
        diag: { ...secretDiag, cronEnvReadMode: 'dynamic' },
      });
    }
    if (got !== expected) {
      return res.status(401).json({
        success: false,
        error: 'Brak autoryzacji crona',
        hint: 'Bearer / x-bazar-cron-secret musi być identyczny z aktywnym sekretem: STRZELCA_BAZAR_EXPIRE_SECRET (pierwszeństwo), potem BAZAR_CRON_SECRET, potem CRON_SECRET.',
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
