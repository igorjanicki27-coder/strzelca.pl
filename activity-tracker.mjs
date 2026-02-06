/**
 * Moduł śledzenia aktywności użytkowników
 * - automatyczne aktualizowanie lastSeen w Firestore
 * - interwał 15 minutowy
 * - śledzenie lokalne w localStorage
 * 
 * Użycie:
 *   import { initActivityTracker } from "https://strzelca.pl/activity-tracker.mjs?v=2026-02-06-1";
 *   await initActivityTracker(auth, db);
 */

let activityTrackingInterval = null;
let lastActivitySync = 0;
let currentUser = null;
let db = null;

/**
 * Funkcja aktualizacji lastSeen w Firestore
 */
async function updateLastSeen() {
  if (!currentUser || !db) return;
  
  try {
    const { doc, updateDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    
    await updateDoc(doc(db, "userProfiles", currentUser.uid), {
      lastSeen: serverTimestamp()
    });
    
    // Zaktualizuj localStorage
    const activityData = {
      lastSeen: Date.now(),
      synced: true
    };
    localStorage.setItem('userActivity', JSON.stringify(activityData));
    lastActivitySync = Date.now();
  } catch (error) {
    console.warn("Could not update lastSeen:", error);
    // Zapisuj lokalnie nawet jeśli Firestore nie działa
    const activityData = {
      lastSeen: Date.now(),
      synced: false
    };
    localStorage.setItem('userActivity', JSON.stringify(activityData));
  }
}

/**
 * Funkcja śledzenia aktywności lokalnie
 */
function trackLocalActivity() {
  const activityData = {
    lastSeen: Date.now(),
    synced: false
  };
  localStorage.setItem('userActivity', JSON.stringify(activityData));
}

/**
 * Funkcja synchronizacji aktywności (co 15 minut)
 */
async function syncActivity() {
  if (!currentUser || !db) return;
  
  // Pobierz dane z localStorage
  const storedActivity = localStorage.getItem('userActivity');
  if (!storedActivity) {
    trackLocalActivity();
    return;
  }
  
  try {
    const activityData = JSON.parse(storedActivity);
    const timeSinceLastSeen = Date.now() - activityData.lastSeen;
    
    // Synchronizuj tylko jeśli użytkownik był aktywny w ostatnich 30 sekundach
    // lub jeśli nie synchronizowaliśmy od dłuższego czasu
    const timeSinceLastSync = Date.now() - lastActivitySync;
    
    if (timeSinceLastSeen < 30000 || timeSinceLastSync > 900000) { // 30 sekund lub 15 minut
      await updateLastSeen();
    }
  } catch (error) {
    console.warn("Error syncing activity:", error);
  }
}

/**
 * Rozpocznij śledzenie aktywności
 */
function startActivityTracking() {
  if (activityTrackingInterval) {
    clearInterval(activityTrackingInterval);
  }
  
  // Aktualizuj od razu przy starcie
  updateLastSeen();
  
  // Synchronizuj co 15 minut (900000 ms)
  activityTrackingInterval = setInterval(() => {
    syncActivity();
  }, 900000);
  
  // Śledź aktywność przy interakcjach użytkownika
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  events.forEach(event => {
    document.addEventListener(event, () => {
      trackLocalActivity();
    }, { passive: true });
  });
}

/**
 * Zatrzymaj śledzenie aktywności
 */
function stopActivityTracking() {
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
  
  // Obserwuj zmiany stanu autoryzacji
  const { onAuthStateChanged, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
  const { doc, updateDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
  
  onAuthStateChanged(auth, async (user) => {
    // Zatrzymaj poprzednie śledzenie
    stopActivityTracking();
    
    if (user) {
      currentUser = user;
      // Rozpocznij śledzenie dla nowego użytkownika
      startActivityTracking();
    } else {
      // Ostatnia aktualizacja przed wylogowaniem
      if (currentUser && db) {
        try {
          await updateDoc(doc(db, "userProfiles", currentUser.uid), {
            lastSeen: serverTimestamp()
          });
        } catch (e) {
          // Ignoruj błędy przy wylogowaniu
        }
      }
      currentUser = null;
    }
  });
  
  // Obsługa przed zamknięciem strony
  window.addEventListener('beforeunload', () => {
    if (currentUser && db) {
      // Ostatnia aktualizacja przed zamknięciem
      try {
        navigator.sendBeacon && navigator.sendBeacon(
          '/api/update-last-seen',
          JSON.stringify({ userId: currentUser.uid })
        );
      } catch (e) {
        // Ignoruj błędy
      }
    }
  });
}

/**
 * Ręczna aktualizacja lastSeen (do użycia przy ważnych akcjach)
 */
export async function updateActivity() {
  await updateLastSeen();
}
