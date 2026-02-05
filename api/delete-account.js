const { initAdmin, admin, setCors, readJsonBody } = require("./_sso-utils");

async function deleteDocsByQuery(db, colName, field, op, value, { batchSize = 200, maxDocs = 2000 } = {}) {
  let deleted = 0;
  while (deleted < maxDocs) {
    const snap = await db
      .collection(colName)
      .where(field, op, value)
      .limit(batchSize)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < batchSize) break;
  }
  return deleted;
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
  const idToken = (body.idToken || "").toString().trim();

  if (!idToken) {
    res.status(400).json({ success: false, error: "Missing idToken" });
    return;
  }

  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || null;

    const db = admin.firestore();

    // Fetch user profile to learn displayName (for displayNames doc id)
    let displayNameLower = null;
    try {
      const profileSnap = await db.collection("userProfiles").doc(uid).get();
      const profile = profileSnap.exists ? profileSnap.data() : null;
      if (profile?.displayName) {
        displayNameLower = String(profile.displayName).toLowerCase();
      }
    } catch (e) {
      // ignore
    }

    // Delete single-doc collections (best-effort)
    const singleDeletes = [];
    singleDeletes.push(db.collection("userProfiles").doc(uid).delete().catch(() => null));
    singleDeletes.push(db.collection("publicProfiles").doc(uid).delete().catch(() => null));
    singleDeletes.push(db.collection("conversations").doc(uid).delete().catch(() => null));
    if (email) singleDeletes.push(db.collection("mailingList").doc(email).delete().catch(() => null));
    if (displayNameLower) singleDeletes.push(db.collection("displayNames").doc(displayNameLower).delete().catch(() => null));
    await Promise.all(singleDeletes);

    // Delete related docs (best-effort)
    const counts = {};
    counts.activityLogs = await deleteDocsByQuery(db, "activityLogs", "userId", "==", uid).catch(() => 0);
    counts.trainingAccess = await deleteDocsByQuery(db, "trainingAccess", "userId", "==", uid).catch(() => 0);
    counts.messages = await deleteDocsByQuery(db, "messages", "senderId", "==", uid).catch(() => 0);
    counts.privateMessagesSent = await deleteDocsByQuery(db, "privateMessages", "senderId", "==", uid).catch(() => 0);
    counts.privateMessagesReceived = await deleteDocsByQuery(db, "privateMessages", "recipientId", "==", uid).catch(() => 0);
    counts.privateConversations = await deleteDocsByQuery(db, "privateConversations", "participants", "array-contains", uid).catch(() => 0);
    counts.userReviewsAsRater = await deleteDocsByQuery(db, "userReviews", "raterId", "==", uid).catch(() => 0);
    counts.userReviewsAsRated = await deleteDocsByQuery(db, "userReviews", "ratedId", "==", uid).catch(() => 0);
    if (email) {
      counts.contactFormsByEmail = await deleteDocsByQuery(db, "contactForms", "email", "==", email).catch(() => 0);
    }

    // Finally delete Firebase Auth user (server-side, no "recent login" requirement)
    await admin.auth().deleteUser(uid);

    res.status(200).json({ success: true, uid, deleted: counts });
  } catch (e) {
    console.error("delete-account error:", e);
    res.status(500).json({
      success: false,
      error: "Delete account failed",
      code: e?.code || e?.errorInfo?.code || null,
      message: (e?.message || "").slice(0, 200) || null,
    });
  }
};

