let handleNewsletterQueueCron;
let loadErr = null;
try {
  ({ handleNewsletterQueueCron } = require('./_newsletter-queue-cron'));
} catch (e) {
  loadErr = e;
  console.error('newsletter-cron-process: load error', e);
}

/** Vercel Cron: GET/POST /api/newsletter-cron-process */
module.exports = async (req, res) => {
  try {
    if (!handleNewsletterQueueCron) {
      return res.status(500).json({
        success: false,
        error: 'Moduł crona newslettera nie załadował się',
        detail: loadErr?.message || String(loadErr) || 'require failed',
      });
    }
    return await handleNewsletterQueueCron(req, res);
  } catch (e) {
    console.error('newsletter-cron-process:', e);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Nieobsłużony wyjątek',
        detail: e?.message || String(e),
      });
    }
  }
};
