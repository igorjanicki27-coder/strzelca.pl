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
const UNVERIFIED_LOCK_KEY = "__strzelca_sso_lock_unverified";

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

  // Źródło prawdy: wspólna sesja SSO w cookie na `.strzelca.pl`
  // Zawsze sprawdzamy cookie (nawet jeśli auth.currentUser istnieje),
  // żeby nie trzymać "starego" użytkownika w danej subdomenie i nie nadpisywać cookie z powrotem.
  const cookieSession = await apiFetch("/sso-session-exchange", {
    method: "POST",
    body: "{}",
  });

  const cookieAuthenticated =
    cookieSession && cookieSession.authenticated === true && typeof cookieSession.uid === "string";

  // Jeśli cookie nie istnieje, a w tej subdomenie mamy usera, to tylko best-effort odśwież cookie.
  if (!cookieAuthenticated) {
    if (auth.currentUser) {
      // Jeśli jesteśmy w stanie "unverified lock" (po nieudanym logowaniu),
      // to NIE odtwarzaj SSO z lokalnego usera. Zamiast tego wyloguj lokalnie.
      try {
        if (sessionStorage?.getItem?.(UNVERIFIED_LOCK_KEY) === "1") {
          const { signOut } = await import(
            "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
          );
          try {
            await signOut(auth);
          } catch {}
          return { status: "locked-signed-out" };
        }
      } catch {
        // ignore
      }

      try {
        await syncSessionCookieFromFirebaseUser(auth, {
          minIntervalMinutes: DEFAULT_MIN_SYNC_MINUTES,
        });
      } catch {}
      return { status: "already-signed-in" };
    }
    return { status: "no-session" };
  }

  // Mamy cookie sesję - jeśli lokalny user jest inny niż w cookie, przełącz na cookie user.
  const cookieUid = cookieSession.uid;
  const needsSwitch = auth.currentUser && auth.currentUser.uid && auth.currentUser.uid !== cookieUid;

  const { signInWithCustomToken, signOut } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
  );

  if (needsSwitch) {
    try {
      await signOut(auth);
    } catch {}
  }

  // Jeśli nie ma usera albo był switch, logujemy tokenem z cookie.
  if (!auth.currentUser || needsSwitch) {
    if (!cookieSession.customToken) {
      return { status: "no-session" };
    }
    await signInWithCustomToken(auth, cookieSession.customToken);
  }

  // Po zalogowaniu w subdomenie odśwież cookie (żeby wydłużać sesję cross-subdomain)
  try {
    await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 }); // natychmiast
  } catch {}

  return needsSwitch ? { status: "switched-to-cookie-user" } : { status: "signed-in" };
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
      return {
        status: "error",
        error: data?.error || `HTTP ${data?.__status || "?"}`,
        code: data?.code || null,
        message: data?.message || null,
        debug: data?.debug || null,
      };
    }

    setLastSyncMs(t);
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: e?.message || String(e) };
  }
}

// (usunięto) profileTargetUrl - logika weryfikacji emaila jest sprawdzana wyłącznie przy logowaniu

