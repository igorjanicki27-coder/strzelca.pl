let handleBazarExpireCron;
let loadErr = null;
try {
  ({ handleBazarExpireCron } = require('./_bazar-expire-cron'));
} catch (e) {
  loadErr = e;
  console.error('bazar-cron-expire: load error', e);
}

/** Vercel: /api/bazar-cron-expire */
module.exports = async (req, res) => {
  try {
    if (!handleBazarExpireCron) {
      return res.status(500).json({
        success: false,
        error: 'Modul crona nie zaladowal sie',
        detail: loadErr?.message || String(loadErr) || 'require failed',
      });
    }
    return await handleBazarExpireCron(req, res);
  } catch (e) {
    console.error('bazar-cron-expire:', e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Nieobsluzony wyjatek',
        detail: e?.message || String(e),
      });
    }
  }
};
