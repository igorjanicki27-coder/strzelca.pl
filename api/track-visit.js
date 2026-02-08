// =============================================================================
// API: TRACK VISIT - strzelca.pl (Vercel Serverless)
// =============================================================================
// Endpoint do zapisywania odwiedzin w Firestore
// Działa dla zalogowanych i niezalogowanych użytkowników
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  readJsonBody,
} = require("./_sso-utils");

module.exports = async (req, res) => {
  setCors(req, res, { methods: "POST, OPTIONS" });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  try {
    initAdmin();
    const db = admin.firestore();

    // Pobierz dane z body
    let body = readJsonBody(req);
    
    // Jeśli readJsonBody zwróciło null, spróbuj sparsować req.body jako string
    if (!body && req.body) {
      try {
        if (typeof req.body === 'string') {
          body = JSON.parse(req.body);
        } else if (Buffer.isBuffer(req.body)) {
          body = JSON.parse(req.body.toString());
        }
      } catch (e) {
        res.status(400).json({ success: false, error: "Invalid request body" });
        return;
      }
    }

    if (!body) {
      res.status(400).json({ success: false, error: "Missing request body" });
      return;
    }

    const { userId, visitorId, pageUrl, pageTitle, referrer, userAgent, timestamp } = body;

    // Weryfikacja sesji użytkownika (jeśli jest zalogowany)
    let verifiedUserId = null;
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionCookie = cookies[getCookieName()];
    
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        verifiedUserId = decoded.uid;
        
        // Jeśli userId w body nie odpowiada sesji, użyj userId z sesji (zabezpieczenie)
        if (userId && userId !== verifiedUserId) {
          console.warn(`UserId mismatch: body=${userId}, session=${verifiedUserId}`);
        }
      } catch (error) {
        // Nie jest zalogowany - to OK, śledzimy jako niezalogowany
        verifiedUserId = null;
      }
    }

    // Użyj verifiedUserId jeśli jest dostępny, w przeciwnym razie użyj visitorId
    const finalUserId = verifiedUserId || null;
    // Dla zalogowanych użytkowników visitorId powinien być null
    // Dla niezalogowanych generujemy visitorId jeśli nie został podany
    const finalVisitorId = finalUserId ? null : (visitorId || `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

    // Pobierz IP użytkownika
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || req.headers['x-real-ip'] 
      || req.connection?.remoteAddress 
      || 'unknown';

    // Utwórz dokument odwiedzin
    const visitData = {
      userId: finalUserId, // null dla niezalogowanych
      visitorId: finalVisitorId,
      pageUrl: pageUrl || req.url,
      pageTitle: pageTitle || '',
      referrer: referrer || '',
      userAgent: userAgent || req.headers['user-agent'] || '',
      ipAddress: ipAddress,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      // Dodatkowe pole z timestamp z klienta (jako backup)
      clientTimestamp: timestamp ? admin.firestore.Timestamp.fromDate(new Date(timestamp)) : admin.firestore.FieldValue.serverTimestamp(),
      // Data jako string dla łatwiejszego query (format: YYYY-MM-DD)
      date: new Date().toISOString().split('T')[0],
      // Rok, miesiąc, dzień tygodnia dla łatwiejszego query
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1, // 1-12
      dayOfWeek: new Date().getDay(), // 0-6 (0 = niedziela)
    };

    // Zapisz odwiedzinę w Firestore
    await db.collection("visits").add(visitData);

    res.status(200).json({ 
      success: true, 
      message: "Visit tracked",
      userId: finalUserId,
      visitorId: finalVisitorId
    });
  } catch (error) {
    console.error("track-visit API error:", error);
    // Dla sendBeacon ważne jest, aby nie zwracać błędów, które mogą być widoczne
    // w konsoli, więc zwracamy 200 nawet przy błędzie (best-effort)
    res.status(200).json({ 
      success: false, 
      error: "Could not track visit",
      message: error.message 
    });
  }
};
