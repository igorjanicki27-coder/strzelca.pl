/**
 * Returns Firebase Web API key without hardcoding it in public HTML/JS.
 *
 * Required env var:
 * - FIREBASE_WEB_API_KEY
 *
 * Notes:
 * - This key is used by Firebase Web SDK in the browser (it is not a secret),
 *   but removing it from public source repos prevents automated leak scanners
 *   and allows quick rotation without touching many files.
 */
module.exports = (req, res) => {
  try {
    // --- CORS (allow strzelca.pl + any subdomain of strzelca.pl) ---
    const origin = req.headers?.origin;
    const allowed =
      origin === "https://strzelca.pl" ||
      (typeof origin === "string" && /^https:\/\/[a-z0-9-]+\.strzelca\.pl$/i.test(origin));

    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      // Preflight
      res.statusCode = 204;
      res.end();
      return;
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;

    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Missing env: FIREBASE_WEB_API_KEY" }));
      return;
    }

    // Avoid caching a credential-bearing response (even if it's "public", treat it carefully).
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ apiKey }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "firebase-config handler failed" }));
  }
};

