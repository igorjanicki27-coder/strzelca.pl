// Zapis zdarzenia USER_CREATED do activityLogs — szczegóły szyfrowane (AES-256-GCM), klucz w ACTIVITY_LOG_ENCRYPTION_KEY.
const { initAdmin, admin, setCors, readJsonBody } = require("./_sso-utils");
const { encryptActivityPayload, hasActivityLogEncryptionKey } = require("./_activity-log-crypto");

module.exports = async (req, res) => {
  setCors(req, res);
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
    const body = readJsonBody(req);
    if (!body || typeof body !== "object") {
      res.status(400).json({ success: false, error: "Invalid body" });
      return;
    }

    const { idToken, registrationSnapshot, userAgent } = body;
    if (!idToken || !registrationSnapshot || typeof registrationSnapshot !== "object") {
      res.status(400).json({ success: false, error: "Missing idToken or registrationSnapshot" });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    if (registrationSnapshot.uid !== uid) {
      res.status(403).json({ success: false, error: "UID mismatch" });
      return;
    }

    const snap = {
      uid,
      displayName: String(registrationSnapshot.displayName || "").slice(0, 120),
      email: String(registrationSnapshot.email || "").slice(0, 320),
      phone: String(registrationSnapshot.phone || "").slice(0, 80),
      firstName: String(registrationSnapshot.firstName || "").slice(0, 120),
      lastName: String(registrationSnapshot.lastName || "").slice(0, 120),
      gender: String(registrationSnapshot.gender || "").slice(0, 40),
      parcelLocker: String(registrationSnapshot.parcelLocker || "").slice(0, 200),
      address: {
        street: String(registrationSnapshot.address?.street || "").slice(0, 200),
        buildingNumber: String(registrationSnapshot.address?.buildingNumber || "").slice(0, 50),
        postalCode: String(registrationSnapshot.address?.postalCode || "").slice(0, 20),
        city: String(registrationSnapshot.address?.city || "").slice(0, 120),
      },
      ageConfirmed: !!registrationSnapshot.ageConfirmed,
      termsAccepted: !!registrationSnapshot.termsAccepted,
      privacyAccepted: !!registrationSnapshot.privacyAccepted,
      newsletter: !!registrationSnapshot.newsletter,
      createdAt:
        typeof registrationSnapshot.createdAt === "string"
          ? registrationSnapshot.createdAt.slice(0, 40)
          : null,
    };

    const db = admin.firestore();
    const doc = {
      userId: uid,
      action: "USER_CREATED",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (typeof userAgent === "string" && userAgent.length > 0) {
      doc.userAgent = userAgent.slice(0, 500);
    }

    if (hasActivityLogEncryptionKey()) {
      doc.detailsEncrypted = encryptActivityPayload(snap);
      doc.detailsEncryptedVersion = 1;
    } else {
      console.warn(
        "[log-user-created] Brak ACTIVITY_LOG_ENCRYPTION_KEY — zapisuję szczegóły jawne (nie na produkcję).",
      );
      doc.details = {
        email: snap.email,
        displayName: snap.displayName,
        phone: snap.phone,
        firstName: snap.firstName,
        lastName: snap.lastName,
        gender: snap.gender,
        parcelLocker: snap.parcelLocker,
        address: snap.address,
        ageConfirmed: snap.ageConfirmed,
        termsAccepted: snap.termsAccepted,
        privacyAccepted: snap.privacyAccepted,
        newsletter: snap.newsletter,
        createdAt: snap.createdAt,
      };
    }

    await db.collection("activityLogs").add(doc);
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("log-user-created:", e);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
