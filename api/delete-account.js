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
    const deleteAllData = body.deleteAllData === true; // Jeśli true, usuwa konwersacje również u drugiej osoby

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
    
    // Usuwanie konwersacji - jeśli deleteAllData=true, usuwa również u drugiej osoby
    if (deleteAllData) {
      // Znajdź wszystkie konwersacje z tym użytkownikiem
      const convsSnap = await db.collection("privateConversations")
        .where("participants", "array-contains", uid)
        .get();
      
      let convCount = 0;
      let messageCount = 0;
      
      // Przetwarzaj konwersacje w partiach (Firestore batch limit = 500)
      for (const convDoc of convsSnap.docs) {
        const data = convDoc.data();
        const participants = Array.isArray(data.participants) ? data.participants : [];
        const otherParticipant = participants.find((p) => p && p !== uid);
        
        if (otherParticipant) {
          const conversationId = convDoc.id;
          
          // Usuń wszystkie wiadomości w tej konwersacji (w partiach)
          let hasMore = true;
          while (hasMore) {
            const messagesSnap = await db.collection("privateMessages")
              .where("conversationId", "==", conversationId)
              .limit(500)
              .get();
            
            if (messagesSnap.empty) {
              hasMore = false;
            } else {
              const batch = db.batch();
              messagesSnap.docs.forEach((doc) => {
                batch.delete(doc.ref);
                messageCount++;
              });
              await batch.commit().catch(() => {});
              
              if (messagesSnap.size < 500) {
                hasMore = false;
              }
            }
          }
          
          // Usuń konwersację
          await convDoc.ref.delete().catch(() => {});
          convCount++;
        }
      }
      
      counts.privateConversations = convCount;
      counts.privateMessagesInConvs = messageCount;
    } else {
      // Tylko usuń konwersacje dla tego użytkownika (soft delete przez deletedBy)
      const convsSnap = await db.collection("privateConversations")
        .where("participants", "array-contains", uid)
        .get();
      
      const batch = db.batch();
      let convCount = 0;
      convsSnap.docs.forEach((doc) => {
        batch.update(doc.ref, { deletedBy: { [uid]: true } });
        convCount++;
      });
      
      await batch.commit().catch(() => {});
      counts.privateConversations = convCount;
    }
    
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

