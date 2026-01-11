// =============================================================================
// SYSTEM ZARZĄDZANIA SESJAMI UŻYTKOWNIKA - strzelca.pl
// =============================================================================
// Ten plik zawiera logikę zarządzania sesjami użytkowników:
// - Śledzenie aktywności użytkownika
// - Automatyczne wylogowanie po czasie bez aktywności
// - Obsługa opcji "Zapamiętaj mnie" (1 tydzień vs 1 godzina)
//
// Wymagania:
// - Bez zaznaczenia "zapamiętaj mnie": wylogowanie po 1 godzinie bez aktywności
// - Z zaznaczeniem "zapamiętaj mnie": wylogowanie po 1 tygodniu bez aktywności
// =============================================================================

class SessionManager {
    constructor() {
        this.lastActivity = Date.now();
        this.checkInterval = 60000; // Sprawdzaj co minutę
        this.rememberMe = false;
        this.sessionTimeout = 2 * 60 * 60 * 1000; // 2 godziny domyślnie (w milisekundach)
        this.rememberMeTimeout = 7 * 24 * 60 * 60 * 1000; // 1 tydzień (w milisekundach)
        this.userId = null;
        this.userEmail = null;
        this.checkIntervalId = null;
        this.activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

        this.init();
    }

    init() {
        // Sprawdź czy użytkownik jest zalogowany
        this.checkAuthState();

        // Rozpocznij śledzenie aktywności
        this.startActivityTracking();

        // Rozpocznij sprawdzanie sesji
        this.startSessionCheck();
    }

    async checkAuthState() {
        try {
            // Import Firebase Auth jeśli nie jest jeszcze załadowany
            if (typeof firebase === 'undefined') {
                await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
                await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            }

            // Sprawdź czy istnieje instancja Firebase
            if (typeof auth === 'undefined') {
                // Jeśli nie ma auth, spróbuj zainicjalizować Firebase
                this.initFirebaseIfNeeded();
            }

            // Sprawdź stan autoryzacji
            const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    // Użytkownik jest zalogowany
                    this.userId = user.uid;
                    this.userEmail = user.email;
                    this.loadSessionSettings();
                    this.startSessionCheck();
                    this.reportActivity('login'); // Zgłoś logowanie
                } else {
                    // Użytkownik nie jest zalogowany
                    this.userId = null;
                    this.userEmail = null;
                    this.stopSessionCheck();
                    this.reportActivity('logout'); // Zgłoś wylogowanie
                }
            });
        } catch (error) {
            console.error('Błąd podczas sprawdzania stanu autoryzacji:', error);
        }
    }

    initFirebaseIfNeeded() {
        // Sprawdź czy Firebase już zostało zainicjalizowane
        if (typeof auth !== 'undefined') return;

        // Konfiguracja Firebase
        const firebaseConfig = {
            apiKey: "AIzaSyD_gXFh3a4NW9Hzzsr5IQuDADM2GVpPMVc",
            authDomain: "strzelca-pl.firebaseapp.com",
            projectId: "strzelca-pl",
            storageBucket: "strzelca-pl.firebasestorage.app",
            messagingSenderId: "511362047688",
            appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
            measurementId: "G-9EJ2R3JPVD"
        };

        // Zainicjalizuj Firebase jeśli nie zostało jeszcze zrobione
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        // Zainicjalizuj Auth
        auth = firebase.auth();
    }

    loadSessionSettings() {
        // Sprawdź ustawienia sesji z localStorage
        const rememberMeSetting = localStorage.getItem('strzelca_remember_me');
        this.rememberMe = rememberMeSetting === 'true';

        // Ustaw odpowiedni timeout
        this.sessionTimeout = this.rememberMe ? this.rememberMeTimeout : (2 * 60 * 60 * 1000); // 2 godziny domyślnie

        console.log(`Sesja użytkownika: ${this.rememberMe ? 'Zapamiętaj mnie (1 tydzień)' : 'Standardowa (2 godziny)'}`);
    }

    startActivityTracking() {
        // Funkcja aktualizacji aktywności
        const updateActivity = () => {
            this.lastActivity = Date.now();
            this.reportActivity('page_interaction');
        };

        // Dodaj event listenery dla wszystkich zdarzeń aktywności
        this.activityEvents.forEach(event => {
            document.addEventListener(event, updateActivity, { passive: true });
        });

        // Aktualizuj aktywność przy załadowaniu strony
        updateActivity();

        // Dodaj throttle do wysyłania aktywności (co najwyżej raz na 5 sekund)
        this.lastActivityReport = 0;
        this.activityThrottleMs = 5000;
    }

    startSessionCheck() {
        // Zatrzymaj poprzednie sprawdzanie jeśli istnieje
        this.stopSessionCheck();

        // Rozpocznij sprawdzanie co minutę
        this.checkIntervalId = setInterval(() => {
            this.checkSessionTimeout();
        }, this.checkInterval);
    }

    stopSessionCheck() {
        if (this.checkIntervalId) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
        }
    }

    // Metoda zgłaszania aktywności użytkownika do API
    async reportActivity(action = 'page_view', additionalData = {}) {
        if (!this.userId) return;

        // Throttle wysyłania aktywności
        const now = Date.now();
        if (now - this.lastActivityReport < this.activityThrottleMs) {
            return;
        }
        this.lastActivityReport = now;

        try {
            const activityData = {
                userId: this.userId,
                userEmail: this.userEmail,
                action: action,
                path: window.location.pathname,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                ...additionalData
            };

            // Wyślij do API
            const response = await fetch('/api/user-activity', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(activityData)
            });

            if (!response.ok) {
                console.warn('Failed to report user activity:', response.status);
            }
        } catch (error) {
            console.warn('Error reporting user activity:', error);
        }
    }

    checkSessionTimeout() {
        const now = Date.now();
        const timeSinceLastActivity = now - this.lastActivity;

        if (timeSinceLastActivity >= this.sessionTimeout) {
            console.log(`Sesja wygasła. Czas bez aktywności: ${Math.round(timeSinceLastActivity / 1000 / 60)} minut`);
            this.logoutUser();
        }
    }

    async logoutUser() {
        try {
            // Zatrzymaj sprawdzanie sesji
            this.stopSessionCheck();

            // Wyloguj użytkownika z Firebase
            if (typeof auth !== 'undefined') {
                await auth.signOut();
            }

            // Wyczyść ustawienia sesji
            localStorage.removeItem('strzelca_remember_me');

            // Przekieruj do strony logowania
            if (window.location.pathname.includes('/konto.strzelca.pl/') &&
                !window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            } else {
                window.location.href = 'https://konto.strzelca.pl/login.html';
            }

        } catch (error) {
            console.error('Błąd podczas wylogowywania:', error);
        }
    }

    // Metoda do ręcznego ustawiania ustawień sesji (wywoływana z login.html)
    setSessionSettings(rememberMe) {
        this.rememberMe = rememberMe;
        this.sessionTimeout = rememberMe ? this.rememberMeTimeout : (2 * 60 * 60 * 1000); // 2 godziny domyślnie

        // Zapisz ustawienia w localStorage
        localStorage.setItem('strzelca_remember_me', rememberMe.toString());

        console.log(`Sesja użytkownika: ${this.rememberMe ? 'Zapamiętaj mnie (1 tydzień)' : 'Standardowa (2 godziny)'}`);
    }

    // Metoda do rozszerzenia sesji (np. przy aktywności)
    extendSession() {
        this.lastActivity = Date.now();
    }

    // Metoda do sprawdzenia pozostałego czasu sesji
    getRemainingTime() {
        const now = Date.now();
        const timeSinceLastActivity = now - this.lastActivity;
        return Math.max(0, this.sessionTimeout - timeSinceLastActivity);
    }

    // Metoda do formatowania pozostałego czasu
    getRemainingTimeFormatted() {
        const remaining = this.getRemainingTime();
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}min`;
        } else {
            return `${minutes}min`;
        }
    }
}

// =============================================================================
// GLOBALNA INSTANCJA SESSION MANAGERA
// =============================================================================
let sessionManager = null;

// Funkcja inicjalizacji (wywołaj w każdej stronie)
function initSessionManager() {
    if (!sessionManager) {
        sessionManager = new SessionManager();
    }
    return sessionManager;
}

// Funkcja pomocnicza do ustawiania ustawień sesji podczas logowania
function setSessionSettings(rememberMe) {
    if (sessionManager) {
        sessionManager.setSessionSettings(rememberMe);
    }
}

// Eksport dla modułów ES6
export { SessionManager, initSessionManager, setSessionSettings };

// Automatyczna inicjalizacja dla stron bez ES6 modules
if (typeof window !== 'undefined') {
    // Inicjalizuj gdy DOM jest gotowy
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSessionManager);
    } else {
        initSessionManager();
    }
}

