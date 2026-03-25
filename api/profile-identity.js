const { initAdmin, admin, setCors, readJsonBody } = require("./_sso-utils");

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

function containsForbiddenWord(displayName) {
  const nameLower = String(displayName || "").toLowerCase();
  return forbiddenWords.some((word) => nameLower.includes(word));
}

function sanitizeText(value, maxLen = 120) {
  return String(value || "").trim().slice(0, maxLen);
}

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

  const body = readJsonBody(req) || {};
  const idToken = String(body.idToken || "").trim();
  const displayName = sanitizeText(body.displayName, 32);
  const firstName = sanitizeText(body.firstName, 120);
  const lastName = sanitizeText(body.lastName, 120);
  const ageConfirmed = body.ageConfirmed === true;
  const termsAccepted = body.termsAccepted === true;
  const privacyAccepted = body.privacyAccepted === true;

  if (!idToken) {
    res.status(400).json({ success: false, error: "Missing idToken" });
    return;
  }

  if (displayName.length < 3 || displayName.length > 12) {
    res
      .status(400)
      .json({ success: false, error: "Display name must be 3-12 characters long" });
    return;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(displayName)) {
    res.status(400).json({
      success: false,
      error: "Display name may only contain letters, numbers, dots, underscores and hyphens",
    });
    return;
  }

  if (containsForbiddenWord(displayName)) {
    res.status(409).json({ success: false, error: "Display name is reserved" });
    return;
  }

  if (!firstName || !lastName) {
    res.status(400).json({ success: false, error: "Missing firstName or lastName" });
    return;
  }

  if (!ageConfirmed || !termsAccepted || !privacyAccepted) {
    res.status(400).json({ success: false, error: "Missing required consents" });
    return;
  }

  try {
    initAdmin();

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const db = admin.firestore();
    const batch = db.batch();

    const profileRef = db.collection("userProfiles").doc(uid);
    const publicProfileRef = db.collection("publicProfiles").doc(uid);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      res.status(404).json({ success: false, error: "Profile not found" });
      return;
    }

    const existingProfile = profileSnap.data() || {};
    const currentDisplayName = sanitizeText(existingProfile.displayName, 32);
    const currentDisplayNameLower = currentDisplayName.toLowerCase();
    const nextDisplayNameLower = displayName.toLowerCase();
    const nextDisplayNameRef = db.collection("displayNames").doc(nextDisplayNameLower);
    const nextDisplayNameSnap = await nextDisplayNameRef.get();

    if (
      nextDisplayNameSnap.exists &&
      String(nextDisplayNameSnap.data()?.userId || "") !== uid
    ) {
      res.status(409).json({ success: false, error: "Display name already taken" });
      return;
    }

    if (currentDisplayNameLower && currentDisplayNameLower !== nextDisplayNameLower) {
      batch.delete(db.collection("displayNames").doc(currentDisplayNameLower));
    }

    batch.set(
      nextDisplayNameRef,
      {
        displayName,
        userId: uid,
        createdAt:
          nextDisplayNameSnap.exists && nextDisplayNameSnap.data()?.createdAt
            ? nextDisplayNameSnap.data().createdAt
            : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      profileRef,
      {
        displayName,
        firstName,
        lastName,
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
        onboardingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      publicProfileRef,
      {
        displayName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        role: String(existingProfile.role || "user"),
        emailVerified:
          existingProfile.emailVerified === true || decoded.email_verified === true,
      },
      { merge: true },
    );

    await batch.commit();

    res.status(200).json({
      success: true,
      data: {
        uid,
        displayName,
        firstName,
        lastName,
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
      },
    });
  } catch (e) {
    console.error("profile-identity error:", e);
    res.status(500).json({
      success: false,
      error: "Profile identity update failed",
      code: e?.code || e?.errorInfo?.code || null,
      message: (e?.message || "").slice(0, 200) || null,
    });
  }
};
