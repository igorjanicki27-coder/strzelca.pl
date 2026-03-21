const { initAdmin, admin, setCors } = require('./_sso-utils');
const { sendBazarOfferTemplateEmail } = require('./_bazar-offer-email');

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
 *
 * Sekret (kolejność): zmienne env (dynamiczny odczyt), potem Firestore
 * dokument serverSecrets/bazarCronExpire pole cronSecret (tylko Admin SDK).
 * Fallback Firestore jest na wypadek gdy Vercel nie wstrzykuje env do funkcji
 * (Custom Environment, polityka zespołu itd.) — FIREBASE_SERVICE_ACCOUNT_KEY i tak jest wymagane.
 */
const FIRESTORE_BAZAR_CRON_SECRET_PATH = 'serverSecrets/bazarCronExpire';

async function resolveExpectedCronSecret() {
  const { expected: fromEnv, diag } = resolveCronSecretFromEnv();
  if (fromEnv) {
    return {
      expected: fromEnv,
      secretDiag: { ...diag, cronSecretSource: 'env', cronEnvReadMode: 'dynamic' },
    };
  }

  const secretDiag = { ...diag, cronEnvReadMode: 'dynamic' };
  let expected = '';
  try {
    const snap = await admin.firestore().doc(FIRESTORE_BAZAR_CRON_SECRET_PATH).get();
    const fsSecret = snap.exists ? String(snap.data().cronSecret || '').trim() : '';
    secretDiag.firestoreCronSecretDoc = FIRESTORE_BAZAR_CRON_SECRET_PATH;
    secretDiag.firestoreCronSecretDocExists = snap.exists;
    secretDiag.firestoreCronSecretTrimmedLength = fsSecret.length;
    if (fsSecret) {
      expected = fsSecret;
      secretDiag.cronSecretSource = 'firestore';
    } else {
      secretDiag.cronSecretSource = 'none';
    }
  } catch (err) {
    console.error('[bazar-cron-expire] Odczyt sekretu z Firestore:', err?.message || err);
    secretDiag.firestoreCronSecretReadFailed = true;
    secretDiag.cronSecretSource = 'none';
  }

  return { expected, secretDiag };
}

async function handleBazarExpireCron(req, res) {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    initAdmin();
    const { expected, secretDiag } = await resolveExpectedCronSecret();
    const h = req.headers || {};
    const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    const got = String(h['x-bazar-cron-secret'] || '').trim() || bearer;

    if (!expected) {
      console.error('[bazar-cron-expire] Brak sekretu crona (env + Firestore)', secretDiag);
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail:
          'Brak sekretu: ani w process.env (STRZELCA_BAZAR_EXPIRE_SECRET / BAZAR_CRON_SECRET / CRON_SECRET), ani w Firestore w dokumencie serverSecrets/bazarCronExpire (pole cronSecret). Ustaw jedno z tych — Firestore działa przez Admin SDK i omija problemy Vercel env. Wdróż też reguły firestore.rules.',
        diag: secretDiag,
      });
    }
    if (got !== expected) {
      return res.status(401).json({
        success: false,
        error: 'Brak autoryzacji crona',
        hint:
          'Bearer / x-bazar-cron-secret musi być identyczny z sekretem z env albo z Firestore (serverSecrets/bazarCronExpire.cronSecret).',
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

    const snapActive = await db.collection('bazarOffers').where('status', '==', 'ACTIVE').limit(500).get();
    const warnHorizon = nowMs + 72 * 60 * 60 * 1000;
    const MAX_EXPIRY_WARNINGS_PER_RUN = 25;
    let warningsSent = 0;
    for (const d of snapActive.docs) {
      if (warningsSent >= MAX_EXPIRY_WARNINGS_PER_RUN) break;
      const row = d.data();
      const ms = expiresAtToMillis(row.expires_at);
      if (ms == null || ms <= nowMs || ms > warnHorizon) continue;
      if (row.expiry_warning_sent_at) continue;
      const daysLeft = Math.max(1, Math.ceil((ms - nowMs) / (24 * 60 * 60 * 1000)));
      const sent = await sendBazarOfferTemplateEmail(
        db,
        'bazar_offer_expiring_soon',
        { ...row, id: d.id },
        { daysLeft },
      );
      if (sent) {
        await d.ref.update({ expiry_warning_sent_at: admin.firestore.FieldValue.serverTimestamp() });
        warningsSent += 1;
      }
    }

    return res.status(200).json({
      success: true,
      expired,
      scanned: snap.size,
      warningsSent,
      scannedActive: snapActive.size,
    });
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
