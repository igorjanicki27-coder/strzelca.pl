/**
 * Moduł śledzenia aktywności użytkowników
 * - lastSeen w Firestore: heartbeat co kilka minut + oznaczenie „offline” przy wyjściu (jak guestPresence)
 * - sendBeacon na pagehide z leave: true (wymaga ciasteczka SSO na .strzelca.pl)
 *
 * Użycie:
 *   import { initActivityTracker } from "https://strzelca.pl/activity-tracker.mjs?v=2026-03-21-2";
 *   await initActivityTracker(auth, db);
 */

const USER_PRESENCE_HEARTBEAT_MS = 3 * 60 * 1000;
const UPDATE_LAST_SEEN_URL = "https://strzelca.pl/api/update-last-seen";

let activityTrackingInterval = null;
let currentUser = null;
let db = null;
let pagehideHandler = null;

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
      new Blob([payload], { type: "application/json" })
    );
  } catch (e) {
    // ignoruj
  }
}

/**
 * Rozpocznij śledzenie aktywności
 */
function startActivityTracking() {
  if (activityTrackingInterval) {
    clearInterval(activityTrackingInterval);
    activityTrackingInterval = null;
  }
  if (pagehideHandler) {
    window.removeEventListener("pagehide", pagehideHandler);
    pagehideHandler = null;
  }

  updateLastSeen();

  activityTrackingInterval = setInterval(() => {
    updateLastSeen();
  }, USER_PRESENCE_HEARTBEAT_MS);

  pagehideHandler = () => {
    sendLeaveBeacon();
  };
  window.addEventListener("pagehide", pagehideHandler);
}

/**
 * Zatrzymaj śledzenie aktywności (np. wylogowanie) — sygnał „offline” dla panelu
 */
function stopActivityTracking() {
  sendLeaveBeacon();
  if (pagehideHandler) {
    window.removeEventListener("pagehide", pagehideHandler);
    pagehideHandler = null;
  }
  if (activityTrackingInterval) {
    clearInterval(activityTrackingInterval);
    activityTrackingInterval = null;
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
              new Date(Date.now() - 35 * 60 * 1000)
            ),
          });
        } catch (e) {
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
  await updateLastSeen();
}
