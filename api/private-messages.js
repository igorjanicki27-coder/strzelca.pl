// =============================================================================
// API: PRIVATE MESSAGES (user ↔ user) - Firestore (Vercel Serverless)
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

const SUPERADMIN_UID = "nCMUz2fc8MM9WhhMVBLZ1pdR7O43";

function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionCookie = cookies[getCookieName()];
    if (!sessionCookie) return null;
    const decoded = verifyLocalSessionJwt(sessionCookie);
    if (!decoded?.uid) return null;
    return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
  } catch {
    return null;
  }
}

async function isAdminOrSuperAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    initAdmin();
    const snap = await admin.firestore().collection("userProfiles").doc(uid).get();
    return snap.exists && snap.data()?.role === "admin";
  } catch {
    return false;
  }
}

async function getDisplayNameForUid(uid) {
  if (!uid) return null;
  try {
    initAdmin();
    const snap = await admin.firestore().collection("userProfiles").doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return typeof d.displayName === "string" ? d.displayName : null;
  } catch {
    return null;
  }
}

async function getPublicProfile(uid) {
  if (!uid) return { displayName: null, avatar: null };
  try {
    initAdmin();
    const snap = await admin.firestore().collection("publicProfiles").doc(uid).get();
    if (!snap.exists) return { displayName: null, avatar: null };
    const d = snap.data() || {};
    return {
      displayName: typeof d.displayName === "string" ? d.displayName : null,
      avatar: typeof d.avatar === "string" ? d.avatar : null,
    };
  } catch {
    return { displayName: null, avatar: null };
  }
}

function conversationIdFor(a, b) {
  const x = (a || "").toString();
  const y = (b || "").toString();
  return [x, y].sort().join("_");
}

function clampInt(n, min, max, fallback) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  return null;
}

async function listConversations(db, uid, { limit = 30 } = {}) {
  const snap = await db
    .collection("privateConversations")
    .where("participants", "array-contains", uid)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();

  const out = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const participants = Array.isArray(d.participants) ? d.participants : [];
    const peerId = participants.find((p) => p && p !== uid) || null;
    const unreadCounts = d.unreadCounts && typeof d.unreadCounts === "object" ? d.unreadCounts : {};
    const unreadCount = Number(unreadCounts[uid] || 0) || 0;

    out.push({
      id: doc.id,
      peerId,
      participants,
      lastMessage: d.lastMessage
        ? {
            content: (d.lastMessage.content || "").toString(),
            senderId: d.lastMessage.senderId || null,
            timestamp: toMillis(d.lastMessage.timestamp) || toMillis(d.updatedAt) || null,
          }
        : null,
      updatedAt: toMillis(d.updatedAt) || null,
      unreadCount,
      peerProfile: d.peerProfile && typeof d.peerProfile === "object" ? d.peerProfile : null,
    });
  }

  return out;
}

async function ensureConversationDoc(db, { conversationId, uidA, uidB, nameA, nameB, avatarA, avatarB }) {
  const ref = db.collection("privateConversations").doc(conversationId);
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set(
    {
      participants: [uidA, uidB],
      participantNames: { [uidA]: nameA || null, [uidB]: nameB || null },
      participantAvatars: { [uidA]: avatarA || null, [uidB]: avatarB || null },
      unreadCounts: { [uidA]: 0, [uidB]: 0 },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function sendPrivateMessage(db, { fromUid, toUid, content }) {
  const text = (content || "").toString().trim().slice(0, 4000);
  if (!text) return { ok: false, error: "Missing content" };
  if (!toUid || typeof toUid !== "string") return { ok: false, error: "Missing recipientId" };
  if (toUid === fromUid) return { ok: false, error: "Cannot message yourself" };

  const conversationId = conversationIdFor(fromUid, toUid);

  // best-effort profile (do wyświetlenia w liście)
  const [fromName, toPub] = await Promise.all([
    getDisplayNameForUid(fromUid),
    getPublicProfile(toUid),
  ]);

  await ensureConversationDoc(db, {
    conversationId,
    uidA: fromUid,
    uidB: toUid,
    nameA: fromName || null,
    nameB: toPub.displayName || null,
    avatarA: null,
    avatarB: toPub.avatar || null,
  });

  const msgRef = await db.collection("privateMessages").add({
    conversationId,
    content: text,
    senderId: fromUid,
    senderName: fromName || null,
    recipientId: toUid,
    recipientName: toPub.displayName || null,
    isRead: false,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  // transaction: lastMessage + unreadCounts
  const convRef = db.collection("privateConversations").doc(conversationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(convRef);
    const d = snap.exists ? snap.data() : {};
    const unread = (d?.unreadCounts && typeof d.unreadCounts === "object") ? d.unreadCounts : {};
    const currentUnread = Number(unread?.[toUid] || 0) || 0;

    tx.set(
      convRef,
      {
        participants: [fromUid, toUid].sort(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessage: {
          content: text,
          senderId: fromUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        },
        unreadCounts: {
          ...unread,
          [toUid]: currentUnread + 1,
        },
        // do listy po lewej: "peerProfile" dla aktualnego usera uzupełnimy w GET conversations
      },
      { merge: true }
    );
  });

  return { ok: true, id: msgRef.id, conversationId };
}

async function getThread(db, { uid, peerId, limit = 200 }) {
  const conversationId = conversationIdFor(uid, peerId);

  // prefer: po conversationId (nowy model)
  const snap = await db
    .collection("privateMessages")
    .where("conversationId", "==", conversationId)
    .orderBy("timestamp", "asc")
    .limit(limit)
    .get();

  const messages = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      conversationId: d.conversationId || conversationId,
      content: (d.content || "").toString(),
      senderId: d.senderId || null,
      recipientId: d.recipientId || null,
      isRead: d.isRead === true,
      timestamp: toMillis(d.timestamp) || Date.now(),
    };
  });

  return { conversationId, messages };
}

async function markConversationRead(db, { conversationId, uid }) {
  // 1) wyzeruj licznik
  await db.collection("privateConversations").doc(conversationId).set(
    {
      unreadCounts: { [uid]: 0 },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 2) oznacz wiadomości jako przeczytane (limitowane, best-effort)
  const snap = await db
    .collection("privateMessages")
    .where("conversationId", "==", conversationId)
    .where("recipientId", "==", uid)
    .where("isRead", "==", false)
    .limit(200)
    .get();

  if (snap.empty) return { updated: 0 };
  const batch = db.batch();
  for (const d of snap.docs) {
    batch.update(d.ref, { isRead: true });
  }
  await batch.commit();
  return { updated: snap.size };
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "GET, POST, PUT, OPTIONS" });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const sessionUser = getSessionUser(req);
  const uid = sessionUser?.uid || null;
  const requesterIsAdmin = await isAdminOrSuperAdmin(uid);

  if (!uid && !requesterIsAdmin) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }

  initAdmin();
  const db = admin.firestore();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = (() => {
    if (req.query && typeof req.query === "object") return req.query;
    const out = {};
    for (const [k, v] of url.searchParams.entries()) out[k] = v;
    return out;
  })();

  // Vercel rewrite: /api/private-messages/<path> -> /api/private-messages?__path=<path>
  const rawPath = (query?.__path ?? url.searchParams.get("__path") ?? "").toString().trim();
  let segs = [];
  if (rawPath) {
    segs = rawPath.split("/").filter(Boolean);
  } else {
    const pathname = url.pathname || "";
    segs = pathname.split("/").filter(Boolean);
    if (segs[0] === "api") segs = segs.slice(1);
    if (segs[0] === "private-messages") segs = segs.slice(1);
  }

  try {
    if (req.method === "GET" && segs.length === 1 && segs[0] === "conversations") {
      const limit = clampInt(query.limit, 1, 60, 30);
      const list = await listConversations(db, uid, { limit });

      // uzupełnij peerProfile (best-effort) jeśli brak
      const enriched = await Promise.all(
        list.map(async (c) => {
          if (!c.peerId) return c;
          const pp = await getPublicProfile(c.peerId);
          return {
            ...c,
            peerProfile: { uid: c.peerId, displayName: pp.displayName, avatar: pp.avatar },
          };
        })
      );

      res.status(200).json({ success: true, data: { conversations: enriched } });
      return;
    }

    if (req.method === "GET" && segs.length === 1 && segs[0] === "thread") {
      const peerId = (query.peerId || "").toString().trim();
      const limit = clampInt(query.limit, 1, 200, 200);
      if (!peerId) {
        res.status(400).json({ success: false, error: "Missing peerId" });
        return;
      }
      if (!requesterIsAdmin && peerId === uid) {
        res.status(400).json({ success: false, error: "Invalid peerId" });
        return;
      }
      const { conversationId, messages } = await getThread(db, { uid, peerId, limit });
      res.status(200).json({ success: true, data: { conversationId, peerId, messages } });
      return;
    }

    if (req.method === "POST" && segs.length === 0) {
      const body = readJsonBody(req) || {};
      const recipientId = (body.recipientId || body.to || "").toString().trim();
      const content = (body.content || "").toString();
      const r = await sendPrivateMessage(db, { fromUid: uid, toUid: recipientId, content });
      if (!r.ok) {
        res.status(400).json({ success: false, error: r.error });
        return;
      }
      res.status(200).json({ success: true, data: r });
      return;
    }

    if (req.method === "PUT" && segs.length === 3 && segs[0] === "conversation" && segs[2] === "read") {
      const conversationId = segs[1];
      // check ownership unless admin
      if (!requesterIsAdmin) {
        const snap = await db.collection("privateConversations").doc(conversationId).get();
        if (!snap.exists) {
          res.status(404).json({ success: false, error: "Conversation not found" });
          return;
        }
        const d = snap.data() || {};
        const participants = Array.isArray(d.participants) ? d.participants : [];
        if (!participants.includes(uid)) {
          res.status(403).json({ success: false, error: "Forbidden" });
          return;
        }
      }

      const r = await markConversationRead(db, { conversationId, uid });
      res.status(200).json({ success: true, data: r });
      return;
    }

    if (req.method === "PUT" && segs.length === 2 && segs[1] === "read") {
      // PUT /api/private-messages/:id/read (pojedyncza wiadomość)
      const messageId = segs[0];
      const ref = db.collection("privateMessages").doc(messageId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, error: "Message not found" });
        return;
      }
      const d = snap.data() || {};
      if (!requesterIsAdmin && d.recipientId !== uid) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      await ref.update({ isRead: true });
      res.status(200).json({ success: true });
      return;
    }

    if (req.method === "GET" && segs.length === 1 && segs[0] === "unread-count") {
      const snap = await db
        .collection("privateMessages")
        .where("recipientId", "==", uid)
        .where("isRead", "==", false)
        .count()
        .get();
      const count = snap.data().count || 0;
      res.status(200).json({ success: true, data: { unread: count } });
      return;
    }

    res.status(404).json({ success: false, error: "Endpoint not found" });
  } catch (e) {
    console.error("private-messages API error:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

