/**
 * Moduł śledzenia odwiedzin dla wszystkich użytkowników (zalogowanych i niezalogowanych)
 * - zapisuje odwiedziny w Firestore w kolekcji "visits"
 * - unika wielokrotnego liczenia tego samego użytkownika w tym samym dniu (używając localStorage)
 * - działa dla zalogowanych i niezalogowanych użytkowników
 * 
 * Użycie:
 *   import { initVisitTracker } from "https://strzelca.pl/visit-tracker.mjs?v=2026-02-06-1";
 *   await initVisitTracker();
 */

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
 * Sprawdza, czy odwiedzina dzisiaj została już zarejestrowana
 */
function hasVisitedToday() {
  const lastVisitDate = localStorage.getItem('lastVisitDate');
  const today = new Date().toDateString();
  return lastVisitDate === today;
}

/**
 * Zaznacza, że odwiedzina dzisiaj została zarejestrowana
 */
function markVisitedToday() {
  const today = new Date().toDateString();
  localStorage.setItem('lastVisitDate', today);
}

/**
 * Wysyła informację o odwiedzinie do API
 */
async function trackVisit(userId = null) {
  // Sprawdź, czy już zarejestrowaliśmy odwiedzinę dzisiaj
  if (hasVisitedToday()) {
    return; // Już zarejestrowano odwiedzinę dzisiaj
  }
  
  const visitorId = userId || generateVisitorId();
  const pageUrl = window.location.href;
  const pageTitle = document.title;
  const referrer = document.referrer || '';
  
  try {
    const response = await fetch('https://strzelca.pl/api/track-visit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: userId,
        visitorId: visitorId,
        pageUrl: pageUrl,
        pageTitle: pageTitle,
        referrer: referrer,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      }),
      // Użyj keepalive dla lepszej niezawodności
      keepalive: true
    });
    
    if (response.ok) {
      markVisitedToday();
      console.log('Visit tracked successfully');
    } else {
      console.warn('Failed to track visit:', response.status);
    }
  } catch (error) {
    console.warn('Error tracking visit:', error);
    // Nie rzucaj błędu - odwiedziny nie są krytyczne
  }
}

/**
 * Inicjalizuje śledzenie odwiedzin
 * @param {Object} auth - Firebase Auth instance (opcjonalne, dla zalogowanych użytkowników)
 */
export async function initVisitTracker(auth = null) {
  // Poczekaj, aż strona się załaduje
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      handleVisitTracking(auth);
    });
  } else {
    handleVisitTracking(auth);
  }
}

/**
 * Obsługuje śledzenie odwiedzin
 */
async function handleVisitTracking(auth) {
  let userId = null;
  
  // Jeśli użytkownik jest zalogowany, pobierz jego ID
  if (auth) {
    try {
      const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
      onAuthStateChanged(auth, async (user) => {
        userId = user ? user.uid : null;
        // Śledź odwiedzinę po zmianie stanu autoryzacji
        await trackVisit(userId);
      });
    } catch (error) {
      console.warn('Could not initialize auth state listener:', error);
    }
  }
  
  // Śledź odwiedzinę od razu (dla niezalogowanych lub jeśli auth nie jest dostępne)
  if (!auth) {
    await trackVisit(null);
  } else {
    // Sprawdź aktualny stan autoryzacji
    try {
      const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
      const currentAuth = auth || getAuth();
      if (currentAuth.currentUser) {
        userId = currentAuth.currentUser.uid;
      }
      await trackVisit(userId);
    } catch (error) {
      // Jeśli nie ma auth, śledź jako niezalogowany
      await trackVisit(null);
    }
  }
  
  // Śledź również przy zamknięciu strony (sendBeacon dla niezawodności)
  window.addEventListener('beforeunload', () => {
    if (!hasVisitedToday()) {
      const visitorId = userId || generateVisitorId();
      const pageUrl = window.location.href;
      const pageTitle = document.title;
      const referrer = document.referrer || '';
      
      try {
        navigator.sendBeacon && navigator.sendBeacon(
          'https://strzelca.pl/api/track-visit',
          JSON.stringify({
            userId: userId,
            visitorId: visitorId,
            pageUrl: pageUrl,
            pageTitle: pageTitle,
            referrer: referrer,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
          })
        );
        markVisitedToday();
      } catch (e) {
        // Ignoruj błędy przy zamykaniu
      }
    }
  });
}
