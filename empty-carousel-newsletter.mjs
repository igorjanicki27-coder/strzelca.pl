/**
 * Wspólny kafel „brak treści” + modal zgody na newsletter (Firestore: userProfiles.newsletter + mailingList).
 */

const MODAL_ROOT_ID = "strzelca-newsletter-optin-root";

let fireCtx = null;

export function setNewsletterOptInContext(ctx) {
  fireCtx = ctx;
}

export function buildEmptyCarouselArticleHtml(articleClass) {
  const cls = String(articleClass || "").trim();
  return `<article class="${cls}">
  <div class="text-zinc-300 text-sm md:text-base leading-relaxed text-center max-w-2xl mx-auto px-3">
    <p>Aktualnie nie mamy nic do zaproponowania. Odwiedzaj tę stronę cyklicznie, aby być na bieżąco. Możesz także zapisać się do naszego <button type="button" data-strzelca-newsletter-optin class="text-[var(--coyote)] hover:underline font-medium bg-transparent border-0 cursor-pointer p-0 inline font-inherit">newslettera</button>, aby dowiadywać się o nowościach jako pierwszy!</p>
  </div>
</article>`;
}

function ensureModal() {
  if (document.getElementById(MODAL_ROOT_ID)) return;

  const root = document.createElement("div");
  root.id = MODAL_ROOT_ID;
  root.className =
    "fixed inset-0 z-[220] hidden flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "strzelca-newsletter-optin-title");
  root.innerHTML = `
    <div id="strzelca-newsletter-optin-panel" class="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl" onclick="event.stopPropagation()">
      <h2 id="strzelca-newsletter-optin-title" class="text-lg font-bold text-white mb-4 text-center font-[Orbitron] uppercase tracking-wide">Newsletter</h2>
      <label class="flex items-start gap-3 cursor-pointer text-zinc-300 text-sm leading-relaxed mb-6">
        <input type="checkbox" id="strzelca-newsletter-optin-cb" class="mt-1 w-4 h-4 rounded border-zinc-600 text-[var(--coyote)] focus:ring-[var(--coyote)]" />
        <span>Chcę otrzymywać newsletter (rezygnacja możliwa w każdej chwili)</span>
      </label>
      <div class="flex flex-col sm:flex-row gap-3 justify-end">
        <button type="button" id="strzelca-newsletter-optin-cancel" class="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold uppercase tracking-wider">Anuluj</button>
        <button type="button" id="strzelca-newsletter-optin-save" class="px-4 py-2 rounded-lg bg-[var(--coyote)] text-black text-sm font-black uppercase tracking-wider hover:opacity-90">Zapisz</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  root.addEventListener("click", () => closeNewsletterOptinModal());

  document
    .getElementById("strzelca-newsletter-optin-cancel")
    ?.addEventListener("click", () => closeNewsletterOptinModal());

  document
    .getElementById("strzelca-newsletter-optin-save")
    ?.addEventListener("click", () => void onNewsletterOptinSave());
}

export function openNewsletterOptinModal() {
  ensureModal();
  const root = document.getElementById(MODAL_ROOT_ID);
  const cb = document.getElementById("strzelca-newsletter-optin-cb");
  if (cb) cb.checked = false;
  if (root) {
    root.classList.remove("hidden");
  }
}

export function closeNewsletterOptinModal() {
  const root = document.getElementById(MODAL_ROOT_ID);
  if (root) root.classList.add("hidden");
}

async function onNewsletterOptinSave() {
  const cb = document.getElementById("strzelca-newsletter-optin-cb");
  if (!cb?.checked) {
    alert("Zaznacz zgodę, aby zapisać się na newsletter.");
    return;
  }

  if (!fireCtx?.auth || !fireCtx?.db || !fireCtx?.doc || !fireCtx?.getDoc || !fireCtx?.setDoc) {
    alert("Nie można zapisać — odśwież stronę i spróbuj ponownie.");
    return;
  }

  const { auth, db, doc, getDoc, setDoc, updateDoc } = fireCtx;

  try {
    await auth.authStateReady?.();
  } catch (_) {}

  const user = auth.currentUser;
  if (!user?.email) {
    alert(
      "Aby zapisać newsletter przy koncie, zaloguj się. Możesz też zarządzać subskrypcją na stronie konto.strzelca.pl/newsletter.html.",
    );
    if (typeof window.strzelcaOpenLoginModal === "function") {
      window.strzelcaOpenLoginModal();
    } else {
      window.location.href = "https://konto.strzelca.pl/logowanie.html";
    }
    return;
  }

  const email = String(user.email).trim().toLowerCase();
  const pref = doc(db, "userProfiles", user.uid);

  try {
    const snap = await getDoc(pref);
    if (snap.exists()) {
      if (typeof updateDoc === "function") {
        await updateDoc(pref, { newsletter: true });
      } else {
        await setDoc(pref, { newsletter: true }, { merge: true });
      }
    } else {
      await setDoc(pref, { newsletter: true }, { merge: true });
    }

    await setDoc(
      doc(db, "mailingList", email),
      {
        email,
        subscribedAt: new Date(),
        active: true,
        source: "empty_carousel_optin",
      },
      { merge: true },
    );

    closeNewsletterOptinModal();
    alert("Dziękujemy! Zapisano Cię na newsletter.");
  } catch (e) {
    console.warn("Newsletter opt-in save failed:", e);
    alert(
      e?.message ||
        "Nie udało się zapisać. Sprawdź połączenie lub uprawnienia konta.",
    );
  }
}

function bindDelegatedOpen() {
  if (window.__strzelcaNewsletterOptinOpenBound) return;
  window.__strzelcaNewsletterOptinOpenBound = true;
  document.addEventListener("click", (e) => {
    const t = e.target?.closest?.("[data-strzelca-newsletter-optin]");
    if (!t) return;
    e.preventDefault();
    openNewsletterOptinModal();
  });
}

/**
 * Wywołaj po zainicjalizowaniu Firebase (auth, db, doc, getDoc, setDoc, updateDoc).
 */
export function initNewsletterOptInFromEmptyCarousels(ctx) {
  setNewsletterOptInContext(ctx);
  ensureModal();
  bindDelegatedOpen();
}
