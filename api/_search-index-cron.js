const { initAdmin, admin, setCors } = require('./_sso-utils');
const { rebuildSearchIndex } = require('./_search-index');
const { resolveExpectedCronSecret } = require('./_bazar-expire-cron');

function cronAuth(req, expected) {
  const h = req.headers || {};
  const bearer = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const got =
    String(h['x-search-index-cron-secret'] || '').trim() ||
    String(h['x-bazar-cron-secret'] || '').trim() ||
    bearer;
  return got === expected;
}

async function logSearchIndexCronResult(db, payload) {
  try {
    await db.collection('activityLogs').add({
      userId: 'system',
      action: 'SEARCH_INDEX_DRY_RUN',
      details: payload,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: 'server/search-index-cron',
    });
  } catch (e) {
    console.warn('logSearchIndexCronResult failed:', e?.message || e);
  }
}

async function handleSearchIndexDryRunCron(req, res) {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    initAdmin();
    const { expected, secretDiag } = await resolveExpectedCronSecret();
    if (!expected) {
      return res.status(503).json({
        success: false,
        error: 'Cron nie skonfigurowany',
        detail:
          'Ustaw CRON_SECRET lub STRZELCA_BAZAR_EXPIRE_SECRET / BAZAR_CRON_SECRET w Vercel, albo pole cronSecret w Firestore: serverSecrets/bazarCronExpire.',
        diag: secretDiag,
      });
    }
    if (!cronAuth(req, expected)) {
      return res.status(401).json({
        success: false,
        error: 'Brak autoryzacji crona',
        hint: 'Authorization: Bearer <sekret> albo x-search-index-cron-secret / x-bazar-cron-secret.',
      });
    }

    const db = admin.firestore();
    const startedAtMs = Date.now();
    const summary = await rebuildSearchIndex({ db, admin, type: 'all', dryRun: true });
    const durationMs = Date.now() - startedAtMs;

    const totals = (summary || []).reduce(
      (acc, row) => {
        acc.sourceTotal += Number(row?.sourceTotal || 0);
        acc.upserts += Number(row?.upserts || 0);
        acc.deletes += Number(row?.deletes || 0);
        acc.skipped += Number(row?.skipped || 0);
        return acc;
      },
      { sourceTotal: 0, upserts: 0, deletes: 0, skipped: 0 },
    );

    const logPayload = {
      status: 'ok',
      dryRun: true,
      durationMs,
      totals,
      summary: (summary || []).map((row) => ({
        type: row?.type || '',
        sourceTotal: Number(row?.sourceTotal || 0),
        upserts: Number(row?.upserts || 0),
        deletes: Number(row?.deletes || 0),
        skipped: Number(row?.skipped || 0),
      })),
    };
    await logSearchIndexCronResult(db, logPayload);

    return res.status(200).json({
      success: true,
      data: logPayload,
    });
  } catch (e) {
    console.error('search-index-cron-dry-run:', e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Blad serwera',
        detail: e?.message || String(e),
      });
    }
  }
}

module.exports = { handleSearchIndexDryRunCron };

