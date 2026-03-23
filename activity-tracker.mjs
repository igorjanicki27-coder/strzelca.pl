/**
 * Moduł śledzenia aktywności użytkowników
 * - lastSeen w Firestore: heartbeat co kilkanaście minut + oznaczenie „offline” przy wyjściu
 * - leader-tab: tylko jedna karta przeglądarki wysyła heartbeat (redukcja write'ów)
 * - sendBeacon na pagehide z leave: true (wymaga ciasteczka SSO na .strzelca.pl)
 *
 * Użycie:
 *   import { initActivityTracker } from "https://strzelca.pl/activity-tracker.mjs?v=2026-03-23-1";
 *   await initActivityTracker(auth, db);
 */

const USER_PRESENCE_HEARTBEAT_MS = 15 * 60 * 1000;
const LEADER_RENEW_MS = 15 * 1000;
const LEADER_LEASE_MS = 45 * 1000;
const LEADER_LOCK_KEY = "strzelca_presence_user_leader_v1";
const UPDATE_LAST_SEEN_URL = "https://strzelca.pl/api/update-last-seen";
const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let activityTrackingInterval = null;
let leaderRenewInterval = null;
let currentUser = null;
let db = null;
let pagehideHandler = null;
let visibilityHandler = null;

function nowMs() {
  return Date.now();
}

function isPageVisible() {
  try {
    return document.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

function readLeaderLease() {
  try {
    const raw = localStorage.getItem(LEADER_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.tabId !== "string" || typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLeaderLease(expiresAt) {
  try {
    localStorage.setItem(
      LEADER_LOCK_KEY,
      JSON.stringify({
        tabId: TAB_ID,
        expiresAt,
      }),
    );
  } catch {
    // ignore
  }
}

function renewPresenceLeadership() {
  const lease = readLeaderLease();
  const now = nowMs();

  if (!lease || lease.expiresAt <= now || lease.tabId === TAB_ID) {
    writeLeaderLease(now + LEADER_LEASE_MS);
    return true;
  }
  return false;
}

function releasePresenceLeadership() {
  try {
    const lease = readLeaderLease();
    if (lease?.tabId === TAB_ID) {
      localStorage.removeItem(LEADER_LOCK_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Funkcja aktualizacji lastSeen w Firestore
 */
async function updateLastSeen() {
  if (!currentUser || !db) return;

  try {
    const { doc, updateDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
    );

    await updateDoc(doc(db, "userProfiles", currentUser.uid), {
      lastSeen: serverTimestamp(),
    });

    const activityData = {
      lastSeen: Date.now(),
      synced: true,
    };
    localStorage.setItem("userActivity", JSON.stringify(activityData));
  } catch (error) {
    console.warn("Could not update lastSeen:", error);
    const activityData = {
      lastSeen: Date.now(),
      synced: false,
    };
    localStorage.setItem("userActivity", JSON.stringify(activityData));
  }
}

function sendLeaveBeacon() {
  if (!currentUser) return;
  try {
    if (!navigator.sendBeacon) return;
    const payload = JSON.stringify({
      userId: currentUser.uid,
      leave: true,
    });
    navigator.sendBeacon(
      UPDATE_LAST_SEEN_URL,
      new Blob([payload], { type: "application/json" }),
    );
  } catch {
    // ignoruj
  }
}

function ensureLeaderAndVisible() {
  if (!isPageVisible()) return false;
  return renewPresenceLeadership();
}

/**
 * Rozpocznij śledzenie aktywności
 */
function startActivityTracking() {
  if (activityTrackingInterval) {
    clearInterval(activityTrackingInterval);
    activityTrackingInterval = null;
  }
  if (leaderRenewInterval) {
    clearInterval(leaderRenewInterval);
    leaderRenewInterval = null;
  }
  if (pagehideHandler) {
    window.removeEventListener("pagehide", pagehideHandler);
    pagehideHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }

  leaderRenewInterval = setInterval(() => {
    if (isPageVisible()) renewPresenceLeadership();
  }, LEADER_RENEW_MS);

  if (ensureLeaderAndVisible()) {
    void updateLastSeen();
  }

  activityTrackingInterval = setInterval(() => {
    if (!ensureLeaderAndVisible()) return;
    void updateLastSeen();
  }, USER_PRESENCE_HEARTBEAT_MS);

  pagehideHandler = () => {
    if (renewPresenceLeadership()) {
      sendLeaveBeacon();
    }
    releasePresenceLeadership();
  };
  window.addEventListener("pagehide", pagehideHandler);

  visibilityHandler = () => {
    if (document.visibilityState !== "visible") return;
    if (!renewPresenceLeadership()) return;
    void updateLastSeen();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

/**
 * Zatrzymaj śledzenie aktywności (np. wylogowanie) — sygnał „offline” dla panelu
 */
function stopActivityTracking() {
  if (renewPresenceLeadership()) {
    sendLeaveBeacon();
  }
  releasePresenceLeadership();

  if (pagehideHandler) {
    window.removeEventListener("pagehide", pagehideHandler);
    pagehideHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (activityTrackingInterval) {
    clearInterval(activityTrackingInterval);
    activityTrackingInterval = null;
  }
  if (leaderRenewInterval) {
    clearInterval(leaderRenewInterval);
    leaderRenewInterval = null;
  }
}

/**
 * Inicjalizacja śledzenia aktywności
 * @param {Object} auth - Firebase Auth instance
 * @param {Object} firestoreDb - Firestore database instance
 */
export async function initActivityTracker(auth, firestoreDb) {
  db = firestoreDb;

  const { onAuthStateChanged } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
  );
  const { doc, updateDoc, Timestamp } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );

  onAuthStateChanged(auth, async (user) => {
    stopActivityTracking();

    if (user) {
      currentUser = user;
      startActivityTracking();
    } else {
      if (currentUser && db) {
        try {
          await updateDoc(doc(db, "userProfiles", currentUser.uid), {
            lastSeen: Timestamp.fromDate(
              new Date(Date.now() - 35 * 60 * 1000),
            ),
          });
        } catch {
          // Ignoruj błędy przy wylogowaniu
        }
      }
      currentUser = null;
    }
  });
}

/**
 * Ręczna aktualizacja lastSeen (do użycia przy ważnych akcjach)
 */
export async function updateActivity() {
  if (!ensureLeaderAndVisible()) return;
  await updateLastSeen();
}
