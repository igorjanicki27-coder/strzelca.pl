// Realtime Messages Widget (Firestore) - Strzelca.pl
// - floating button (prawy dolny róg) widoczny po zalogowaniu
// - lista konwersacji po lewej, czat po prawej
// - realtime (onSnapshot), bez serverless API => brak 401/500 z /api/*

const PROFILE_URL = "https://konto.strzelca.pl/profil.html";
const SUPPORT_UID = "nCMUz2fc8MM9WhhMVBLZ1pdR7O43"; // pinned "Obsługa"

const STORAGE_KEY_OPEN = "__strzelca_messages_widget_open";
const STORAGE_KEY_SELECTED = "__strzelca_messages_widget_selected"; // json: { peerId }

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function firstLetter(name) {
  const s = (name || "").toString().trim();
  if (!s) return "U";
  return s[0].toUpperCase();
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

function getStoredOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

function setStoredOpen(v) {
  try {
    localStorage.setItem(STORAGE_KEY_OPEN, v ? "true" : "false");
  } catch {}
}

function getStoredSelectedPeerId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const peerId = j?.peerId;
    return typeof peerId === "string" && peerId.length > 8 ? peerId : null;
  } catch {
    return null;
  }
}

function setStoredSelectedPeerId(peerId) {
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify({ peerId }));
  } catch {}
}

function conversationIdFor(a, b) {
  return [String(a || ""), String(b || "")].sort().join("_");
}

async function getFirebaseApiKey() {
  const urls = ["/api/firebase-config", "https://strzelca.pl/api/firebase-config"];
  for (const url of urls) {
    try {
      // API key nie jest sekretem — nie wysyłamy cookies/credentials, żeby uniknąć CORS (ACACredentials).
      const res = await fetch(url, {
        cache: "no-store",
        credentials: url.startsWith("http") ? "omit" : "same-origin",
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.apiKey === "string" && data.apiKey.length > 10) return data.apiKey;
    } catch {
      // ignore
    }
  }
  throw new Error("Nie udało się pobrać firebase-config");
}

function makeStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: #e5e5e5;
    }
    .btn {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(10,10,10,0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
    }
    .btn:hover { border-color: rgba(193,154,107,0.8); }
    .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #c19a6b;
      color: #000;
      font-weight: 900;
      font-size: 12px;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      border: 2px solid rgba(0,0,0,0.8);
    }
    .panel {
      position: absolute;
      right: 0;
      bottom: 70px;
      width: min(92vw, 900px);
      height: min(80vh, 600px);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,10,0.82);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 20px 70px rgba(0,0,0,0.65);
      overflow: hidden;
      display: none;
    }
    .hdr {
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      gap: 10px;
    }
    .hdrTitle {
      font-weight: 900;
      letter-spacing: 0.01em;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .hdrTitleText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.12); }
    .hdrBtns { display: flex; gap: 10px; align-items: center; }
    .ghost {
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: #e5e5e5;
      border-radius: 10px;
      padding: 8px 10px;
      font-weight: 800;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .ghost:hover { border-color: rgba(193,154,107,0.7); }
    .grid { height: calc(100% - 52px); display: grid; grid-template-columns: 300px 1fr; }
    .left { border-right: 1px solid rgba(255,255,255,0.10); overflow: auto; }
    .leftTop { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .search {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.55);
      color: #fff;
      padding: 10px 12px;
      outline: none;
      font: inherit;
      font-size: 13px;
    }
    .search:focus { border-color: rgba(193,154,107,0.7); }
    .smallHint { margin-top: 8px; font-size: 11px; color: rgba(229,229,229,0.55); }
    .sectionLabel {
      padding: 10px 12px;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(229,229,229,0.55);
    }
    .conv {
      padding: 12px 12px;
      cursor: pointer;
      display: flex;
      gap: 10px;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .conv:hover { background: rgba(255,255,255,0.04); }
    .conv.active { background: rgba(193,154,107,0.10); }
    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      overflow: hidden;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .convText { min-width: 0; flex: 1 1 auto; }
    .convNameRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .convName { font-weight: 900; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .convBadge {
      flex: 0 0 auto;
      min-width: 18px;
      height: 18px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      font-size: 11px;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
    }
    .convSub { font-size: 12px; color: rgba(229,229,229,0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .right { display: grid; grid-template-rows: 1fr auto; min-width: 0; }
    .msgs { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .bubbleRow { display: flex; }
    .bubbleRow.me { justify-content: flex-end; }
    .bubble {
      max-width: min(640px, 74%);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      padding: 10px 12px;
      background: rgba(255,255,255,0.06);
      line-height: 1.35;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .bubble.me { background: rgba(193,154,107,0.18); border-color: rgba(193,154,107,0.28); }
    .meta { margin-top: 6px; font-size: 11px; color: rgba(229,229,229,0.55); text-align: right; }
    .composer { border-top: 1px solid rgba(255,255,255,0.10); padding: 10px; display: flex; gap: 10px; align-items: flex-end; }
    textarea {
      flex: 1 1 auto;
      min-height: 44px;
      max-height: 130px;
      resize: none;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.55);
      color: #fff;
      padding: 10px 12px;
      outline: none;
      font: inherit;
      font-size: 13px;
    }
    textarea:focus { border-color: rgba(193,154,107,0.7); }
    .send {
      flex: 0 0 auto;
      border-radius: 12px;
      border: 1px solid rgba(193,154,107,0.35);
      background: rgba(193,154,107,0.92);
      color: #111;
      font-weight: 900;
      cursor: pointer;
      padding: 10px 14px;
    }
    .send:disabled { opacity: 0.45; cursor: not-allowed; }
    .empty { color: rgba(229,229,229,0.70); font-size: 13px; padding: 18px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 260px 1fr; } }
    @media (max-width: 640px) {
      .panel { width: min(96vw, 900px); height: min(84vh, 600px); }
      .grid { grid-template-columns: 1fr; }
      .left { display: none; }
    }
  `;
  return style;
}

function svgChatIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.color = "#e5e5e5";
  const p1 = document.createElementNS(ns, "path");
  p1.setAttribute("d", "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z");
  const p2 = document.createElementNS(ns, "path");
  p2.setAttribute("d", "M8 10h.01M12 10h.01M16 10h.01");
  svg.appendChild(p1);
  svg.appendChild(p2);
  return svg;
}

function setBadgeEl(badgeEl, n) {
  const count = clamp(n, 0, 999);
  if (count <= 0) {
    badgeEl.style.display = "none";
    badgeEl.textContent = "";
    return;
  }
  badgeEl.style.display = "inline-flex";
  badgeEl.textContent = count > 99 ? "99+" : String(count);
}

function scrollToBottom(el) {
  try {
    el.scrollTop = el.scrollHeight;
  } catch {}
}

async function main() {
  if (!document?.body) return;

  // Wycisz znane "CORS/access control checks" z Firestore WebChannel/Listen,
  // które w praktyce często nie wpływają na działanie (a tylko spamują konsolę).
  // (Masz identyczną logikę w części stron.)
  try {
    if (!window.__strzelcaFirestoreNoiseGuard) {
      window.__strzelcaFirestoreNoiseGuard = true;
      window.addEventListener(
        "error",
        (e) => {
          const msg = (e?.message || "").toString();
          if (
            msg.includes("access control checks") ||
            msg.includes("CORS") ||
            msg.includes("firestore.googleapis.com")
          ) {
            e.preventDefault();
            return false;
          }
          return undefined;
        },
        true
      );
      window.addEventListener(
        "unhandledrejection",
        (e) => {
          const msg = (e?.reason?.message || "").toString();
          if (
            msg.includes("access control checks") ||
            msg.includes("CORS") ||
            msg.includes("firestore.googleapis.com")
          ) {
            e.preventDefault();
            return false;
          }
          return undefined;
        },
        true
      );
    }
  } catch {
    // ignore
  }

  // Firebase dynamic imports
  const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
  ]);

  const {
    getAuth,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
  } = authMod;

  const {
    initializeFirestore,
    getFirestore,
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    runTransaction,
    serverTimestamp,
    increment,
    writeBatch,
    getDocs,
    getDoc,
    setLogLevel,
    FieldPath,
  } = fsMod;

  const firebaseConfig = {
    apiKey: await getFirebaseApiKey(),
    authDomain: "strzelca-pl.firebaseapp.com",
    projectId: "strzelca-pl",
    storageBucket: "strzelca-pl.firebasestorage.app",
    messagingSenderId: "511362047688",
    appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
    measurementId: "G-9EJ2R3JPVD",
  };

  // Używamy nazwanej instancji aplikacji, żeby nie ryzykować kolizji z inicjalizacją na stronie.
  const APP_NAME = "__strzelca_messages_widget";
  const existingApp = getApps().find((a) => a.name === APP_NAME);
  const app = existingApp || initializeApp(firebaseConfig, APP_NAME);

  let db;
  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: true,
    });
  } catch {
    db = getFirestore(app);
  }

  // Wycisz logi Firestore (w tym szum WebChannel/Listen w konsoli).
  try {
    setLogLevel("silent");
  } catch {}
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  // ensure user (best-effort)
  const waitForAuth = () =>
    new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => {
        unsub();
        resolve(u || null);
      });
    });

  // Zawsze spróbuj SSO (cookie -> custom token) dla tej instancji auth.
  try {
    const { ensureFirebaseSSO } = await import("https://strzelca.pl/sso-client.mjs?v=2026-02-05-1");
    await ensureFirebaseSSO(auth);
  } catch {}

  let user = auth.currentUser || (await waitForAuth());
  if (!user) {
    user = auth.currentUser || (await waitForAuth());
  }
  if (!user) return;

  const uid = user.uid;

  // UI
  const host = document.createElement("div");
  host.id = "strzelca-messages-widget";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(makeStyles());

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Wiadomości");
  btn.appendChild(svgChatIcon());

  const badge = document.createElement("div");
  badge.className = "badge";
  btn.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Wiadomości");

  const hdr = document.createElement("div");
  hdr.className = "hdr";

  const hdrTitle = document.createElement("div");
  hdrTitle.className = "hdrTitle";
  const dot = document.createElement("span");
  dot.className = "dot";
  const titleText = document.createElement("span");
  titleText.className = "hdrTitleText";
  titleText.textContent = "Wiadomości";
  hdrTitle.appendChild(dot);
  hdrTitle.appendChild(titleText);

  const hdrBtns = document.createElement("div");
  hdrBtns.className = "hdrBtns";
  const profileBtn = document.createElement("a");
  profileBtn.className = "ghost";
  profileBtn.textContent = "Profil";
  profileBtn.href = PROFILE_URL;
  profileBtn.target = "_blank";
  profileBtn.rel = "noopener noreferrer";

  const closeBtn = document.createElement("button");
  closeBtn.className = "ghost";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Zamknij");
  closeBtn.style.fontSize = "18px";
  closeBtn.style.lineHeight = "1";
  hdrBtns.appendChild(profileBtn);
  hdrBtns.appendChild(closeBtn);

  hdr.appendChild(hdrTitle);
  hdr.appendChild(hdrBtns);

  const grid = document.createElement("div");
  grid.className = "grid";

  const left = document.createElement("div");
  left.className = "left";

  const leftTop = document.createElement("div");
  leftTop.className = "leftTop";
  const searchInput = document.createElement("input");
  searchInput.className = "search";
  searchInput.placeholder = "Szukaj (rozmowy + nick)…";
  const hint = document.createElement("div");
  hint.className = "smallHint";
  hint.textContent = "Filtruje na żywo: rozmowy, a niżej użytkownicy.";
  leftTop.appendChild(searchInput);
  leftTop.appendChild(hint);

  const convList = document.createElement("div");
  left.appendChild(leftTop);
  left.appendChild(convList);

  const right = document.createElement("div");
  right.className = "right";

  const msgs = document.createElement("div");
  msgs.className = "msgs";
  msgs.innerHTML = `<div class="empty">Wybierz rozmowę…</div>`;

  const composer = document.createElement("div");
  composer.className = "composer";
  const ta = document.createElement("textarea");
  ta.placeholder = "Napisz wiadomość…";
  ta.setAttribute("rows", "1");
  const sendBtn = document.createElement("button");
  sendBtn.className = "send";
  sendBtn.type = "button";
  sendBtn.textContent = "Wyślij";
  composer.appendChild(ta);
  composer.appendChild(sendBtn);

  right.appendChild(msgs);
  right.appendChild(composer);

  grid.appendChild(left);
  grid.appendChild(right);
  panel.appendChild(hdr);
  panel.appendChild(grid);

  wrap.appendChild(panel);
  wrap.appendChild(btn);
  shadow.appendChild(wrap);

  // State + subscriptions
  let isOpen = getStoredOpen();
  let convUnsub = null;
  let threadUnsub = null;
  let badgeTimer = null;

  let state = {
    conversations: [], // { id, peerId, peerName, peerAvatar, lastText, unread }
    searchUsers: [],
    q: "",
    selectedPeerId: getStoredSelectedPeerId() || SUPPORT_UID,
    selectedConversationId: null,
    unreadTotal: 0,
  };

  function renderAvatar(el, name, avatarUrl) {
    el.innerHTML = "";
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = "Avatar";
      el.appendChild(img);
      return;
    }
    el.textContent = firstLetter(name);
  }

  function renderConvItem({ key, active, name, sub, unread, avatar, letter, onClick }) {
    const conv = document.createElement("div");
    conv.className = `conv ${active ? "active" : ""}`;
    conv.dataset.key = key;

    const av = document.createElement("div");
    av.className = "avatar";
    renderAvatar(av, name || letter, avatar || null);

    const text = document.createElement("div");
    text.className = "convText";

    const nameRow = document.createElement("div");
    nameRow.className = "convNameRow";

    const nameEl = document.createElement("div");
    nameEl.className = "convName";
    nameEl.textContent = name;

    const badgeEl = document.createElement("div");
    badgeEl.className = "convBadge";
    setBadgeEl(badgeEl, unread || 0);

    nameRow.appendChild(nameEl);
    nameRow.appendChild(badgeEl);

    const subEl = document.createElement("div");
    subEl.className = "convSub";
    subEl.textContent = sub || "";

    text.appendChild(nameRow);
    text.appendChild(subEl);

    conv.appendChild(av);
    conv.appendChild(text);
    conv.addEventListener("click", onClick);
    return conv;
  }

  function filteredConversations() {
    const q = (state.q || "").toString().trim().toLowerCase();
    if (!q) return state.conversations;
    return state.conversations.filter((c) => {
      const n = (c.peerName || "").toLowerCase();
      const l = (c.lastText || "").toLowerCase();
      return n.includes(q) || l.includes(q);
    });
  }

  function renderList() {
    convList.innerHTML = "";
    const q = (state.q || "").toString().trim().toLowerCase();

    // pinned support always on top
    const supportName = "Obsługa Strzelca.pl";
    const supportUnread =
      state.conversations.find((c) => c.peerId === SUPPORT_UID)?.unread || 0;
    convList.appendChild(
      renderConvItem({
        key: "support",
        active: state.selectedPeerId === SUPPORT_UID,
        name: supportName,
        sub: "Pomoc / zgłoszenia",
        unread: supportUnread,
        avatar: null,
        letter: "S",
        onClick: () => selectPeer(SUPPORT_UID, supportName),
      })
    );

    const dm = filteredConversations().filter((c) => c.peerId !== SUPPORT_UID);
    for (const c of dm) {
      convList.appendChild(
        renderConvItem({
          key: `dm:${c.peerId}`,
          active: state.selectedPeerId === c.peerId,
          name: c.peerName || "Użytkownik",
          sub: c.lastText || "Brak wiadomości",
          unread: c.unread || 0,
          avatar: c.peerAvatar || null,
          letter: firstLetter(c.peerName || "U"),
          onClick: () => selectPeer(c.peerId, c.peerName || "Rozmowa"),
        })
      );
    }

    const shown = new Set(dm.map((x) => x.peerId));

    if (q.length >= 2) {
      const users = (state.searchUsers || []).filter((u) => u?.uid && !shown.has(u.uid) && u.uid !== uid);
      if (users.length) {
        const label = document.createElement("div");
        label.className = "sectionLabel";
        label.textContent = "Użytkownicy";
        convList.appendChild(label);
      }
      for (const u of users) {
        const name = u.displayName || "Użytkownik";
        convList.appendChild(
          renderConvItem({
            key: `u:${u.uid}`,
            active: state.selectedPeerId === u.uid,
            name,
            sub: "Kliknij, aby rozpocząć rozmowę",
            unread: 0,
            avatar: u.avatar || null,
            letter: firstLetter(name),
            onClick: () => selectPeer(u.uid, name),
          })
        );
      }
    }
  }

  function renderMessages(items) {
    msgs.innerHTML = "";
    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Brak wiadomości. Napisz pierwszą wiadomość.";
      msgs.appendChild(empty);
      return;
    }

    for (const m of items) {
      const isMe = m.senderId === uid;
      const row = document.createElement("div");
      row.className = `bubbleRow ${isMe ? "me" : ""}`;
      const b = document.createElement("div");
      b.className = `bubble ${isMe ? "me" : ""}`;
      b.textContent = (m.content || "").toString();
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatTime(m.timestampMs || Date.now());
      b.appendChild(meta);
      row.appendChild(b);
      msgs.appendChild(row);
    }
    queueMicrotask(() => scrollToBottom(msgs));
  }

  async function searchUsersByPrefix(prefix) {
    const qRaw = (prefix || "").toString().trim().toLowerCase();
    if (qRaw.length < 2) return [];
    const end = `${qRaw}\uf8ff`;

    const snap = await getDocs(
      query(
        collection(db, "displayNames"),
        where(FieldPath.documentId(), ">=", qRaw),
        where(FieldPath.documentId(), "<=", end),
        limit(10)
      )
    );

    const hits = snap.docs
      .map((d) => ({ ...(d.data() || {}), __id: d.id }))
      .filter((x) => x && typeof x.userId === "string")
      .map((x) => ({
        uid: x.userId,
        displayName: typeof x.displayName === "string" ? x.displayName : null,
      }))
      .filter((x) => x.uid !== uid);

    const profs = await Promise.all(
      hits.map((h) => getDoc(doc(db, "publicProfiles", h.uid)).catch(() => null))
    );

    return hits.map((h, i) => {
      const ps = profs[i];
      const d = ps && ps.exists() ? ps.data() : null;
      return {
        uid: h.uid,
        displayName: h.displayName || (typeof d?.displayName === "string" ? d.displayName : null),
        avatar: typeof d?.avatar === "string" ? d.avatar : null,
      };
    });
  }

  async function markConversationRead(conversationId) {
    try {
      const convRef = doc(db, "privateConversations", conversationId);
      // Zakładamy, że dokument konwersacji istnieje (ensureConversation robi to wcześniej),
      // więc nie musimy go czytać w transakcji (czytanie nieistniejącego doca powodowało permission-denied).
      await setDoc(convRef, { unreadCounts: { [uid]: 0 } }, { merge: true });

      // batch set isRead = true for up to 200
      const mSnap = await getDocs(
        query(
          collection(db, "privateMessages"),
          where("conversationId", "==", conversationId),
          where("recipientId", "==", uid),
          where("isRead", "==", false),
          limit(200)
        )
      );
      if (!mSnap.empty) {
        const batch = writeBatch(db);
        mSnap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
        await batch.commit();
      }
    } catch (e) {
      console.warn("markConversationRead failed:", e?.message || e);
    }
  }

  async function sendMessageTo(peerId, content) {
    const text = (content || "").toString().trim().slice(0, 4000);
    if (!text) return;
    if (!peerId || peerId === uid) return;

    const conversationId = conversationIdFor(uid, peerId);
    const convRef = doc(db, "privateConversations", conversationId);
    const msgRef = doc(collection(db, "privateMessages"));

    // best-effort names/avatars
    const [myPub, peerPub] = await Promise.all([
      getDoc(doc(db, "publicProfiles", uid)).catch(() => null),
      getDoc(doc(db, "publicProfiles", peerId)).catch(() => null),
    ]);
    const myDisplayName = myPub?.exists?.() ? myPub.data()?.displayName : null;
    const peerDisplayName = peerPub?.exists?.() ? peerPub.data()?.displayName : null;
    const peerAvatar = peerPub?.exists?.() ? peerPub.data()?.avatar : null;

    // Nie czytamy convRef w transakcji — przy braku dokumentu to potrafiło kończyć się permission-denied.
    // Zamiast tego: ensureConversation() tworzy dokument wcześniej, a tutaj tylko update (merge + increment).
    await runTransaction(db, async (tx) => {
      tx.set(
        convRef,
        {
          participants: [uid, peerId].sort(),
          participantNames: { [uid]: myDisplayName || null, [peerId]: peerDisplayName || null },
          participantAvatars: { [peerId]: peerAvatar || null },
          updatedAt: serverTimestamp(),
          lastMessage: { content: text, senderId: uid, timestamp: serverTimestamp() },
          unreadCounts: { [peerId]: increment(1) },
        },
        { merge: true }
      );

      tx.set(msgRef, {
        conversationId,
        content: text,
        senderId: uid,
        recipientId: peerId,
        isRead: false,
        timestamp: serverTimestamp(),
      });
    });
  }

  function subscribeConversations() {
    if (convUnsub) convUnsub();
    const q = query(
      collection(db, "privateConversations"),
      where("participants", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(40)
    );

    convUnsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        let totalUnread = 0;
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          const participants = Array.isArray(data.participants) ? data.participants : [];
          const peerId = participants.find((p) => p && p !== uid) || null;
          if (!peerId) return;
          const names = data.participantNames || {};
          const avatars = data.participantAvatars || {};
          const peerName =
            (peerId === SUPPORT_UID ? "Obsługa Strzelca.pl" : null) ||
            (typeof names?.[peerId] === "string" ? names[peerId] : null) ||
            "Użytkownik";
          const peerAvatar = typeof avatars?.[peerId] === "string" ? avatars[peerId] : null;
          const unread = Number((data.unreadCounts || {})[uid] || 0) || 0;
          totalUnread += unread;
          const lastText = data.lastMessage?.content ? String(data.lastMessage.content).slice(0, 70) : "";
          list.push({
            id: d.id,
            peerId,
            peerName,
            peerAvatar,
            lastText,
            unread,
          });
        });

        // ensure support exists even if no conversation doc yet
        if (!list.some((x) => x.peerId === SUPPORT_UID)) {
          list.unshift({
            id: conversationIdFor(uid, SUPPORT_UID),
            peerId: SUPPORT_UID,
            peerName: "Obsługa Strzelca.pl",
            peerAvatar: null,
            lastText: "Pomoc / zgłoszenia",
            unread: 0,
          });
        } else {
          // move support to top
          list.sort((a, b) => (a.peerId === SUPPORT_UID ? -1 : b.peerId === SUPPORT_UID ? 1 : 0));
        }

        state.conversations = list;
        state.unreadTotal = totalUnread;
        setBadgeEl(badge, totalUnread);
        renderList();
      },
      (err) => {
        console.warn("conversations snapshot error:", err?.message || err);
      }
    );
  }

  async function ensureConversation(peerId) {
    const conversationId = conversationIdFor(uid, peerId);
    const ref = doc(db, "privateConversations", conversationId);
    // Tworzymy dokument konwersacji bez czytania (żeby nie wpadać w permission-denied na nieistniejącym docu).
    await setDoc(
      ref,
      {
        participants: [uid, peerId].sort(),
        unreadCounts: { [uid]: 0, [peerId]: 0 },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return conversationId;
  }

  async function refreshUnreadBadgeOnce() {
    try {
      const snap = await getDocs(
        query(
          collection(db, "privateConversations"),
          where("participants", "array-contains", uid),
          orderBy("updatedAt", "desc"),
          limit(40)
        )
      );
      let totalUnread = 0;
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const unread = Number((data.unreadCounts || {})[uid] || 0) || 0;
        totalUnread += unread;
      });
      setBadgeEl(badge, totalUnread);
    } catch {
      // jeśli nie ma indeksu / permissions, nie spamuj konsoli
      setBadgeEl(badge, 0);
    }
  }

  function subscribeThread(peerId) {
    if (threadUnsub) threadUnsub();
    const conversationId = conversationIdFor(uid, peerId);
    state.selectedConversationId = conversationId;

    const q = query(
      collection(db, "privateMessages"),
      where("conversationId", "==", conversationId),
      orderBy("timestamp", "asc"),
      limit(200)
    );

    threadUnsub = onSnapshot(
      q,
      async (snap) => {
        const items = snap.docs.map((d) => {
          const data = d.data() || {};
          const ts = data.timestamp;
          const timestampMs =
            typeof ts?.toMillis === "function" ? ts.toMillis() : typeof ts === "number" ? ts : Date.now();
          return {
            id: d.id,
            content: data.content || "",
            senderId: data.senderId || null,
            recipientId: data.recipientId || null,
            isRead: data.isRead === true,
            timestampMs,
          };
        });

        renderMessages(items);

        // mark read best-effort when open and selected
        if (isOpen) {
          await markConversationRead(conversationId);
        }
      },
      (err) => {
        console.warn("thread snapshot error:", err?.message || err);
      }
    );
  }

  function selectPeer(peerId, labelName) {
    state.selectedPeerId = peerId;
    setStoredSelectedPeerId(peerId);
    titleText.textContent = labelName || "Wiadomości";
    renderList();
    msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;
    // Upewnij się, że dokument konwersacji istnieje zanim zaczniemy listen / markRead
    ensureConversation(peerId)
      .catch(() => {})
      .finally(() => subscribeThread(peerId));
  }

  // Search: live filter + users below
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    state.q = searchInput.value || "";
    renderList();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        state.searchUsers = await searchUsersByPrefix(state.q);
      } catch (e) {
        state.searchUsers = [];
      }
      renderList();
    }, 250);
  });

  async function doSend() {
    const content = (ta.value || "").toString().trim();
    if (!content) return;
    sendBtn.disabled = true;
    try {
      await ensureConversation(state.selectedPeerId).catch(() => {});
      await sendMessageTo(state.selectedPeerId, content);
      ta.value = "";
      ta.focus();
    } catch (e) {
      console.warn("send failed:", e?.message || e);
    } finally {
      sendBtn.disabled = false;
    }
  }

  btn.addEventListener("click", () => {
    if (isOpen) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  sendBtn.addEventListener("click", doSend);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closePanel();
  });
  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(host)) return;
    closePanel();
  });

  function openPanel() {
    isOpen = true;
    setStoredOpen(true);
    panel.style.display = "block";
    // realtime uruchamiamy dopiero po otwarciu okna (żeby nie generować Listen na każdej stronie)
    subscribeConversations();
    selectPeer(state.selectedPeerId, state.selectedPeerId === SUPPORT_UID ? "Obsługa Strzelca.pl" : "Wiadomości");

    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = null;
  }

  function closePanel() {
    isOpen = false;
    setStoredOpen(false);
    panel.style.display = "none";
    if (threadUnsub) threadUnsub();
    threadUnsub = null;
    if (convUnsub) convUnsub();
    convUnsub = null;

    // gdy zamknięte: odśwież badge co jakiś czas bez Listen
    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = setInterval(() => {
      if (!isOpen) refreshUnreadBadgeOnce().catch(() => {});
    }, 30000);
  }

  // init
  renderList();
  // Bez Listen na starcie: tylko badge (best-effort)
  refreshUnreadBadgeOnce().catch(() => {});
  badgeTimer = setInterval(() => {
    if (!isOpen) refreshUnreadBadgeOnce().catch(() => {});
  }, 30000);
  if (isOpen) openPanel();
}

if (typeof window !== "undefined") {
  // Guard przed podwójnym uruchomieniem, jeśli widget zostanie dołączony 2x.
  if (!window.__strzelcaMessagesWidgetLoaded) {
    window.__strzelcaMessagesWidgetLoaded = true;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main, { once: true });
      } else {
        main();
      }
    }
  }
}

