const { handleBazarExpireCron } = require('./_bazar-expire-cron');

/** Vercel: /api/bazar-cron-expire (plik musi byc plaski — nie api/bazar/cron/… obok api/bazar.js) */
module.exports = handleBazarExpireCron;
