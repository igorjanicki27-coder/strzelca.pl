/**
 * Moduł monitorujący status użytkownika w czasie rzeczywistym
 * Wylogowuje użytkownika natychmiast po zablokowaniu konta
 */

let statusUnsubscribe = null;
let isBlockedModalShown = false; // Flaga zapobiegająca wielokrotnemu wyświetlaniu modala

/**
 * Inicjalizuje monitorowanie statusu użytkownika
 * @param {Object} auth - Firebase Auth instance
 * @param {Object} db - Firestore instance
 */
export async function initUserStatusMonitor(auth, db) {
  const { onAuthStateChanged, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
  const { doc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

  // Nasłuchuj zmian stanu autoryzacji
  onAuthStateChanged(auth, async (user) => {
    // Jeśli modal jest już wyświetlony, nie uruchamiaj nowego listenera
    if (isBlockedModalShown) {
      return;
    }

    // Zatrzymaj poprzedni listener jeśli istnieje
    if (statusUnsubscribe) {
      statusUnsubscribe();
      statusUnsubscribe = null;
    }

    if (!user) {
      return;
    }

    // Rozpocznij monitorowanie statusu użytkownika w Firestore
    try {
      const userProfileRef = doc(db, "userProfiles", user.uid);
      
      statusUnsubscribe = onSnapshot(
        userProfileRef,
        async (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }

          const userData = snapshot.data();
          
          // Sprawdź czy użytkownik jest zablokowany
          if (userData.status === "blocked") {
            // Jeśli modal jest już wyświetlony, nie wykonuj ponownie akcji
            if (isBlockedModalShown) {
              return;
            }

            // Sprawdź czy blokada nie wygasła
            let blockedUntil = null;
            if (userData.blockedUntil) {
              blockedUntil = userData.blockedUntil.toDate ? userData.blockedUntil.toDate() : new Date(userData.blockedUntil);
            }

            // Jeśli blokada wygasła, odblokuj konto
            if (blockedUntil && blockedUntil <= new Date() && !userData.isPermanentBlock) {
              const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
              try {
                await updateDoc(userProfileRef, {
                  status: "active",
                  blockedUntil: null,
                  blockDuration: null,
                  isPermanentBlock: null,
                  unblockedAt: new Date(),
                });
                console.log("Konto zostało automatycznie odblokowane po wygaśnięciu blokady.");
                return;
              } catch (error) {
                console.error("Błąd podczas automatycznego odblokowania konta:", error);
              }
            }

            // Jeśli użytkownik jest zablokowany, pokaż modal i zablokuj stronę
            console.log("Użytkownik został zablokowany - wyświetlanie komunikatu...");
            
            // Ustaw flagę, aby zapobiec wielokrotnemu wyświetlaniu
            isBlockedModalShown = true;
            
            // Zatrzymaj listener - nie potrzebujemy już monitorować zmian
            if (statusUnsubscribe) {
              statusUnsubscribe();
              statusUnsubscribe = null;
            }

            // Pokaż komunikat o blokadzie
            const blockReason = userData.blockReason || "Nie podano powodu";
            let blockMessage = `Twoje konto zostało zablokowane.\n\nPowód: ${blockReason}`;
            
            if (blockedUntil && blockedUntil > new Date()) {
              blockMessage += `\n\nBlokada obowiązuje do: ${blockedUntil.toLocaleDateString("pl-PL")} ${blockedUntil.toLocaleTimeString("pl-PL")}`;
            } else if (!blockedUntil) {
              blockMessage += "\n\nBlokada jest permanentna.";
            }

            // Pokaż modal z informacją o blokadzie (zablokuje stronę)
            showBlockedAccountModal(blockMessage, auth);
          }
        },
        (error) => {
          console.error("Błąd podczas monitorowania statusu użytkownika:", error);
        }
      );
    } catch (error) {
      console.error("Błąd podczas inicjalizacji monitorowania statusu użytkownika:", error);
    }
  });
}

/**
 * Wyświetla modal z informacją o zablokowanym koncie
 * @param {string} message - Wiadomość do wyświetlenia
 * @param {Object} auth - Firebase Auth instance
 */
function showBlockedAccountModal(message, auth) {
  // Sprawdź czy modal już istnieje - jeśli tak, nie rób nic
  let modal = document.getElementById("blocked-account-modal");
  if (modal) {
    return; // Modal już istnieje, nie wyświetlaj ponownie
  }

  // Zablokuj scrollowanie i nawigację
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.width = "100%";
  document.body.style.top = `-${window.scrollY}px`; // Zapamiętaj pozycję scrolla
  
  // Utwórz modal
  modal = document.createElement("div");
  modal.id = "blocked-account-modal";
  modal.className = "fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[99999] overflow-y-auto p-3 sm:p-4 backdrop-blur-xl";
  modal.style.zIndex = "99999";
  modal.style.pointerEvents = "auto";
  
  // Escapuj HTML w wiadomości dla bezpieczeństwa
  const escapedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  
  modal.innerHTML = `
    <div class="bg-zinc-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 max-w-md w-full mx-3 sm:mx-4 border-2 border-red-600">
      <div class="text-center">
        <div class="text-red-500 text-4xl sm:text-5xl md:text-6xl mb-3 sm:mb-4">
          <i class="fa-solid fa-ban"></i>
        </div>
        <h2 class="text-xl sm:text-2xl font-bold text-red-400 mb-3 sm:mb-4 px-2">Konto zablokowane</h2>
        <div id="blocked-message" class="text-sm sm:text-base text-zinc-300 whitespace-pre-line mb-4 sm:mb-6 px-2 break-words leading-relaxed">${escapedMessage}</div>
        <button
          id="blocked-logout-button"
          class="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-3 sm:px-6 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition"
        >
          <i class="fa-solid fa-sign-out-alt mr-2"></i>
          Wyloguj się
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Dodaj event listener do przycisku wylogowania
  const logoutButton = modal.querySelector("#blocked-logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        // Importuj moduły Firebase
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        await signOut(auth);
        // Wyczyść cookie SSO
        try {
          await fetch("https://strzelca.pl/api/sso-session-logout", {
            method: "POST",
            credentials: "include",
          });
        } catch (e) {
          console.warn("SSO logout failed (ignored):", e?.message || e);
        }
        // Zresetuj flagę przed przekierowaniem
        isBlockedModalShown = false;
        // Przekieruj do strony głównej
        window.location.href = "https://strzelca.pl";
      } catch (error) {
        console.error("Błąd wylogowania:", error);
        // Nawet jeśli wylogowanie się nie powiodło, przekieruj do strony głównej
        isBlockedModalShown = false;
        window.location.href = "https://strzelca.pl";
      }
    });
  }
  
  // Zablokuj wszystkie kliknięcia poza modalem
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // Zablokuj wszystkie klawisze (np. ESC, F5, itp.)
  const blockKeyboard = (e) => {
    // Pozwól tylko na podstawowe kombinacje klawiszy w modalu
    if (e.target.closest("#blocked-account-modal")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  
  document.addEventListener("keydown", blockKeyboard, true);
  document.addEventListener("keyup", blockKeyboard, true);
  
  // Zablokuj kontekstowe menu
  const blockContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  document.addEventListener("contextmenu", blockContextMenu, true);
}

/**
 * Zatrzymuje monitorowanie statusu użytkownika
 */
export function stopUserStatusMonitor() {
  if (statusUnsubscribe) {
    statusUnsubscribe();
    statusUnsubscribe = null;
  }
  isBlockedModalShown = false;
}
