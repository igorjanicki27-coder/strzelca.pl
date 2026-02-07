const API_URL = "https://strzelca.pl/api/me";
const LOGIN_URL = "https://konto.strzelca.pl/logowanie.html";
const PROFILE_URL = "https://konto.strzelca.pl/profil.html";
const FIREBASE_CONFIG_BASE = {
  authDomain: "strzelca-pl.firebaseapp.com",
  projectId: "strzelca-pl",
  storageBucket: "strzelca-pl.appspot.com",
  messagingSenderId: "511362047688",
  appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
  measurementId: "G-9EJ2R3JPVD",
};

function ensureStyles() {
  if (document.getElementById("strzelca-auth-widget-style")) return;
  const style = document.createElement("style");
  style.id = "strzelca-auth-widget-style";
  style.textContent = `
    #strzelca-auth-widget {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    #strzelca-auth-widget a {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: inherit;
    }
    .strzelca-auth-pill {
      background: rgba(10, 10, 10, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 999px;
      padding: 8px 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
    /* Logged-in state: show ONLY avatar (no frame/pill) */
    .strzelca-auth-pill--avatar-only {
      background: transparent;
      border: none;
      padding: 0;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .strzelca-auth-text {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .strzelca-auth-spinner {
      width: 16px;
      height: 16px;
      border-radius: 999px;
      border: 2px solid rgba(255,255,255,0.22);
      border-top-color: rgba(255,255,255,0.9);
      animation: strzelcaAuthSpin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes strzelcaAuthSpin { to { transform: rotate(360deg); } }
    .strzelca-auth-avatar {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(193, 154, 107, 0.95);
      color: #111;
      font-weight: 900;
      flex: 0 0 auto;
    }
    .strzelca-auth-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    /* Admin floating button (global) */
    #strzelca-admin-fab {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 54px;
      height: 54px;
      border-radius: 999px;
      border: 1px solid rgba(239,68,68,0.35);
      background: rgba(10, 10, 10, 0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      display: none;
      align-items: center;
      justify-content: center;
      color: #fecaca;
      cursor: pointer;
      text-decoration: none;
      font-weight: 900;
      user-select: none;
    }
    #strzelca-admin-fab:hover {
      border-color: rgba(239,68,68,0.7);
      color: #fff;
    }
    #strzelca-admin-fab span {
      font-size: 20px;
      line-height: 1;
    }
  `;
  document.head.appendChild(style);
}

function hideLegacyAuthUiIfPresent() {
  const legacy = ["user-panel", "login-button"];
  for (const id of legacy) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
}

async function getFirebaseApiKey() {
  // Na części domen / subdomen endpoint /api/* może nie być podpięty.
  // Dlatego mamy fallback do głównej domeny.
  const isMain = (typeof window !== "undefined" && window.location?.hostname) === "strzelca.pl";
  const urls = isMain
    ? ["/api/firebase-config", "https://strzelca.pl/api/firebase-config"]
    : ["https://strzelca.pl/api/firebase-config", "/api/firebase-config"];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: url.startsWith("http") ? "omit" : "same-origin",
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.apiKey === "string" && data.apiKey.length > 10) {
        return data.apiKey;
      }
    } catch {}
  }
  return null;
}

function isAdminRole(role) {
  const value = String(role || "").toLowerCase();
  return value === "admin" || value === "administrator" || value === "superadmin";
}

async function tryGetFirebaseSession() {
  try {
    const [{ initializeApp, getApps }, { getAuth, browserLocalPersistence, setPersistence }, { getFirestore, doc, getDoc }] =
      await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
      ]);

    let app = getApps()[0] || null;
    if (!app) {
      const apiKey = await getFirebaseApiKey();
      if (!apiKey) return null;
      app = initializeApp({ apiKey, ...FIREBASE_CONFIG_BASE });
    }

    const auth = getAuth(app);
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {}

    try {
      const { ensureFirebaseSSO } = await import("https://strzelca.pl/sso-client.mjs?v=2026-02-06-1");
      await ensureFirebaseSSO(auth);
    } catch {}

    try {
      await auth.authStateReady();
    } catch {}

    const user = auth.currentUser;
    if (!user) {
      return { authenticated: false };
    }

    let profile = null;
    try {
      const db = getFirestore(app);
      const snap = await getDoc(doc(db, "userProfiles", user.uid));
      if (snap.exists()) profile = snap.data();
    } catch {}

    return {
      authenticated: true,
      user,
      profile,
    };
  } catch {
    return null;
  }
}

function firstLetter(name) {
  const s = (name || "").toString().trim();
  if (!s) return "U";
  return s[0].toUpperCase();
}

function renderLoading(root) {
  root.innerHTML = `
    <div class="strzelca-auth-pill" role="status" aria-live="polite" aria-label="Sprawdzanie logowania">
      <a href="${LOGIN_URL}">
        <span class="strzelca-auth-spinner" aria-hidden="true"></span>
      </a>
    </div>
  `;
}

function renderLoggedOut(root) {
  root.innerHTML = `
    <div class="strzelca-auth-pill">
      <a href="${LOGIN_URL}" aria-label="Zaloguj się">
        <span class="strzelca-auth-text">Zaloguj się</span>
      </a>
    </div>
  `;
}

function renderLoggedIn(root, { avatarUrl, displayName }) {
  const href = PROFILE_URL;
  const letter = firstLetter(displayName);
  const avatar = avatarUrl
    ? `<span class="strzelca-auth-avatar"><img src="${avatarUrl}" alt="Avatar" /></span>`
    : `<span class="strzelca-auth-avatar" aria-hidden="true">${letter}</span>`;

  root.innerHTML = `
    <div class="strzelca-auth-pill strzelca-auth-pill--avatar-only">
      <a href="${href}" aria-label="Otwórz profil">
        ${avatar}
      </a>
    </div>
  `;

  // Bootstrapping widgetu wiadomości (tylko po zalogowaniu)
  try {
    if (!window.__strzelcaMessagesWidgetBootstrap) {
      window.__strzelcaMessagesWidgetBootstrap = true;
      import("https://strzelca.pl/messages-widget.mjs?v=2026-02-05-14").catch(() => {});
    }
  } catch {
    // ignore
  }
}

function ensureAdminFab() {
  // Hardening: na panelu admina w ogóle nie twórz tego elementu
  if (isAdminPanelPage()) return null;
  let el = document.getElementById("strzelca-admin-fab");
  if (el) return el;
  el = document.createElement("a");
  el.id = "strzelca-admin-fab";
  el.href = "https://strzelca.pl/admin/index.html";
  el.setAttribute("aria-label", "Panel administratora");
  el.title = "Panel administratora";
  el.innerHTML = `<span>⚙</span>`;
  document.body.appendChild(el);
  return el;
}

function isAdminPanelPage() {
  try {
    const host = (window.location?.hostname || "").toLowerCase();
    const path = (window.location?.pathname || "").toLowerCase();
    // Panel admina jest hostowany na strzelca.pl/admin/...
    return host === "strzelca.pl" && (path === "/admin" || path.startsWith("/admin/"));
  } catch {
    return false;
  }
}

async function fetchMeWithTimeout(ms = 4500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(API_URL, {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  ensureStyles();
  hideLegacyAuthUiIfPresent();

  const root = document.createElement("div");
  root.id = "strzelca-auth-widget";
  document.body.appendChild(root);

  renderLoading(root);

  try {
    const firebase = await tryGetFirebaseSession();
    if (firebase && firebase.authenticated === true) {
      const displayName =
        firebase?.profile?.displayName ||
        firebase?.user?.displayName ||
        firebase?.user?.email?.split("@")[0] ||
        null;
      const avatarUrl = firebase?.profile?.avatar || null;

      renderLoggedIn(root, { avatarUrl, displayName });

      try {
        const fab = ensureAdminFab();
        if (!fab) {
          // na panelu admina nie tworzymy FAB w ogóle
        } else if (isAdminRole(firebase?.profile?.role)) {
          fab.style.display = "inline-flex";
        } else {
          fab.style.display = "none";
        }
      } catch {}

      return;
    }

    if (firebase && firebase.authenticated === false) {
      renderLoggedOut(root);
      try {
        const fab = ensureAdminFab();
        if (fab) fab.style.display = "none";
      } catch {}
      return;
    }

    const data = await fetchMeWithTimeout();
    if (data && data.success === true && data.authenticated === true) {
      renderLoggedIn(root, {
        avatarUrl: data?.profile?.avatar || null,
        displayName: data?.profile?.displayName || null,
      });

      try {
        const fab = ensureAdminFab();
        if (!fab) {
          // na panelu admina nie tworzymy FAB w ogóle
        } else if (data?.isAdmin === true) {
          fab.style.display = "inline-flex";
        } else {
          fab.style.display = "none";
        }
      } catch {}

      return;
    }

    renderLoggedOut(root);
    try {
      const fab = ensureAdminFab();
      if (fab) fab.style.display = "none";
    } catch {}
  } catch {
    renderLoggedOut(root);
    try {
      const fab = ensureAdminFab();
      if (fab) fab.style.display = "none";
    } catch {}
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
