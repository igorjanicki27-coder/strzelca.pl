/**
 * Wspólny moduł inicjalizacji autoryzacji Firebase
 * - ujednolicona inicjalizacja dla wszystkich stron
 * - optymalizacja: zawsze czeka na authStateReady przed SSO
 * - cache i optymalizacja requestów
 * 
 * Użycie:
 *   import { initAuth } from "https://strzelca.pl/auth-init.mjs?v=2026-02-06-2";
 *   const { auth, db } = await initAuth(firebaseConfig);
 */

export async function initAuth(firebaseConfig, options = {}) {
  const {
    initializeApp,
    getApps,
  } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
  
  const {
    getAuth,
    setPersistence,
    browserLocalPersistence,
  } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");

  const {
    initializeFirestore,
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
  const firestoreOptions = options.firestore || {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: true,
  };
  
  const db = initializeFirestore(app, firestoreOptions);

  // SSO: synchronizacja między subdomenami (opcjonalne, można wyłączyć)
  let ssoResult = null;
  if (options.skipSSO !== true) {
    try {
      const { ensureFirebaseSSO } = await import("https://strzelca.pl/sso-client.mjs?v=2026-02-06-1");
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
