// =============================================================================
// API: PING ACTIVITY - strzelca.pl (Vercel Serverless)
// =============================================================================
// Endpoint do zapisywania "heartbeata" gości w kolekcji guestPresence (nie activityLogs).
// Dziennik aktywności (activityLogs) ma służyć audytowi — same wejścia na stronę go tam nie trafiają.
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
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

    let body = readJsonBody(req);
    
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

    const { visitorId, userAgent } = body;

    if (!visitorId) {
      res.status(400).json({ success: false, error: "Missing visitorId" });
      return;
    }

    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || req.headers['x-real-ip'] 
      || req.connection?.remoteAddress 
      || 'unknown';

    // Minimalny zapis obecności gościa (bez URL — nie trafia do dziennika zdarzeń)
    const presenceData = {
      visitorId,
      ipAddress: ipAddress,
      userAgent: userAgent || req.headers['user-agent'] || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("guestPresence").add(presenceData);

    res.status(200).json({ 
      success: true, 
      message: "Guest activity pinged",
      id: docRef.id
    });
  } catch (error) {
    console.error("[ping-activity] API error:", error);
    res.status(200).json({ 
      success: false, 
      error: "Could not ping activity",
      message: error.message 
    });
  }
};
