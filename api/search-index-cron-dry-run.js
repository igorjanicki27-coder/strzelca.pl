let handleSearchIndexDryRunCron;
let loadErr = null;
try {
  ({ handleSearchIndexDryRunCron } = require('./_search-index-cron'));
} catch (e) {
  loadErr = e;
  console.error('search-index-cron-dry-run: load error', e);
}

/** Vercel Cron: GET/POST /api/search-index-cron-dry-run */
module.exports = async (req, res) => {
  try {
    if (!handleSearchIndexDryRunCron) {
      return res.status(500).json({
        success: false,
        error: 'Modul crona search-index nie zaladowal sie',
        detail: loadErr?.message || String(loadErr) || 'require failed',
      });
    }
    return await handleSearchIndexDryRunCron(req, res);
  } catch (e) {
    console.error('search-index-cron-dry-run:', e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Nieobsluzony wyjatek',
        detail: e?.message || String(e),
      });
    }
  }
};

