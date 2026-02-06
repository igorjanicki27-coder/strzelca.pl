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
const SSO_CACHE_KEY = "__strzelca_sso_cache";
const SSO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minut cache

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

function getCachedSSO() {
  try {
    const cached = sessionStorage.getItem(SSO_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    const now = Date.now();
    if (now - parsed.timestamp > SSO_CACHE_TTL_MS) {
      sessionStorage.removeItem(SSO_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedSSO(data) {
  try {
    sessionStorage.setItem(SSO_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data,
    }));
  } catch {
    // ignore
  }
}

function clearCachedSSO() {
  try {
    sessionStorage.removeItem(SSO_CACHE_KEY);
  } catch {
    // ignore
  }
}

// Eksportowana funkcja do czyszczenia cache (może być wywołana z dowolnej subdomeny)
export function clearSSOCache() {
  clearCachedSSO();
}

export async function ensureFirebaseSSO(auth) {
  if (!auth) throw new Error("ensureFirebaseSSO: missing auth");

  // WAŻNE: Cookie jest źródłem prawdy - zawsze sprawdzamy cookie, nawet jeśli mamy cache
  // Cache jest tylko dla optymalizacji, nie zastępuje sprawdzenia cookie
  
  const currentUser = auth.currentUser;
  const cached = getCachedSSO();
  
  // OPTYMALIZACJA: Jeśli mamy świeży cache i użytkownik jest zalogowany z tym samym UID,
  // możemy sprawdzić cookie tylko raz na 5 minut (zamiast przy każdym wywołaniu)
  let shouldCheckCookie = true;
  if (cached && currentUser && cached.uid === currentUser.uid) {
    // Sprawdź wiek cache - jeśli jest świeższy niż 2 minuty, użyj cache
    // Ale nadal sprawdzamy cookie co 2 minuty, żeby wykryć wylogowanie z innej subdomeny
    try {
      const cachedData = sessionStorage.getItem(SSO_CACHE_KEY);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cacheAge = Date.now() - parsed.timestamp;
        const CACHE_VALIDITY_MS = 2 * 60 * 1000; // 2 minuty (krócej niż TTL cache)
        
        if (cacheAge < CACHE_VALIDITY_MS) {
          // Cache jest świeży - ale nadal musimy sprawdzić cookie, żeby wykryć wylogowanie
          // Wykonujemy sprawdzenie cookie, ale cache pomaga zredukować częstotliwość
        }
      }
    } catch {
      // Jeśli nie można sprawdzić cache, kontynuuj normalnie
    }
  }

  // Źródło prawdy: wspólna sesja SSO w cookie na `.strzelca.pl`
  // Zawsze sprawdzamy cookie (nawet jeśli auth.currentUser istnieje),
  // żeby nie trzymać "starego" użytkownika w danej subdomenie i nie nadpisywać cookie z powrotem.
  const cookieSession = await apiFetch("/sso-session-exchange", {
    method: "POST",
    body: "{}",
  });

  const cookieAuthenticated =
    cookieSession && cookieSession.authenticated === true && typeof cookieSession.uid === "string";

  // Cache'uj wynik jeśli mamy autentykację
  if (cookieAuthenticated) {
    setCachedSSO({
      uid: cookieSession.uid,
      authenticated: true,
    });
  } else {
    // Cookie nie istnieje - wyczyść cache
    clearCachedSSO();
    
    // Jeśli cookie nie istnieje, ale lokalny użytkownik jest zalogowany, wyloguj go
    // (użytkownik został wylogowany z innej subdomeny)
    if (currentUser) {
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

      // Wyloguj lokalnego użytkownika, bo cookie nie istnieje
      const { signOut } = await import(
        "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
      );
      try {
        await signOut(auth);
      } catch {
        // ignore
      }
      return { status: "signed-out-from-cookie" };
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
    // Odśwież cache po synchronizacji
    if (auth.currentUser) {
      setCachedSSO({
        uid: auth.currentUser.uid,
        authenticated: true,
      });
    }
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

