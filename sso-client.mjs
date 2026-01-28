/**
 * Strzelca SSO client
 * - utrzymuje wspólną sesję między subdomenami poprzez cookie na `.strzelca.pl`
 * - wymienia cookie na firebase custom token i loguje w aktualnej subdomenie
 *
 * Wymagania:
 * - na każdej stronie masz już Firebase Auth (`getAuth(...)`)
 * - wywołujesz `await ensureFirebaseSSO(auth)` na starcie (zanim zaczniesz redirectować usera)
 */

const API_BASE = "https://strzelca.pl/api";
const LAST_SYNC_KEY = "__strzelca_sso_last_sync_ms";
const DEFAULT_MIN_SYNC_MINUTES = 30;

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { __ok: res.ok, __status: res.status, ...json };
}

export async function ensureFirebaseSSO(auth) {
  if (!auth) throw new Error("ensureFirebaseSSO: missing auth");

  // Jeśli użytkownik już jest zalogowany w tej subdomenie, nic nie rób
  if (auth.currentUser) {
    // Best-effort: odśwież cookie SSO (z throttlingiem)
    try {
      await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: DEFAULT_MIN_SYNC_MINUTES });
    } catch {}
    return { status: "already-signed-in" };
  }

  // Spróbuj wymiany sesji cookie -> custom token
  const data = await apiFetch("/sso-session-exchange", { method: "POST", body: "{}" });
  if (!data || data.authenticated !== true || !data.customToken) {
    return { status: "no-session" };
  }

  // Zaloguj custom tokenem
  // Importujemy dynamicznie, bo część stron nie importuje signInWithCustomToken
  const { signInWithCustomToken } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
  );

  await signInWithCustomToken(auth, data.customToken);

  // Po zalogowaniu w subdomenie odśwież cookie (żeby wydłużać sesję cross-subdomain)
  try {
    await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 }); // natychmiast
  } catch {}

  return { status: "signed-in", emailVerified: data.emailVerified === true };
}

function nowMs() {
  return Date.now();
}

function getLastSyncMs() {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setLastSyncMs(ms) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ms));
  } catch {
    // ignore
  }
}

export async function syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes = DEFAULT_MIN_SYNC_MINUTES } = {}) {
  if (!auth?.currentUser) return { status: "no-user" };

  const intervalMs = Math.max(0, Number(minIntervalMinutes) || 0) * 60 * 1000;
  const last = getLastSyncMs();
  const t = nowMs();
  if (intervalMs > 0 && last && t - last < intervalMs) {
    return { status: "throttled" };
  }

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const data = await apiFetch("/sso-session-login", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    // Jeśli backend nie potwierdzi sukcesu, nie udawaj że refresh się udał
    if (!data || data.success !== true) {
      // Mimo błędu ustaw timestamp, żeby nie spamować requestami przy każdym wejściu
      setLastSyncMs(t);
      return { status: "error", error: data?.error || `HTTP ${data?.__status || "?"}` };
    }

    setLastSyncMs(t);
    return { status: "ok", emailVerified: data.emailVerified === true };
  } catch (e) {
    return { status: "error", error: e?.message || String(e) };
  }
}

export function profileTargetUrl({ emailVerified, verifiedUrl, unverifiedUrl }) {
  return emailVerified ? verifiedUrl : unverifiedUrl;
}

