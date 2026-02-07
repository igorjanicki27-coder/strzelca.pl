/**
 * Moduł monitorujący status użytkownika w czasie rzeczywistym
 * Wylogowuje użytkownika natychmiast po zablokowaniu konta
 */

let statusUnsubscribe = null;

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
            // Sprawdź czy blokada nie wygasła
            let blockedUntil = null;
            if (userData.blockedUntil) {
              blockedUntil = userData.blockedUntil.toDate ? userData.blockedUntil.toDate() : new Date(userData.blockedUntil);
            }

            // Jeśli blokada wygasła, odblokuj konto
            if (blockedUntil && blockedUntil <= new Date()) {
              const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
              try {
                await updateDoc(userProfileRef, {
                  status: "active",
                  blockedUntil: null,
                  unblockedAt: new Date(),
                });
              } catch (error) {
                console.error("Błąd podczas automatycznego odblokowania konta:", error);
              }
              return;
            }

            // Jeśli użytkownik jest zablokowany, wyloguj go natychmiast
            console.log("Użytkownik został zablokowany - wylogowywanie...");
            
            // Zatrzymaj listener przed wylogowaniem
            if (statusUnsubscribe) {
              statusUnsubscribe();
              statusUnsubscribe = null;
            }

            // Wyloguj użytkownika
            try {
              await signOut(auth);
            } catch (signOutError) {
              console.error("Błąd podczas wylogowywania zablokowanego użytkownika:", signOutError);
            }

            // Pokaż komunikat o blokadzie
            const blockReason = userData.blockReason || "Nie podano powodu";
            let blockMessage = `Twoje konto zostało zablokowane.\n\nPowód: ${blockReason}`;
            
            if (blockedUntil && blockedUntil > new Date()) {
              blockMessage += `\n\nBlokada obowiązuje do: ${blockedUntil.toLocaleDateString("pl-PL")} ${blockedUntil.toLocaleTimeString("pl-PL")}`;
            } else if (!blockedUntil) {
              blockMessage += "\n\nBlokada jest permanentna.";
            }

            // Pokaż modal z informacją o blokadzie
            showBlockedAccountModal(blockMessage);

            // Przekieruj na stronę główną po 3 sekundach
            setTimeout(() => {
              window.location.href = "https://strzelca.pl";
            }, 3000);
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
 */
function showBlockedAccountModal(message) {
  // Sprawdź czy modal już istnieje
  let modal = document.getElementById("blocked-account-modal");
  
  if (!modal) {
    // Utwórz modal jeśli nie istnieje
    modal = document.createElement("div");
    modal.id = "blocked-account-modal";
    modal.className = "fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] overflow-y-auto p-3 sm:p-4";
    modal.style.zIndex = "99999";
    
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
            id="blocked-modal-button"
            class="w-full sm:w-auto bg-coyote hover:bg-opacity-80 text-black px-4 py-3 sm:px-6 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition"
          >
            <i class="fa-solid fa-home mr-2"></i>
            <span class="hidden sm:inline">Przejdź do strony głównej</span>
            <span class="sm:hidden">Strona główna</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Dodaj event listener do przycisku
    const button = modal.querySelector("#blocked-modal-button");
    if (button) {
      button.addEventListener("click", () => {
        window.location.href = "https://strzelca.pl";
      });
    }
  } else {
    // Zaktualizuj treść modala
    const messageEl = modal.querySelector("#blocked-message") || modal.querySelector(".text-zinc-300");
    if (messageEl) {
      const escapedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      messageEl.innerHTML = escapedMessage;
    }
    modal.style.display = "flex";
    modal.classList.remove("hidden");
  }

  // Zablokuj scrollowanie strony
  document.body.style.overflow = "hidden";
}

/**
 * Zatrzymuje monitorowanie statusu użytkownika
 */
export function stopUserStatusMonitor() {
  if (statusUnsubscribe) {
    statusUnsubscribe();
    statusUnsubscribe = null;
  }
}
