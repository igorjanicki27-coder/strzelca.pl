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
 * - Security: Endpoint checks both Origin (CORS) and Referer to ensure requests
 *   come from our domains. Direct browser access is blocked.
 */
module.exports = (req, res) => {
  try {
    // --- Security: Verify request comes from our domains ---
    const origin = req.headers?.origin;
    const referer = req.headers?.referer;
    
    // Pattern dla dozwolonych domen (strzelca.pl i wszystkie subdomeny)
    const allowedDomainPattern = /^https:\/\/([a-z0-9-]+\.)?strzelca\.pl$/i;
    
    // Sprawdź origin (dla CORS requests z JavaScript)
    const originAllowed = origin && allowedDomainPattern.test(origin);
    
    // Sprawdź referer (dla same-origin requests lub jako backup)
    // Referer może być null dla niektórych requestów (np. privacy settings)
    let refererAllowed = true; // domyślnie dozwolone jeśli nie ma referer
    if (referer) {
      try {
        // Wyciągnij domenę z referer
        const refererUrl = new URL(referer);
        refererAllowed = allowedDomainPattern.test(refererUrl.origin);
      } catch (e) {
        // Jeśli referer nie jest poprawnym URL, zablokuj
        refererAllowed = false;
      }
    }

    // Blokuj tylko jeśli:
    // 1. Nie ma origin (nie jest to CORS request z JavaScript)
    // 2. I nie ma referer (lub referer jest niedozwolony)
    // To blokuje bezpośrednie wpisanie URL w przeglądarce, ale pozwala na requesty z JavaScript
    if (!origin && !refererAllowed) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ 
        error: "Forbidden",
        message: "This endpoint can only be accessed from authorized domains"
      }));
      return;
    }
    
    // Jeśli origin jest niedozwolony (ale istnieje), też blokuj
    if (origin && !originAllowed) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ 
        error: "Forbidden",
        message: "This endpoint can only be accessed from authorized domains"
      }));
      return;
    }

    // Ustaw nagłówki CORS tylko jeśli origin jest dozwolony
    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
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
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ apiKey }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "firebase-config handler failed" }));
  }
};

