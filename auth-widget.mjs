const API_URL = "https://strzelca.pl/api/me";
const LOGIN_URL = "https://konto.strzelca.pl/login.html";
const PROFILE_URL_VERIFIED = "https://konto.strzelca.pl/profil.html";
const PROFILE_URL_UNVERIFIED = "https://konto.strzelca.pl/po.rejestracji.html";

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

function renderLoggedIn(root, { avatarUrl, displayName, emailVerified }) {
  const href = emailVerified ? PROFILE_URL_VERIFIED : PROFILE_URL_UNVERIFIED;
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
      import("https://strzelca.pl/messages-widget.mjs?v=2026-02-05-12").catch(() => {});
    }
  } catch {
    // ignore
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
    const data = await fetchMeWithTimeout();
    if (data && data.success === true && data.authenticated === true) {
      renderLoggedIn(root, {
        avatarUrl: data?.profile?.avatar || null,
        displayName: data?.profile?.displayName || null,
        emailVerified: data?.emailVerified === true,
      });
      return;
    }
    renderLoggedOut(root);
  } catch {
    renderLoggedOut(root);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}

