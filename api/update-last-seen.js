// =============================================================================
// API: UPDATE LAST SEEN - strzelca.pl (Vercel Serverless)
// =============================================================================
// Endpoint do aktualizacji lastSeen użytkownika w Firestore
// Używany przez activity-tracker.mjs przy zamykaniu strony (sendBeacon)
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

    // Weryfikacja sesji użytkownika
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionCookie = cookies[getCookieName()];
    
    if (!sessionCookie) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    let decoded;
    try {
      decoded = verifyLocalSessionJwt(sessionCookie);
    } catch (error) {
      res.status(401).json({ success: false, error: "Invalid session" });
      return;
    }

    const uid = decoded.uid;

    // Pobierz userId z body (sendBeacon wysyła JSON.stringify({ userId: ... }))
    // sendBeacon może nie ustawiać Content-Type, więc próbujemy różne sposoby parsowania
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
        // Ignoruj błędy parsowania - userId z body jest opcjonalny
      }
    }
    
    const userIdFromBody = body?.userId;

    // Weryfikacja: userId z body musi odpowiadać uid z sesji (zabezpieczenie)
    if (userIdFromBody && userIdFromBody !== uid) {
      res.status(403).json({ success: false, error: "Forbidden: userId mismatch" });
      return;
    }

    // Aktualizuj lastSeen w Firestore
    const db = admin.firestore();
    const userProfileRef = db.collection("userProfiles").doc(uid);
    
    await userProfileRef.update({
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ 
      success: true, 
      message: "Last seen updated",
      userId: uid
    });
  } catch (error) {
    console.error("update-last-seen API error:", error);
    // Dla sendBeacon ważne jest, aby nie zwracać błędów, które mogą być widoczne
    // w konsoli, więc zwracamy 200 nawet przy błędzie (best-effort)
    res.status(200).json({ 
      success: false, 
      error: "Could not update last seen",
      message: error.message 
    });
  }
};
