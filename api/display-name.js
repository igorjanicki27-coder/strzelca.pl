// =============================================================================
// API: CHECK DISPLAY NAME AVAILABILITY - strzelca.pl (Vercel Serverless)
// =============================================================================

const admin = require("firebase-admin");

// Lista zabronionych słów (nazwa zawierająca którekolwiek z tych słów jest zabroniona)
const forbiddenWords = [
  "admin",
  "administrator",
  "mod",
  "moderator",
  "moderacja",
  "moderowanie",
  "support",
  "pomoc",
  "help",
  "owner",
  "wlasciciel",
  "boss",
  "szef",
  "system",
  "bot",
  "robot",
  "strzelec",
  "strzelca",
  "platform",
  "site",
];

// Funkcja sprawdzająca czy nazwa zawiera zabronione słowa
function containsForbiddenWord(displayName) {
  const nameLower = displayName.toLowerCase();
  return forbiddenWords.some(word => nameLower.includes(word));
}

function initAdmin() {
  if (admin.apps.length) return;

  try {
    // Kod będzie szukał klucza najpierw w jednej, potem w drugiej zmiennej
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    }
    
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
      });
    } else {
      // Fallback (dev) - bez credentials Firestore odrzuci zapytania
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "strzelca-pl",
      });
    }
  } catch (e) {
    // Jeśli JSON jest uszkodzony lub brakuje zmiennych
    console.error("Error initializing Firebase Admin:", e);
    throw e;
  }
}

module.exports = async (req, res) => {
  // Enable CORS (spójnie z resztą API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const nameRaw = (req.query?.name || "").toString();
  const name = nameRaw.trim();

  if (!name) {
    res.status(400).json({ success: false, error: "Missing 'name' query param" });
    return;
  }

  // Sprawdź czy nazwa zawiera zabronione słowa
  if (containsForbiddenWord(name)) {
    res.json({ success: true, available: false, reason: "Ta nazwa jest zarezerwowana" });
    return;
  }

  // Normalizacja taka jak w kliencie (docId = lowercase)
  const docId = name.toLowerCase();

  try {
    initAdmin();
    const db = admin.firestore();

    const snap = await db.collection("displayNames").doc(docId).get();

    if (snap.exists) {
      res.json({ success: true, available: false, reason: "Ta nazwa jest już zajęta" });
      return;
    }

    res.json({ success: true, available: true });
  } catch (e) {
    console.error("display-name API error:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

