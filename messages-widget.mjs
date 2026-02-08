// Realtime Messages Widget (Firestore) - Strzelca.pl
// - floating button (prawy dolny róg) widoczny po zalogowaniu
// - lista konwersacji po lewej, czat po prawej
// - realtime (onSnapshot), bez serverless API => brak 401/500 z /api/*

const PROFILE_URL = "https://konto.strzelca.pl/profil.html";
const SUPPORT_PEER_ID = "admin"; // pinned "Pomoc" (wspólna skrzynka administracji przez /api/messages)

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
  const isMain = (window.location?.hostname || "") === "strzelca.pl";
  const urls = isMain
    ? ["/api/firebase-config", "https://strzelca.pl/api/firebase-config"]
    : ["https://strzelca.pl/api/firebase-config", "/api/firebase-config"];
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
  return null;
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
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      box-sizing: border-box;
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
      background: #22c55e;
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
      width: min(calc(100vw - 32px), 900px);
      max-width: calc(100vw - 32px);
      height: min(calc(100vh - 100px), 600px);
      max-height: calc(100vh - 100px);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,10,0.82);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 20px 70px rgba(0,0,0,0.65);
      overflow: hidden;
      display: none;
      box-sizing: border-box;
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
    .grid { 
      height: calc(100% - 52px); 
      display: grid; 
      grid-template-columns: 300px 1fr; 
      min-height: 0;
      overflow: hidden;
    }
    .left { 
      border-right: 1px solid rgba(255,255,255,0.10); 
      overflow-y: auto; 
      overflow-x: hidden;
      min-width: 0;
    }
    .leftTop { 
      padding: 10px; 
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
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
    .right { 
      display: grid; 
      grid-template-rows: 1fr auto; 
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .msgs { 
      overflow-y: auto; 
      overflow-x: hidden;
      padding: 14px; 
      display: flex; 
      flex-direction: column; 
      gap: 10px;
      min-height: 0;
    }
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
    .composer { 
      border-top: 1px solid rgba(255,255,255,0.10); 
      padding: 10px; 
      display: flex; 
      gap: 10px; 
      align-items: flex-end;
      flex-shrink: 0;
      min-height: 64px;
      box-sizing: border-box;
    }
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
    @media (max-width: 900px) { 
      .grid { grid-template-columns: 260px 1fr; }
      .panel {
        width: min(calc(100vw - 32px), 900px);
        max-width: calc(100vw - 32px);
        height: min(calc(100vh - 100px), 600px);
        max-height: calc(100vh - 100px);
      }
    }
    @media (max-width: 640px) {
      .panel { 
        width: min(calc(100vw - 16px), 900px);
        max-width: calc(100vw - 16px);
        height: min(calc(100vh - 80px), 600px);
        max-height: calc(100vh - 80px);
        right: 8px;
        bottom: 80px;
      }
      .grid { grid-template-columns: 1fr; }
      .left { display: none; }
    }
    .modalOverlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      z-index: 2147483647;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 20px;
      overflow-y: auto;
      box-sizing: border-box;
    }
    .modalOverlay.show { display: flex; }
    .modalContent {
      background: rgba(10,10,10,0.95);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 18px;
      padding: 20px;
      max-width: min(480px, calc(100vw - 40px));
      width: 100%;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      overflow-x: hidden;
      margin: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .modalHeader {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      flex-shrink: 0;
    }
    .modalTitle {
      font-weight: 900;
      font-size: 16px;
      color: #e5e5e5;
    }
    .modalClose {
      background: none;
      border: none;
      color: rgba(229,229,229,0.6);
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }
    .modalClose:hover { background: rgba(255,255,255,0.08); color: #e5e5e5; }
    .modalField {
      margin-bottom: 16px;
      position: relative;
      flex-shrink: 0;
    }
    .modalLabel {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: rgba(229,229,229,0.7);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modalField .search {
      border: 1px solid rgba(193,154,107,0.5);
      width: 100%;
      box-sizing: border-box;
    }
    .modalField .search:focus {
      border-color: rgba(193,154,107,0.8);
    }
    .modalField textarea {
      min-height: 80px;
      max-height: 200px;
      resize: vertical;
      border: 1px solid rgba(193,154,107,0.5);
      width: 100%;
      box-sizing: border-box;
    }
    .modalField textarea:focus {
      border-color: rgba(193,154,107,0.8);
    }
    .userSearchResults {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: rgba(0,0,0,0.95);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 12px;
      max-height: min(200px, calc(100vh - 400px));
      overflow-y: auto;
      z-index: 10;
      display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .userSearchResults.show { display: block; }
    .userResultItem {
      padding: 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .userResultItem:hover { background: rgba(255,255,255,0.06); }
    .userResultItem:last-child { border-bottom: none; }
    .userResultAvatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }
    .userResultText {
      flex: 1 1 auto;
      min-width: 0;
    }
    .userResultName {
      font-weight: 700;
      font-size: 13px;
      color: #e5e5e5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .userResultEmail {
      font-size: 11px;
      color: rgba(229,229,229,0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .modalActions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.10);
      flex-shrink: 0;
    }
    .modalBtn {
      flex: 1;
      padding: 12px;
      border-radius: 12px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: #e5e5e5;
    }
    .modalBtn:hover { border-color: rgba(193,154,107,0.7); background: rgba(193,154,107,0.1); }
    .modalBtn.primary {
      background: rgba(193,154,107,0.92);
      color: #111;
      border-color: rgba(193,154,107,0.35);
    }
    .modalBtn.primary:hover { background: rgba(193,154,107,1); }
    .modalBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (max-width: 640px) {
      .modalOverlay {
        padding: 16px 12px;
        align-items: flex-start;
      }
      .modalContent {
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 32px);
        padding: 16px;
        margin-top: 0;
      }
      .modalHeader {
        margin-bottom: 16px;
      }
      .modalField {
        margin-bottom: 12px;
      }
      .modalField textarea {
        min-height: 100px;
        max-height: 120px;
      }
      .userSearchResults {
        max-height: min(150px, calc(100vh - 400px));
      }
      .modalActions {
        margin-top: 16px;
        padding-top: 12px;
      }
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

// Funkcja do odtwarzania dźwięku nowej wiadomości
let soundCache = null;
function playMessageSound() {
  try {
    if (!soundCache) {
      soundCache = new Audio("/message.mp3");
      soundCache.volume = 0.5;
    }
    // Reset do początku i odtwórz
    soundCache.currentTime = 0;
    soundCache.play().catch((e) => {
      // Ignoruj błędy autoplay (użytkownik musi najpierw kliknąć na stronę)
      console.debug("Nie można odtworzyć dźwięku (wymagana interakcja użytkownika):", e);
    });
  } catch (e) {
    console.debug("Błąd odtwarzania dźwięku:", e);
  }
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
  } = fsMod;

  const apiKey = await getFirebaseApiKey();
  if (!apiKey) {
    console.warn("messages-widget: /api/firebase-config niedostępne — widget wyłączony.");
    return;
  }

  const firebaseConfig = {
    apiKey,
    authDomain: "strzelca-pl.firebaseapp.com",
    projectId: "strzelca-pl",
    storageBucket: "strzelca-pl.appspot.com",
    messagingSenderId: "511362047688",
    appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
    measurementId: "G-9EJ2R3JPVD",
  };

  // Jeśli strona ma już Firebase (większość Twoich podstron), reuse'ujemy istniejącą instancję.
  // To jest kluczowe, bo wtedy widget dziedziczy ten sam stan Firebase Auth (unikamy permission-denied).
  const existingApps = getApps();
  const app = existingApps.length ? existingApps[0] : initializeApp(firebaseConfig);

  let db;
  try {
    db = initializeFirestore(app, {
      // Transport Firestore: nie wymuszaj XHR long-pollingu (na części konfiguracji przeglądarek
      // potrafi to skończyć się błędami "access control checks"). Pozwól SDK dobrać tryb.
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

  let user = auth.currentUser || (await waitForAuth());
  if (!user) {
    // Jeśli nie mamy usera, spróbuj SSO (cookie -> custom token) dla tej instancji auth.
    try {
      const { ensureFirebaseSSO } = await import("https://strzelca.pl/sso-client.mjs?v=2026-02-06-1");
      await ensureFirebaseSSO(auth);
    } catch {}
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
  const newMsgBtn = document.createElement("button");
  newMsgBtn.className = "ghost";
  newMsgBtn.type = "button";
  newMsgBtn.style.marginTop = "10px";
  newMsgBtn.style.width = "100%";
  newMsgBtn.innerHTML = '<span style="margin-right: 6px;">+</span> Nowa wiadomość';
  newMsgBtn.setAttribute("aria-label", "Nowa wiadomość");
  leftTop.appendChild(searchInput);
  leftTop.appendChild(hint);
  leftTop.appendChild(newMsgBtn);

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
  let previousUnreadTotal = 0; // Śledzenie poprzedniej liczby nieprzeczytanych wiadomości

  let state = {
    conversations: [], // { id, peerId, peerName, peerAvatar, lastText, unread }
    searchUsers: [],
    q: "",
    selectedPeerId: getStoredSelectedPeerId() || SUPPORT_PEER_ID,
    selectedConversationId: null,
    unreadTotal: 0,
    supportLastText: "Pomoc / zgłoszenia",
    supportUnread: 0,
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
      // Wyszukiwanie po nicku (nazwie użytkownika) w utworzonych już wiadomościach
      // peerName zawiera nick użytkownika, więc już jest uwzględnione w n.includes(q)
      return n.includes(q) || l.includes(q);
    });
  }

  function renderList() {
    convList.innerHTML = "";
    const q = (state.q || "").toString().trim().toLowerCase();

    // pinned support always on top
    const supportName = "Pomoc STRZELCA.PL";
    const supportUnread = Number(state.supportUnread || 0) || 0;
    convList.appendChild(
      renderConvItem({
        key: "support",
        active: state.selectedPeerId === SUPPORT_PEER_ID,
        name: supportName,
        sub: state.supportLastText || "Pomoc / zgłoszenia",
        unread: supportUnread,
        avatar: null,
        letter: "S",
        onClick: () => selectPeer(SUPPORT_PEER_ID, supportName),
      })
    );

    const dm = filteredConversations().filter((c) => c.peerId !== SUPPORT_PEER_ID);
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

    // Wyszukaj w userProfiles po displayName i email
    try {
      const usersRef = collection(db, "userProfiles");
      const usersSnapshot = await getDocs(usersRef);
      const matchingUsers = [];

      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        const userId = doc.id;
        const displayName = (userData.displayName || "").toLowerCase();
        const email = (userData.email || "").toLowerCase();

        // Sprawdź czy wyszukiwany tekst pasuje do nicku lub emailu
        if (displayName.includes(qRaw) || email.includes(qRaw)) {
          matchingUsers.push({
            uid: userId,
            displayName: userData.displayName || userData.email || "Użytkownik",
            avatar: userData.avatar || null,
          });
        }
      });

      // Sortuj: najpierw dokładne dopasowania, potem częściowe
      matchingUsers.sort((a, b) => {
        const aName = a.displayName.toLowerCase();
        const bName = b.displayName.toLowerCase();
        const aExact = aName === qRaw || aName.startsWith(qRaw);
        const bExact = bName === qRaw || bName.startsWith(qRaw);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return aName.localeCompare(bName);
      });

      return matchingUsers.slice(0, 10).filter((x) => x.uid !== uid);
    } catch (e) {
      console.warn("searchUsersByPrefix error:", e);
      return [];
    }
  }

  async function markConversationRead({ conversationId, peerId }) {
    try {
      const convRef = doc(db, "privateConversations", conversationId);
      // Zakładamy, że dokument konwersacji istnieje (ensureConversation robi to wcześniej),
      // więc nie musimy go czytać w transakcji (czytanie nieistniejącego doca powodowało permission-denied).
      await setDoc(convRef, { unreadCounts: { [uid]: 0 } }, { merge: true });

      // batch set isRead = true for up to 200
      const mSnap = await getDocs(
        query(
          collection(db, "privateMessages"),
          where("senderId", "==", peerId),
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
      const msg = (e?.message || "").toString();
      // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do tej konwersacji
      if (msg.includes("Missing or insufficient permissions") || 
          msg.includes("permission-denied") ||
          msg.includes("Not authenticated")) {
        console.debug("messages-widget: brak uprawnień do oznaczania jako przeczytane (normalne dla niektórych użytkowników)");
        return;
      }
      console.warn("markConversationRead failed:", msg || e);
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

        state.conversations = list;
        state.unreadTotal = totalUnread;
        
        // Dodaj nieprzeczytane wiadomości support do całkowitej liczby
        const supportUnread = Number(state.supportUnread || 0) || 0;
        const totalUnreadWithSupport = totalUnread + supportUnread;
        
        setBadgeEl(badge, totalUnreadWithSupport);
        
        // Odtwórz dźwięk jeśli liczba nieprzeczytanych wiadomości wzrosła
        if (totalUnreadWithSupport > previousUnreadTotal && previousUnreadTotal >= 0) {
          playMessageSound();
        }
        previousUnreadTotal = totalUnreadWithSupport;
        
        renderList();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do wszystkich konwersacji
        // lub może nie być w pełni zalogowany. Widget powinien działać cicho w tle.
        if (msg.includes("Missing or insufficient permissions") || 
            msg.includes("permission-denied") ||
            msg.includes("Not authenticated")) {
          // Cicho zignoruj - widget nie powinien być widoczny dla niezalogowanych użytkowników
          // lub użytkowników bez uprawnień
          console.debug("messages-widget: brak uprawnień do konwersacji (normalne dla niezalogowanych)");
          return;
        }
        console.warn("conversations snapshot error:", msg || err);
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

    // Bezpieczniej niż query po conversationId (jeden "zły" dokument potrafi zablokować całą konwersację).
    // Robimy 2 query: uid->peer i peer->uid, a potem łączymy i sortujemy.
    const qA = query(
      collection(db, "privateMessages"),
      where("senderId", "==", uid),
      where("recipientId", "==", peerId),
      orderBy("timestamp", "asc"),
      limit(200)
    );
    const qB = query(
      collection(db, "privateMessages"),
      where("senderId", "==", peerId),
      where("recipientId", "==", uid),
      orderBy("timestamp", "asc"),
      limit(200)
    );

    let aDocs = [];
    let bDocs = [];

    function mapDocs(docs) {
      return docs.map((d) => {
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
    }

    let previousMessageCount = 0;
    let previousLastMessageTime = 0;
    
    async function recompute() {
      const merged = [...mapDocs(aDocs), ...mapDocs(bDocs)].sort((x, y) => (x.timestampMs || 0) - (y.timestampMs || 0));
      
      // Sprawdź czy są nowe nieprzeczytane wiadomości od tego użytkownika
      const unreadFromPeer = merged.filter(m => m.senderId === peerId && m.recipientId === uid && !m.isRead);
      const hasNewUnread = unreadFromPeer.length > 0;
      const lastMessage = merged[merged.length - 1];
      const lastMessageTime = lastMessage?.timestampMs || 0;
      
      // Odtwórz dźwięk jeśli:
      // 1. Jest nowa nieprzeczytana wiadomość od tego użytkownika
      // 2. Ostatnia wiadomość jest nowsza niż poprzednia (nowa wiadomość przyszła)
      // 3. Panel nie jest otwarty lub otwarta jest inna konwersacja
      if (hasNewUnread && lastMessageTime > previousLastMessageTime && 
          (!isOpen || state.selectedPeerId !== peerId)) {
        playMessageSound();
      }
      
      previousMessageCount = merged.length;
      previousLastMessageTime = lastMessageTime;
      
      renderMessages(merged);
      
      // Oznacz jako przeczytane jeśli panel jest otwarty i ta konwersacja jest wybrana
      if (isOpen && state.selectedPeerId === peerId) {
        await markConversationRead({ conversationId, peerId });
      }
    }

    const unsubA = onSnapshot(
      qA,
      async (snap) => {
        aDocs = snap.docs;
        await recompute();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do tej konwersacji
        if (msg.includes("Missing or insufficient permissions") || 
            msg.includes("permission-denied") ||
            msg.includes("Not authenticated")) {
          console.debug("messages-widget: brak uprawnień do wątku (normalne dla niektórych użytkowników)");
          try {
            msgs.innerHTML = `<div class="empty">Brak uprawnień do tej rozmowy.</div>`;
          } catch {}
          return;
        }
        console.warn("thread snapshot error:", msg || err);
        try {
          msgs.innerHTML = `<div class="empty">${
            msg.includes("requires an index") || msg.includes("index is currently building")
              ? "Indeks Firestore dla wiadomości jest w trakcie budowania. Odczekaj chwilę (czasem kilka minut) i odśwież."
              : "Nie udało się załadować rozmowy. Spróbuj odświeżyć."
          }</div>`;
        } catch {}
      }
    );

    const unsubB = onSnapshot(
      qB,
      async (snap) => {
        bDocs = snap.docs;
        await recompute();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do tej konwersacji
        if (msg.includes("Missing or insufficient permissions") || 
            msg.includes("permission-denied") ||
            msg.includes("Not authenticated")) {
          console.debug("messages-widget: brak uprawnień do wątku (normalne dla niektórych użytkowników)");
          try {
            msgs.innerHTML = `<div class="empty">Brak uprawnień do tej rozmowy.</div>`;
          } catch {}
          return;
        }
        console.warn("thread snapshot error:", msg || err);
        try {
          msgs.innerHTML = `<div class="empty">${
            msg.includes("requires an index") || msg.includes("index is currently building")
              ? "Indeks Firestore dla wiadomości jest w trakcie budowania. Odczekaj chwilę (czasem kilka minut) i odśwież."
              : "Nie udało się załadować rozmowy. Spróbuj odświeżyć."
          }</div>`;
        } catch {}
      }
    );

    threadUnsub = () => {
      try { unsubA(); } catch {}
      try { unsubB(); } catch {}
    };
  }

  function selectPeer(peerId, labelName) {
    state.selectedPeerId = peerId;
    setStoredSelectedPeerId(peerId);
    titleText.textContent = labelName || "Wiadomości";
    renderList();
    msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;

    // Support chat (API /api/messages) — wspólna skrzynka administracji
    if (peerId === SUPPORT_PEER_ID) {
      subscribeSupportThread();
      return;
    }

    // DM (Firestore privateMessages)
    ensureConversation(peerId).catch(() => {}).finally(() => subscribeThread(peerId));
  }

  // =========================
  // SUPPORT CHAT (API)
  // =========================
  let supportTimer = null;
  async function fetchSupportThread() {
    const res = await fetch(`/api/messages/thread?peerId=admin&limit=200`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
    const items = Array.isArray(data?.data?.messages) ? data.data.messages : [];
    // update preview + unread for support item
    try {
      const last = items[items.length - 1];
      state.supportLastText = last?.content ? String(last.content).slice(0, 70) : "Pomoc / zgłoszenia";
      state.supportUnread = items.filter((m) => m && m.senderId === "admin" && m.isRead === false).length;
      // Zaktualizuj badge z uwzględnieniem support unread
      const totalUnreadWithSupport = state.unreadTotal + state.supportUnread;
      setBadgeEl(badge, totalUnreadWithSupport);
      renderList();
    } catch {}
    return items;
  }

  function renderSupportMessages(items) {
    // map to widget render format
    const mapped = (items || []).map((m) => ({
      id: m.id,
      content: (m.content || "").toString(),
      senderId: m.senderId || null,
      recipientId: m.recipientId || null,
      isRead: m.isRead === true,
      timestampMs: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
    }));
    renderMessages(mapped);
  }

  async function markSupportRead(items) {
    // Oznacz jako przeczytane wiadomości od "admin" do usera
    const toMark = (items || []).filter((m) => m && m.senderId === "admin" && m.isRead === false && m.id);
    for (const m of toMark.slice(0, 50)) {
      try {
        await fetch(`/api/messages/${m.id}/read`, { method: "PUT", credentials: "include" });
      } catch {}
    }
  }

  function subscribeSupportThread() {
    if (threadUnsub) threadUnsub();
    if (supportTimer) clearInterval(supportTimer);
    supportTimer = null;
    let previousSupportMessageCount = 0;
    let previousSupportLastMessageTime = 0;

    const tick = async () => {
      try {
        const items = await fetchSupportThread();
        
        // Sprawdź czy są nowe nieprzeczytane wiadomości od admina
        const unreadFromAdmin = items.filter(m => m && m.senderId === "admin" && m.isRead === false);
        const lastMessage = items[items.length - 1];
        const lastMessageTime = lastMessage?.timestampMs || lastMessage?.timestamp || 0;
        
        // Odtwórz dźwięk jeśli:
        // 1. Jest nowa nieprzeczytana wiadomość od admina
        // 2. Ostatnia wiadomość jest nowsza niż poprzednia (nowa wiadomość przyszła)
        // 3. Panel nie jest otwarty lub otwarta jest inna konwersacja
        if (unreadFromAdmin.length > 0 && lastMessageTime > previousSupportLastMessageTime && 
            (!isOpen || state.selectedPeerId !== SUPPORT_PEER_ID)) {
          playMessageSound();
        }
        
        previousSupportMessageCount = items.length;
        previousSupportLastMessageTime = lastMessageTime;
        
        renderSupportMessages(items);
        
        // Oznacz jako przeczytane jeśli panel jest otwarty i ta konwersacja jest wybrana
        if (isOpen && state.selectedPeerId === SUPPORT_PEER_ID) {
          await markSupportRead(items);
        }
      } catch (e) {
        const msg = (e?.message || "").toString();
        msgs.innerHTML = `<div class="empty">${
          msg.includes("Not authenticated")
            ? "Musisz być zalogowany, aby pisać do Pomocy. Zaloguj się i spróbuj ponownie."
            : "Nie udało się załadować Pomocy. Spróbuj odświeżyć."
        }</div>`;
      }
    };

    tick();
    supportTimer = setInterval(() => {
      if (isOpen && state.selectedPeerId === SUPPORT_PEER_ID) tick();
    }, 3500);

    threadUnsub = () => {
      try {
        if (supportTimer) clearInterval(supportTimer);
      } catch {}
      supportTimer = null;
    };
  }

  // Search: live filter + users below (wyszukiwanie po nickach w utworzonych już wiadomościach)
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    state.q = searchInput.value || "";
    // Natychmiastowe filtrowanie konwersacji (po nickach)
    renderList();
    if (searchTimer) clearTimeout(searchTimer);
    // Wyszukiwanie użytkowników z opóźnieniem dla lepszej wydajności
    searchTimer = setTimeout(async () => {
      try {
        state.searchUsers = await searchUsersByPrefix(state.q);
      } catch (e) {
        state.searchUsers = [];
      }
      renderList();
    }, 150);
  });

  async function doSend() {
    const content = (ta.value || "").toString().trim();
    if (!content) return;
    sendBtn.disabled = true;
    try {
      if (state.selectedPeerId === SUPPORT_PEER_ID) {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content, recipientId: "admin", status: "in_progress" }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        ta.value = "";
        ta.focus();
        // refresh
        await fetchSupportThread().then((items) => {
          renderSupportMessages(items);
          return markSupportRead(items);
        }).catch(() => {});
      } else {
        await ensureConversation(state.selectedPeerId).catch(() => {});
        await sendMessageTo(state.selectedPeerId, content);
        ta.value = "";
        ta.focus();
      }
    } catch (e) {
      console.warn("send failed:", e?.message || e);
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Modal do tworzenia nowej wiadomości
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modalOverlay";
  modalOverlay.innerHTML = `
    <div class="modalContent">
      <div class="modalHeader">
        <div class="modalTitle">Nowa wiadomość</div>
        <button class="modalClose" type="button" aria-label="Zamknij">×</button>
      </div>
      <div class="modalField" style="position: relative;">
        <label class="modalLabel">WYSZUKAJ UŻYTKOWNIKA</label>
        <input type="text" class="search" id="new-msg-user-search" placeholder="Wpisz nick lub email..." autocomplete="off" />
        <input type="hidden" id="new-msg-user-id" />
        <input type="hidden" id="new-msg-user-email" />
        <div class="userSearchResults" id="new-msg-results"></div>
      </div>
      <div class="modalField">
        <label class="modalLabel">WIADOMOŚĆ</label>
        <textarea class="search" id="new-msg-content" placeholder="Wpisz wiadomość..." rows="4" style="resize: vertical;"></textarea>
      </div>
      <div class="modalActions">
        <button class="modalBtn" type="button" id="new-msg-cancel">Anuluj</button>
        <button class="modalBtn primary" type="button" id="new-msg-send">Wyślij</button>
      </div>
    </div>
  `;
  shadow.appendChild(modalOverlay);

  const newMsgUserSearch = shadow.getElementById("new-msg-user-search");
  const newMsgUserId = shadow.getElementById("new-msg-user-id");
  const newMsgUserEmail = shadow.getElementById("new-msg-user-email");
  const newMsgContent = shadow.getElementById("new-msg-content");
  const newMsgResults = shadow.getElementById("new-msg-results");
  const newMsgCancel = shadow.getElementById("new-msg-cancel");
  const newMsgSend = shadow.getElementById("new-msg-send");
  const modalCloseBtn = shadow.querySelector(".modalClose");

  let newMsgSearchTimer = null;
  newMsgUserSearch.addEventListener("input", () => {
    const q = (newMsgUserSearch.value || "").trim();
    if (newMsgSearchTimer) clearTimeout(newMsgSearchTimer);
    if (q.length < 2) {
      newMsgResults.classList.remove("show");
      newMsgResults.innerHTML = "";
      newMsgUserId.value = "";
      newMsgUserEmail.value = "";
      return;
    }
    // Wyszukiwanie "live" - zmniejszony timeout dla szybszej reakcji
    newMsgSearchTimer = setTimeout(async () => {
      try {
        const users = await searchUsersByPrefix(q);
        if (users.length === 0) {
          newMsgResults.innerHTML = '<div style="padding: 12px; text-align: center; color: rgba(229,229,229,0.6); font-size: 12px;">Nie znaleziono użytkowników</div>';
          newMsgResults.classList.add("show");
          return;
        }
        newMsgResults.innerHTML = users.slice(0, 8).map(u => `
          <div class="userResultItem" data-uid="${u.uid}" data-name="${u.displayName || 'Użytkownik'}" data-email="${u.uid}">
            <div class="userResultAvatar">${firstLetter(u.displayName || "U")}</div>
            <div class="userResultText">
              <div class="userResultName">${u.displayName || "Użytkownik"}</div>
            </div>
          </div>
        `).join("");
        newMsgResults.querySelectorAll(".userResultItem").forEach(item => {
          item.addEventListener("click", () => {
            const uid = item.dataset.uid;
            const name = item.dataset.name;
            newMsgUserId.value = uid;
            newMsgUserEmail.value = uid; // Używamy uid jako email dla DM
            newMsgUserSearch.value = name;
            newMsgResults.classList.remove("show");
          });
        });
        newMsgResults.classList.add("show");
      } catch (e) {
        console.warn("User search failed:", e);
        newMsgResults.innerHTML = '<div style="padding: 12px; text-align: center; color: rgba(229,229,229,0.6); font-size: 12px;">Błąd wyszukiwania</div>';
        newMsgResults.classList.add("show");
      }
    }, 150);
  });

  document.addEventListener("click", (e) => {
    if (!newMsgResults.contains(e.target) && !newMsgUserSearch.contains(e.target)) {
      newMsgResults.classList.remove("show");
    }
  });

  async function sendNewMessage() {
    const userId = newMsgUserId.value.trim();
    const content = (newMsgContent.value || "").trim();
    if (!userId || !content) return;
    newMsgSend.disabled = true;
    newMsgSend.textContent = "Wysyłanie...";
    try {
      await ensureConversation(userId).catch(() => {});
      await sendMessageTo(userId, content);
      closeNewMessageModal();
      // Otwórz konwersację z wybranym użytkownikiem
      selectPeer(userId, newMsgUserSearch.value || "Użytkownik");
    } catch (e) {
      console.warn("Send new message failed:", e?.message || e);
      alert("Nie udało się wysłać wiadomości. Spróbuj ponownie.");
    } finally {
      newMsgSend.disabled = false;
      newMsgSend.textContent = "Wyślij";
    }
  }

  function openNewMessageModal() {
    modalOverlay.classList.add("show");
    newMsgUserSearch.focus();
  }

  function closeNewMessageModal() {
    modalOverlay.classList.remove("show");
    newMsgUserSearch.value = "";
    newMsgContent.value = "";
    newMsgUserId.value = "";
    newMsgUserEmail.value = "";
    newMsgResults.classList.remove("show");
    newMsgResults.innerHTML = "";
  }

  newMsgBtn.addEventListener("click", openNewMessageModal);
  newMsgCancel.addEventListener("click", closeNewMessageModal);
  modalCloseBtn.addEventListener("click", closeNewMessageModal);
  newMsgSend.addEventListener("click", sendNewMessage);
  newMsgContent.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendNewMessage();
    }
  });
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeNewMessageModal();
  });

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
    selectPeer(state.selectedPeerId, state.selectedPeerId === SUPPORT_PEER_ID ? "Obsługa Strzelca.pl" : "Wiadomości");

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

