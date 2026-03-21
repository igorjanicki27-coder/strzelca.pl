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
 * Wygaszanie: where status==ACTIVE oraz expires_at<=teraz (indeks złożony w firestore.indexes.json:
 * bazarOffers: status ASC, expires_at ASC). Ostrzeżenia 72h: ten sam indeks, zakres expires_at
 * (now, now+72h] — bez skanowania wszystkich ACTIVE.
 *
 * Sekret (kolejność): zmienne env (dynamiczny odczyt), potem Firestore
 * dokument serverSecrets/bazarCronExpire pole cronSecret (tylko Admin SDK).
 * Fallback Firestore jest na wypadek gdy Vercel nie wstrzykuje env do funkcji
 * (Custom Environment, polityka zespołu itd.) — FIREBASE_SERVICE_ACCOUNT_KEY i tak jest wymagane.
 */
const FIRESTORE_BAZAR_CRON_SECRET_PATH = 'serverSecrets/bazarCronExpire';

function envHasAdminCredentials() {
  const e = process.env;
  const kSa = ['FIREBASE', 'SERVICE', 'ACCOUNT', 'KEY'].join('_');
  const kGaj = ['GOOGLE', 'APPLICATION', 'CREDENTIALS', 'JSON'].join('_');
  const kGac = ['GOOGLE', 'APPLICATION', 'CREDENTIALS'].join('_');
  return {
    firebaseServiceAccountKeyPresent: e[kSa] !== undefined,
    googleApplicationCredentialsJsonPresent: e[kGaj] !== undefined,
    googleApplicationCredentialsPathPresent: e[kGac] !== undefined,
  };
}

async function resolveExpectedCronSecret() {
  const { expected: fromEnv, diag } = resolveCronSecretFromEnv();
  if (fromEnv) {
    return {
      expected: fromEnv,
      secretDiag: { ...diag, cronSecretSource: 'env', cronEnvReadMode: 'dynamic' },
    };
  }

  const credsDiag = envHasAdminCredentials();
  const secretDiag = { ...diag, cronEnvReadMode: 'dynamic', ...credsDiag };
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
    secretDiag.firestoreCronSecretErrorCode = err?.code || null;
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
      const hasCreds =
        secretDiag.firebaseServiceAccountKeyPresent ||
        secretDiag.googleApplicationCredentialsJsonPresent ||
        secretDiag.googleApplicationCredentialsPathPresent;
      let detail =
        'Brak sekretu crona: ustaw STRZELCA_BAZAR_EXPIRE_SECRET / BAZAR_CRON_SECRET / CRON_SECRET w Vercel (Production + Redeploy) albo pole cronSecret w Firestore: serverSecrets/bazarCronExpire.';
      if (secretDiag.firestoreCronSecretReadFailed) {
        detail =
          'Odczyt Firestore (fallback sekretu) się nie powiódł. Najczęściej na Vercel brakuje zmiennej FIREBASE_SERVICE_ACCOUNT_KEY (JSON konta serwisowego) dla Production — bez niej Admin SDK nie łączy się z Firestore; wtedy często padają też inne endpointy API i „strona nie działa”. Ustaw klucz w Vercel → Redeploy. Potem ustaw sekret crona (env lub dokument serverSecrets/bazarCronExpire).';
      } else if (!hasCreds) {
        detail +=
          ' W diag wszystkie trzy flagi *Credentials* są false — to zwykle oznacza, że Vercel nie wstrzykuje żadnych credentiali Firebase do tej funkcji (sprawdź Production i redeploy).';
      } else if (secretDiag.firestoreCronSecretDocExists === false) {
        detail +=
          ' Dokument serverSecrets/bazarCronExpire nie istnieje lub pole cronSecret jest puste — utwórz go w konsoli Firebase albo użyj zmiennych env.';
      }
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail,
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
    const nowTs = admin.firestore.Timestamp.fromMillis(nowMs);
    const warnHorizonMs = nowMs + 72 * 60 * 60 * 1000;
    const warnHorizonTs = admin.firestore.Timestamp.fromMillis(warnHorizonMs);

    const EXPIRE_PAGE = 400;
    let expired = 0;
    let scannedExpire = 0;
    let lastExpireSnap = null;

    for (;;) {
      let q = db
        .collection('bazarOffers')
        .where('status', '==', 'ACTIVE')
        .where('expires_at', '<=', nowTs)
        .orderBy('expires_at', 'asc')
        .limit(EXPIRE_PAGE);
      if (lastExpireSnap && lastExpireSnap.docs.length > 0) {
        q = q.startAfter(lastExpireSnap.docs[lastExpireSnap.docs.length - 1]);
      }
      const snap = await q.get();
      lastExpireSnap = snap;
      scannedExpire += snap.size;
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { status: 'EXPIRED' }));
      await batch.commit();
      expired += snap.size;

      if (snap.size < EXPIRE_PAGE) break;
    }

    if (expired > 0) {
      try {
        await db
          .collection('publicListCacheMeta')
          .doc('bazarOffers')
          .set(
            {
              v: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
      } catch (e) {
        console.warn('bump bazar list version after expire', e);
      }
    }

    const MAX_EXPIRY_WARNINGS_PER_RUN = 25;
    const WARN_CANDIDATE_LIMIT = 80;
    let warningsSent = 0;
    let scannedWarnings = 0;

    const snapWarn = await db
      .collection('bazarOffers')
      .where('status', '==', 'ACTIVE')
      .where('expires_at', '>', nowTs)
      .where('expires_at', '<=', warnHorizonTs)
      .orderBy('expires_at', 'asc')
      .limit(WARN_CANDIDATE_LIMIT)
      .get();

    scannedWarnings = snapWarn.size;

    for (const d of snapWarn.docs) {
      if (warningsSent >= MAX_EXPIRY_WARNINGS_PER_RUN) break;
      const row = d.data();
      if (row.expiry_warning_sent_at) continue;
      const ms = expiresAtToMillis(row.expires_at);
      if (ms == null || ms <= nowMs || ms > warnHorizonMs) continue;
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

    // scannedActive = odczyt z zapytania o oknie 72h (nie pełna lista ACTIVE)
    return res.status(200).json({
      success: true,
      expired,
      scanned: scannedExpire,
      warningsSent,
      scannedActive: scannedWarnings,
    });
  } catch (e) {
    console.error('Bazar expire cron:', e);
    const msg = e?.message || String(e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Blad serwera',
        detail: msg,
        hint: (() => {
          if (/credential|Could not load|default credentials/i.test(msg)) {
            return 'Ustaw FIREBASE_SERVICE_ACCOUNT_KEY (JSON) w Vercel Environment Variables';
          }
          if (/index|FAILED_PRECONDITION|failed-precondition/i.test(msg)) {
            return 'Wymagany indeks Firestore: bazarOffers (status ASC, expires_at ASC). Wdróż: firebase deploy --only firestore:indexes';
          }
          return undefined;
        })(),
      });
    }
  }
}

module.exports = { handleBazarExpireCron };
