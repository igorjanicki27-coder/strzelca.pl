/**
 * Moduł śledzenia odwiedzin dla wszystkich użytkowników (zalogowanych i niezalogowanych)
 * - zapisuje odwiedziny w Firestore w kolekcji "visits"
 * - unika wielokrotnego liczenia tego samego użytkownika w tym samym dniu (używając localStorage)
 * - działa dla zalogowanych i niezalogowanych użytkowników
 * 
 * Użycie:
 *   import { initVisitTracker } from "https://strzelca.pl/visit-tracker.mjs?v=2026-03-21-2";
 *   await initVisitTracker();
 */

/** Dzisiejszy dzień w strefie lokalnej (spójnie z panelem admina) */
function localCalendarDayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readVisitDayCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)strzelca_visit_day=([^;]*)/);
    return m ? decodeURIComponent(m[1].trim()) : null;
  } catch {
    return null;
  }
}

function writeVisitDayCookie(dayKey) {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `strzelca_visit_day=${encodeURIComponent(dayKey)}; Path=/; Domain=.strzelca.pl; Max-Age=90000; SameSite=Lax${secure}`;
  } catch {
    // np. plik lokalny / nieobsługiwany domain
  }
}

/**
 * Generuje unikalny identyfikator użytkownika (dla niezalogowanych)
 */
function generateVisitorId() {
  let visitorId = localStorage.getItem('visitorId');
  if (!visitorId) {
    // Generuj unikalny ID na podstawie różnych czynników
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('visitor-fingerprint', 2, 2);
    
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvas.toDataURL()
    ].join('|');
    
    // Prosty hash
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    visitorId = 'visitor_' + Math.abs(hash).toString(36);
    localStorage.setItem('visitorId', visitorId);
  }
  return visitorId;
}

/**
 * Sprawdza, czy odwiedzina dzisiaj została już zarejestrowana.
 * Cookie Domain=.strzelca.pl współdzielone między subdomenami; localStorage — zapas per-origin.
 */
function hasVisitedToday() {
  const today = localCalendarDayKey();
  const cookieDay = readVisitDayCookie();
  if (cookieDay === today) return true;
  const lastVisitDate = localStorage.getItem("lastVisitDate");
  return lastVisitDate === today;
}

/**
 * Zaznacza, że odwiedzina dzisiaj została zarejestrowana
 */
function markVisitedToday() {
  const today = localCalendarDayKey();
  localStorage.setItem("lastVisitDate", today);
  writeVisitDayCookie(today);
}

/**
 * Wysyła informację o odwiedzinie do API
 */
async function trackVisit(userId = null) {
  console.log('[Visit Tracker] trackVisit called', { userId, hasVisitedToday: hasVisitedToday() });
  
  // Sprawdź, czy już zarejestrowaliśmy odwiedzinę dzisiaj
  if (hasVisitedToday()) {
    console.log('[Visit Tracker] Visit already tracked today, skipping');
    return; // Już zarejestrowano odwiedzinę dzisiaj
  }
  
  // Dla zalogowanych użytkowników visitorId powinien być null
  // Dla niezalogowanych generujemy visitorId
  const visitorId = userId ? null : generateVisitorId();
  const pageUrl = window.location.href;
  const pageTitle = document.title;
  const referrer = document.referrer || '';
  
  console.log('[Visit Tracker] Sending visit data to API', { userId, visitorId, pageUrl });
  
  try {
    const response = await fetch("https://strzelca.pl/api/track-visit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        userId: userId,
        visitorId: visitorId,
        pageUrl: pageUrl,
        pageTitle: pageTitle,
        referrer: referrer,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      }),
      keepalive: true,
    });
    
    if (response.ok) {
      const result = await response.json();
      markVisitedToday();
      console.log('[Visit Tracker] Visit tracked successfully', { userId, visitorId, result });
    } else {
      const errorText = await response.text();
      console.warn('[Visit Tracker] Failed to track visit:', response.status, errorText);
    }
  } catch (error) {
    console.warn('[Visit Tracker] Error tracking visit:', error);
    // Nie rzucaj błędu - odwiedziny nie są krytyczne
  }
}

/** Okres odświeżania obecności (panel admina liczy „online” wg timestamp w ~30 min) */
const GUEST_PRESENCE_HEARTBEAT_MS = 3 * 60 * 1000;

let guestHeartbeatInterval = null;
let guestPagehideHandler = null;
let guestAuthUnsubscribe = null;
let guestPresenceSessionActive = false;

function stopGuestHeartbeatSession(sendLeave) {
  const shouldBeaconLeave = sendLeave && guestPresenceSessionActive;
  guestPresenceSessionActive = false;

  if (guestHeartbeatInterval !== null) {
    clearInterval(guestHeartbeatInterval);
    guestHeartbeatInterval = null;
  }
  if (guestPagehideHandler) {
    window.removeEventListener('pagehide', guestPagehideHandler);
    guestPagehideHandler = null;
  }
  if (guestAuthUnsubscribe) {
    guestAuthUnsubscribe();
    guestAuthUnsubscribe = null;
  }

  if (shouldBeaconLeave) {
    try {
      const visitorId = localStorage.getItem('visitorId');
      if (visitorId && navigator.sendBeacon) {
        const payload = JSON.stringify({
          visitorId,
          leave: true,
          userAgent: navigator.userAgent,
        });
        navigator.sendBeacon(
          'https://strzelca.pl/api/ping-activity',
          new Blob([payload], { type: 'application/json' })
        );
      }
    } catch (e) {
      // ignoruj przy zamykaniu karty
    }
  }
}

async function sendGuestPresencePing() {
  const visitorId = generateVisitorId();
  console.log('[Visit Tracker] Guest presence heartbeat...', { visitorId });
  try {
    const response = await fetch("https://strzelca.pl/api/ping-activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        visitorId,
        userAgent: navigator.userAgent,
      }),
      keepalive: true,
    });
    if (!response.ok) {
      console.warn('[Visit Tracker] Guest presence ping failed:', response.status);
    }
  } catch (error) {
    console.warn('[Visit Tracker] Error pinging guest activity:', error);
  }
}

/**
 * Heartbeat gościa + usunięcie wpisu przy wyjściu (pagehide / logowanie).
 * Zalogowani: lastSeen + heartbeat w activity-tracker.mjs (nie guestPresence).
 */
async function startGuestHeartbeatSession(userId, auth) {
  if (userId) return;

  stopGuestHeartbeatSession(false);
  guestPresenceSessionActive = true;

  await sendGuestPresencePing();

  guestHeartbeatInterval = setInterval(() => {
    sendGuestPresencePing();
  }, GUEST_PRESENCE_HEARTBEAT_MS);

  guestPagehideHandler = () => {
    stopGuestHeartbeatSession(true);
  };
  window.addEventListener('pagehide', guestPagehideHandler);

  if (auth) {
    try {
      const { onAuthStateChanged } = await import(
        'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
      );
      guestAuthUnsubscribe = onAuthStateChanged(auth, (user) => {
        if (user && guestPresenceSessionActive) {
          stopGuestHeartbeatSession(true);
        }
      });
    } catch (error) {
      console.warn('[Visit Tracker] Auth listener for guest presence failed:', error);
    }
  }
}

/**
 * Inicjalizuje śledzenie odwiedzin
 * @param {Object} auth - Firebase Auth instance (opcjonalne, dla zalogowanych użytkowników)
 */
export async function initVisitTracker(auth = null) {
  console.log('[Visit Tracker] Initializing visit tracker...', { hasAuth: !!auth });
  // Poczekaj, aż strona się załaduje
  const run = () =>
    handleVisitTracking(auth).catch((err) =>
      console.warn('[Visit Tracker] handleVisitTracking failed:', err)
    );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[Visit Tracker] DOM loaded, starting tracking...');
      run();
    });
  } else {
    console.log('[Visit Tracker] DOM already loaded, starting tracking...');
    run();
  }
}

/**
 * Obsługuje śledzenie odwiedzin
 */
async function handleVisitTracking(auth) {
  console.log('[Visit Tracker] handleVisitTracking called', { hasAuth: !!auth, currentUser: auth?.currentUser?.uid });
  let userId = null;
  let visitTracked = false;
  
  // Jeśli użytkownik jest zalogowany, poczekaj na stan autoryzacji
  if (auth) {
    try {
      console.log('[Visit Tracker] Auth provided, checking auth state...');
      const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
      
      // Sprawdź najpierw aktualny stan autoryzacji (dla użytkowników już zalogowanych)
      if (auth.currentUser) {
        userId = auth.currentUser.uid;
        console.log('[Visit Tracker] User already logged in:', userId);
        visitTracked = true;
        await trackVisit(userId);
      } else {
        console.log('[Visit Tracker] No current user, waiting for auth state change...');
        // Jeśli currentUser jest null, poczekaj na pierwsze wywołanie onAuthStateChanged
        const authStatePromise = new Promise((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, async (user) => {
            userId = user ? user.uid : null;
            console.log('[Visit Tracker] Auth state changed:', userId);
            
            // Śledź odwiedzinę tylko jeśli jeszcze nie została zarejestrowana
            if (!visitTracked) {
              visitTracked = true;
              await trackVisit(userId);
            }
            
            // Rozwiąż Promise po pierwszym wywołaniu
            resolve(userId);
          });
        });
        
        // Poczekaj maksymalnie 2 sekundy na stan autoryzacji
        await Promise.race([
          authStatePromise,
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        
        // Jeśli po 2 sekundach nadal nie mamy userId, śledź jako niezalogowany
        if (!visitTracked) {
          console.log('[Visit Tracker] Timeout waiting for auth, tracking as visitor');
          visitTracked = true;
          await trackVisit(null);
        }
      }
    } catch (error) {
      console.warn('[Visit Tracker] Could not initialize auth state listener:', error);
      // Jeśli wystąpił błąd, śledź jako niezalogowany
      if (!visitTracked) {
        visitTracked = true;
        await trackVisit(null);
      }
    }
  } else {
    // Dla niezalogowanych użytkowników, śledź od razu
    console.log('[Visit Tracker] No auth provided, tracking as visitor');
    visitTracked = true;
    await trackVisit(null);
  }
  
  // Gość: heartbeat co kilka minut + skasowanie obecności przy zamknięciu / zalogowaniu
  await startGuestHeartbeatSession(userId, auth);
  
  // Przy zamknięciu karty: fetch + keepalive + credentials (sendBeacon bez credentials nie wysyła ciasteczek SSO między originami)
  window.addEventListener("beforeunload", () => {
    if (!hasVisitedToday()) {
      const vid = userId ? null : generateVisitorId();
      const pageUrl = window.location.href;
      const pageTitle = document.title;
      const referrer = document.referrer || "";
      try {
        fetch("https://strzelca.pl/api/track-visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          keepalive: true,
          body: JSON.stringify({
            userId: userId,
            visitorId: vid,
            pageUrl,
            pageTitle,
            referrer,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          }),
        }).then(
          (r) => {
            if (r.ok) markVisitedToday();
          },
          () => {}
        );
      } catch {
        // Ignoruj przy zamykaniu
      }
    }
  });
}
