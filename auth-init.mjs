/**
 * Wspólny moduł inicjalizacji autoryzacji Firebase
 * - ujednolicona inicjalizacja dla wszystkich stron
 * - optymalizacja: zawsze czeka na authStateReady przed SSO
 * - cache i optymalizacja requestów
 * 
 * Użycie:
 *   import { initAuth } from "https://strzelca.pl/auth-init.mjs?v=2026-04-11-1";
 *   const { auth, db } = await initAuth(firebaseConfig);
 *
 * OAuth (Google): getRedirectResult musi być przed ensureFirebaseSSO — inaczej cookie SSO
 * może być puste przy już zalogowanym użytkowniku i sso-client wyloguje sesję.
 */

const SSO_CLIENT_MOD = "https://strzelca.pl/sso-client.mjs?v=2026-03-29-4";
const GOOGLE_PROVISION_MOD =
  "https://strzelca.pl/google-account-provision.mjs?v=2026-04-11-1";

export async function initAuth(firebaseConfig, options = {}) {
  const {
    initializeApp,
    getApps,
  } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
  
  const {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    getRedirectResult,
  } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");

  const {
    initializeFirestore,
    getFirestore,
  } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

  // Inicjalizuj Firebase App (jeśli jeszcze nie zainicjalizowany)
  let app;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
  } else {
    app = initializeApp(firebaseConfig);
  }

  // Inicjalizuj Auth
  const auth = getAuth(app);

  // Ustaw persistence (domyślnie local, można zmienić w options)
  const persistence = options.persistence || browserLocalPersistence;
  try {
    await setPersistence(auth, persistence);
  } catch (error) {
    console.warn("Error setting auth persistence:", error);
  }

  /* Powrót z OAuth — przed authStateReady i przed ensureFirebaseSSO (jak auth-widget / logowanie). */
  try {
    if (typeof getRedirectResult === "function") {
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult?.user) {
        const { syncSessionCookieFromFirebaseUser } = await import(SSO_CLIENT_MOD);
        let sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
        if (sync?.status !== "ok") {
          await new Promise((r) => setTimeout(r, 200));
          sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
        }
        try {
          const { ensureGoogleUserProfileIfNeeded } = await import(GOOGLE_PROVISION_MOD);
          await ensureGoogleUserProfileIfNeeded(app, redirectResult.user);
        } catch (provErr) {
          console.warn("Google profile provision (initAuth):", provErr?.message || provErr);
        }
      }
    }
  } catch (e) {
    const code = String(e?.code || "");
    if (code === "auth/account-exists-with-different-credential") {
      try {
        sessionStorage.setItem(
          "strzelca_oauth_redirect_error",
          JSON.stringify({ code, t: Date.now() }),
        );
      } catch {}
    } else if (code) {
      console.warn("getRedirectResult (initAuth):", code, e?.message || e);
    }
  }

  // OPTYMALIZACJA: Zawsze czekaj na authStateReady przed dalszymi operacjami
  try {
    await auth.authStateReady();
    if (options.logAuthReady !== false) {
      console.log("Firebase Auth state ready");
    }
  } catch (error) {
    console.warn("Firebase Auth state check failed:", error);
  }

  // Inicjalizuj Firestore (z opcjonalnymi opcjami)
  // WAŻNE: Sprawdź, czy Firestore nie został już zainicjalizowany
  let db;
  // Safari / WebKit: WebChannel + Fetch streams często kończy się „access control checks” i 400 na
  // …/channel — long polling + wyłączone fetch streams jest stabilniejsze (admin, panel itd.).
  const firestoreOptions = options.firestore || {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  };
  
  try {
    // Spróbuj zainicjalizować Firestore z opcjami
    db = initializeFirestore(app, firestoreOptions);
    if (options.logAuthReady !== false) {
      console.log("Firestore: zainicjalizowano nową instancję z opcjami:", firestoreOptions);
    }
  } catch (initError) {
    // Jeśli inicjalizacja nie powiodła się (np. już zainicjalizowany z innymi opcjami),
    // użyj getFirestore() aby pobrać istniejącą instancję
    if (initError.code === 'failed-precondition') {
      console.warn("Firestore: już zainicjalizowany z innymi opcjami, używam getFirestore()");
      db = getFirestore(app);
    } else {
      // Jeśli to inny błąd, rzuć go dalej
      throw initError;
    }
  }

  // SSO: synchronizacja między subdomenami (opcjonalne, można wyłączyć)
  let ssoResult = null;
  if (options.skipSSO !== true) {
    try {
      const { ensureFirebaseSSO } = await import(SSO_CLIENT_MOD);
      ssoResult = await ensureFirebaseSSO(auth);
      if (options.logSSO !== false) {
        console.log("SSO ensure result:", ssoResult);
      }
    } catch (e) {
      console.warn("SSO ensure failed (ignored):", e?.message || e);
    }
  }

  return {
    app,
    auth,
    db,
    ssoResult,
  };
}
