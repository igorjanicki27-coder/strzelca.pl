/**
 * Na subdomenach usług: jeśli kafelek hubu jest wyłączony (siteSettings/homeHub.tiles),
 * przekieruj na stronę główną. Wywołaj na początku modułu głównego (top-level await).
 */
const HUB_HOME = "https://strzelca.pl/";

function documentExists(snap) {
  if (!snap) return false;
  if (typeof snap.exists === "function") return snap.exists();
  return !!snap.exists;
}

export async function redirectIfHubTileDisabled(tileId) {
  if (!tileId || typeof tileId !== "string") return;
  let guardApp = null;
  let deleteAppRef = null;
  try {
    const res = await fetch("https://strzelca.pl/api/firebase-config", { cache: "force-cache" });
    if (!res.ok) return;
    const cfg = await res.json().catch(() => null);
    if (!cfg || typeof cfg.apiKey !== "string" || cfg.apiKey.length < 10) return;

    const appMod = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
    deleteAppRef = appMod.deleteApp;
    const { initializeFirestore, getFirestore, doc, getDoc } = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
    );

    const base = {
      authDomain: (() => { try { const h = window.location.hostname.toLowerCase().replace(/^www\./, ""); return h === "strzelca.pl" || h.endsWith(".strzelca.pl") ? h : "strzelca-pl.firebaseapp.com"; } catch (_) { return "strzelca-pl.firebaseapp.com"; } })(),
      projectId: "strzelca-pl",
      storageBucket: "strzelca-pl.appspot.com",
      messagingSenderId: "511362047688",
      appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
    };

    /** Osobna nazwa — nie koliduje z [DEFAULT] na stronie subdomeny. */
    guardApp = appMod.initializeApp({ apiKey: cfg.apiKey, ...base }, "__strzelcaHubTileGuard");

    let db;
    try {
      db = initializeFirestore(guardApp, {
        experimentalAutoDetectLongPolling: true,
        useFetchStreams: true,
      });
    } catch (e) {
      if (e?.code === "failed-precondition" || String(e?.message || "").includes("already been called")) {
        db = getFirestore(guardApp);
      } else {
        throw e;
      }
    }

    const snap = await getDoc(doc(db, "siteSettings", "homeHub"));
    if (!documentExists(snap)) return;
    const tiles = snap.data()?.tiles;
    if (!tiles || typeof tiles !== "object" || tiles[tileId] !== false) return;

    window.location.replace(HUB_HOME);
    await new Promise(() => {});
  } catch (e) {
    console.warn("[hub-tile-subdomain-guard]", tileId, e?.message || e);
  } finally {
    if (guardApp && deleteAppRef) {
      try {
        await deleteAppRef(guardApp);
      } catch (_) {
        /* już usunięta lub niedostępna */
      }
    }
  }
}
