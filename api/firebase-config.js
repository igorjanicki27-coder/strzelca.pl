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
 * - Odpowiedź zawiera też authDomain (host strony strzelca.pl) pod redirect OAuth.
 * - Security: Endpoint checks both Origin (CORS) and Referer to ensure requests
 *   come from our domains. Direct browser access is blocked.
 */
module.exports = (req, res) => {
  try {
    // --- Security: Verify request comes from our domains ---
    const origin = req.headers?.origin;
    const referer = req.headers?.referer;
    const host = req.headers?.host;
    
    // Pattern dla dozwolonych domen (strzelca.pl i wszystkie subdomeny)
    const allowedDomainPattern = /^https?:\/\/([a-z0-9-]+\.)?strzelca\.pl$/i;
    
    // Sprawdź origin (dla CORS requests z JavaScript)
    const originAllowed = origin && allowedDomainPattern.test(origin);
    
    // Sprawdź referer (dla same-origin requests lub jako backup)
    // Referer może być null dla niektórych requestów (np. privacy settings)
    let refererAllowed = false;
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
    
    // Sprawdź host (dla same-origin requests bez origin/referer)
    let hostAllowed = false;
    if (host) {
      try {
        // Sprawdź czy host pasuje do dozwolonych domen
        hostAllowed = /^([a-z0-9-]+\.)?strzelca\.pl$/i.test(host);
      } catch (e) {
        hostAllowed = false;
      }
    }

    // Request jest dozwolony jeśli:
    // 1. Origin jest dozwolony (CORS request z dozwolonej domeny)
    // 2. LUB referer jest dozwolony (request z dozwolonej domeny)
    // 3. LUB host jest dozwolony (same-origin request)
    const requestAllowed = originAllowed || refererAllowed || hostAllowed;

    if (!requestAllowed) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ 
        error: "Forbidden",
        message: "This endpoint can only be accessed from authorized domains"
      }));
      return;
    }

    // Ustaw nagłówki CORS
    if (originAllowed) {
      // CORS request - zwróć origin w nagłówku
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else if (hostAllowed) {
      // Same-origin request - zwróć host w nagłówku (dla zgodności)
      res.setHeader("Access-Control-Allow-Origin", `https://${host}`);
    }
    
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

    /** Firebase redirect: authDomain = host strony (nie *.firebaseapp.com). Zob. firebase-config + vercel __/auth proxy. */
    let authDomain = "strzelca-pl.firebaseapp.com";
    if (originAllowed && origin) {
      try {
        const h = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
        if (h === "strzelca.pl" || h.endsWith(".strzelca.pl")) authDomain = h;
      } catch (_) {}
    } else if (refererAllowed && referer) {
      try {
        const h = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
        if (h === "strzelca.pl" || h.endsWith(".strzelca.pl")) authDomain = h;
      } catch (_) {}
    } else if (hostAllowed && host) {
      const h = String(host).split(":")[0].toLowerCase().replace(/^www\./, "");
      if (h === "strzelca.pl" || h.endsWith(".strzelca.pl")) authDomain = h;
    }

    // Avoid caching a credential-bearing response (even if it's "public", treat it carefully).
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ apiKey, authDomain }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "firebase-config handler failed" }));
  }
};

