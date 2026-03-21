/**
 * Wspólny formularz zamówienia (sklep) i zapytania o ofertę (szkolenia).
 * POST → https://strzelca.pl/api/orders (cookie SSO .strzelca.pl)
 */

const DOC_URL = "https://dokumenty.strzelca.pl/";
export const STRZELCA_ORDERS_API = "https://strzelca.pl/api/orders";

const legalHtmlCache = Object.create(null);

/** @type {null | { context: string, db: import('firebase/firestore').Firestore, auth: import('firebase/auth').Auth, regulaminCfg: { sectionId: string, docTitle: string, fallbackHash: string }, showParcel: boolean, showAddress: boolean }} */
let pendingForm = null;

function prefixDisplayTitle(context, rawTitle) {
  const t = String(rawTitle || "").trim();
  if (context === "shop") return `Sklep: ${t}`;
  return `Szkolenie: ${t}`;
}

const CONTEXT = {
  shop: {
    loginTitle: "Zamówienie produktu",
    loginLeadHtml: (raw) =>
      `Aby złożyć zamówienie produktu <strong>${escapeHtml(raw)}</strong>, musisz być zalogowany.`,
    contactTopic: "Zamówienie",
    formTitle: "Złóż zamówienie",
    submitIcon: "fa-shopping-cart",
    submitLabel: "Złóż zamówienie",
    regulaminSection: "regulamin-sklepu",
    regulaminDocTitle: "Regulamin Sklepu i Serwisu",
    regulaminLinkLabel: "regulamin zamówień",
    regulaminFallbackHash: "#regulamin-sklepu",
    disclaimerWarning: "Zamówienie może nie zostać zaakceptowane.",
    disclaimerAcceptHtml: "Klikając przycisk „Złóż zamówienie” akceptujesz",
    showParcel: true,
    showAddress: true,
    successMessage: "Zamówienie zostało złożone pomyślnie! Otrzymasz potwierdzenie na adres email.",
    activityDetails: (displayName) => `Zamówienie produktu: ${displayName}`,
  },
  training: {
    loginTitle: "Zapytanie o ofertę",
    loginLeadHtml: (raw) =>
      `Aby wysłać zapytanie o szkolenie <strong>${escapeHtml(raw)}</strong>, musisz być zalogowany.`,
    contactTopic: "Pytanie o szkolenie",
    formTitle: "Zapytanie o ofertę",
    submitIcon: "fa-paper-plane",
    submitLabel: "Wyślij zapytanie",
    regulaminSection: "regulamin-szkolen",
    regulaminDocTitle: "Regulamin Szkoleń",
    regulaminLinkLabel: "regulamin szkoleń",
    regulaminFallbackHash: "#regulamin-szkolen",
    disclaimerWarning: "Zapytanie może nie zostać rozpatrzone pozytywnie.",
    disclaimerAcceptHtml: "Klikając przycisk „Wyślij zapytanie” akceptujesz",
    showParcel: false,
    showAddress: false,
    successMessage: "Zapytanie zostało wysłane! Otrzymasz potwierdzenie na adres email.",
    activityDetails: (displayName) => `Zapytanie o ofertę szkolenia: ${displayName}`,
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function closeRegulaminModal() {
  const el = document.getElementById("strzelca-regulamin-modal");
  if (el) el.remove();
}

async function fetchLegalFragment(sectionId) {
  if (legalHtmlCache[sectionId]) return legalHtmlCache[sectionId];
  const res = await fetch(DOC_URL, { credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const section = parsed.querySelector(`#${sectionId} .accordion-body`);
  if (!section) throw new Error("Brak sekcji regulaminu");
  legalHtmlCache[sectionId] = section.innerHTML;
  return legalHtmlCache[sectionId];
}

async function openRegulaminModal(ev, cfg) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  let modal = document.getElementById("strzelca-regulamin-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "strzelca-regulamin-modal";
    modal.className =
      "fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "strzelca-regulamin-title");
    modal.onclick = function (e) {
      if (e.target.id === "strzelca-regulamin-modal") closeRegulaminModal();
    };
    modal.innerHTML = `
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col my-4" onclick="event.stopPropagation()">
        <div class="flex justify-between items-center gap-3 p-4 md:p-6 border-b border-zinc-800 shrink-0">
          <h2 id="strzelca-regulamin-title" class="text-lg md:text-xl font-bold text-[#C19A6B] font-[Orbitron] pr-2"></h2>
          <button type="button" onclick="window.closeStrzelcaRegulaminModal()" class="text-zinc-400 hover:text-white shrink-0 p-2" aria-label="Zamknij">
            <i class="fa-solid fa-times text-xl" aria-hidden="true"></i>
          </button>
        </div>
        <div id="strzelca-regulamin-body" class="p-4 md:p-6 overflow-y-auto text-sm text-zinc-300 custom-render max-w-none"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const titleEl = document.getElementById("strzelca-regulamin-title");
  const bodyEl = document.getElementById("strzelca-regulamin-body");
  if (titleEl) titleEl.textContent = cfg.docTitle;
  if (!bodyEl) return;

  bodyEl.innerHTML = "<p class=\"text-zinc-500\">Wczytywanie regulaminu…</p>";

  try {
    const fragment = await fetchLegalFragment(cfg.sectionId);
    bodyEl.innerHTML = fragment;
    const base = DOC_URL.replace(/\/$/, "");
    bodyEl.querySelectorAll('a[href^="#"]').forEach((a) => {
      const hash = a.getAttribute("href");
      a.setAttribute("href", base + hash);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  } catch (err) {
    console.error("Regulamin:", err);
    const fb = `https://dokumenty.strzelca.pl${cfg.fallbackHash}`;
    bodyEl.innerHTML = `<p class="text-red-400">Nie udało się wczytać regulaminu. Otwórz <a href="${fb}" target="_blank" rel="noopener noreferrer" class="text-[#C19A6B] underline">dokumenty.strzelca.pl</a>.</p>`;
  }
}

async function logOrderActivity(db, user, displayName, context) {
  try {
    const { addDoc, collection } = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
    );
    const cfg = CONTEXT[context];
    const details = cfg ? cfg.activityDetails(displayName) : displayName;
    await addDoc(collection(db, "activityLogs"), {
      type: "ORDER-PLACED",
      userId: user.uid,
      userName: user.displayName || user.email.split("@")[0] || "Użytkownik",
      details,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Błąd podczas logowania aktywności:", error);
  }
}

function showLoginModal(cfg, rawTitle) {
  const modal = document.createElement("div");
  modal.id = "order-login-modal";
  modal.className =
    "fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md";
  modal.onclick = function (e) {
    if (e.target.id === "order-login-modal") modal.remove();
  };

  const topic = encodeURIComponent(cfg.contactTopic);
  const product = encodeURIComponent(rawTitle);

  modal.innerHTML = `
    <div class="bg-zinc-900 p-8 rounded-2xl max-w-md w-full border border-zinc-800 shadow-2xl" onclick="event.stopPropagation()">
      <h2 class="text-2xl font-bold coyote-text mb-4">${escapeHtml(cfg.loginTitle)}</h2>
      <p class="text-zinc-300 mb-6">${cfg.loginLeadHtml(rawTitle)}</p>
      <div class="space-y-3">
        <a href="https://konto.strzelca.pl/logowanie.html?redirect=${encodeURIComponent(window.location.href)}"
           class="block w-full bg-coyote text-black px-6 py-3 rounded-lg font-bold text-center hover:bg-opacity-90 transition">
          <i class="fa-solid fa-sign-in-alt mr-2"></i>
          Zaloguj się
        </a>
        <a href="https://kontakt.strzelca.pl?topic=${topic}&product=${product}"
           class="block w-full border border-zinc-700 text-zinc-300 px-6 py-3 rounded-lg font-bold text-center hover:bg-zinc-800 transition">
          <i class="fa-solid fa-envelope mr-2"></i>
          Przejdź do formularza kontaktowego
        </a>
        <button onclick="this.closest('#order-login-modal').remove()"
                class="block w-full text-zinc-400 px-6 py-2 text-sm hover:text-white transition">
          Anuluj
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

/**
 * @param {object} deps
 * @param {import('firebase/auth').Auth} deps.auth
 * @param {import('firebase/firestore').Firestore} deps.db
 * @param {Function} deps.getDoc
 * @param {Function} deps.doc
 * @param {'shop'|'training'} deps.context
 * @param {string} deps.rawTitle
 * @param {number} [deps.price]
 */
export async function openOrderInquiryFlow(deps) {
  const { auth, db, getDoc, doc, context, rawTitle, price = 0 } = deps;
  const cfg = CONTEXT[context];
  if (!cfg) {
    console.error("openOrderInquiryFlow: nieznany context", context);
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    showLoginModal(cfg, rawTitle);
    return;
  }

  let userProfile = null;
  try {
    const profileDoc = await getDoc(doc(db, "userProfiles", user.uid));
    if (profileDoc.exists()) userProfile = profileDoc.data();
  } catch (error) {
    console.error("Error loading user profile:", error);
  }

  function b64DecodeUtf8(str) {
    if (!str) return "";
    try {
      return decodeURIComponent(escape(atob(str)));
    } catch {
      return "";
    }
  }

  const displayName = prefixDisplayTitle(context, rawTitle);
  const address = userProfile?.address || {};
  const decodedAddress = {
    street: b64DecodeUtf8(address.street || ""),
    buildingNumber: b64DecodeUtf8(address.buildingNumber || ""),
    postalCode: b64DecodeUtf8(address.postalCode || ""),
    city: b64DecodeUtf8(address.city || ""),
  };

  pendingForm = {
    context,
    db,
    auth,
    displayName,
    price: price || 0,
    regulaminCfg: {
      sectionId: cfg.regulaminSection,
      docTitle: cfg.regulaminDocTitle,
      fallbackHash: cfg.regulaminFallbackHash,
    },
    showParcel: cfg.showParcel,
    showAddress: cfg.showAddress,
    successMessage: cfg.successMessage,
  };

  const orderFieldClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#C19A6B] focus:ring-1 focus:ring-[#C19A6B]/40";

  const rawTitleSafe = escapeHtml(String(rawTitle || "").trim());
  const priceLine =
    price > 0
      ? `<span class="text-[#C19A6B] font-bold tabular-nums shrink-0">${escapeHtml(String(price))} PLN</span>`
      : `<span class="text-zinc-500 text-sm shrink-0">—</span>`;

  const contactParcel = cfg.showParcel
    ? `
            <div class="mb-4">
              <label class="block text-xs font-medium text-zinc-400 mb-1">Paczkomat</label>
              <input type="text" id="order-parcelLocker" form="shop-order-form"
                     value="${escapeHtml(userProfile?.parcelLocker ? b64DecodeUtf8(userProfile.parcelLocker) : "")}"
                     class="${orderFieldClass}" placeholder="Kod paczkomatu" autocomplete="off">
            </div>`
    : "";

  const contactAddress = cfg.showAddress
    ? `
            <div class="mb-4">
              <label class="block text-xs font-medium text-zinc-400 mb-2">Adres</label>
              <div class="grid grid-cols-2 gap-2">
                <input type="text" id="order-address-street" form="shop-order-form"
                       value="${escapeHtml(decodedAddress.street)}" class="${orderFieldClass}" placeholder="Ulica">
                <input type="text" id="order-address-building" form="shop-order-form"
                       value="${escapeHtml(decodedAddress.buildingNumber)}" class="${orderFieldClass}" placeholder="Nr">
                <input type="text" id="order-address-postal" form="shop-order-form"
                       value="${escapeHtml(decodedAddress.postalCode)}" class="${orderFieldClass}" placeholder="Kod">
                <input type="text" id="order-address-city" form="shop-order-form"
                       value="${escapeHtml(decodedAddress.city)}" class="${orderFieldClass}" placeholder="Miasto">
              </div>
            </div>`
    : "";

  const modal = document.createElement("div");
  modal.id = "order-form-modal";
  modal.className =
    "fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md";
  modal.style.overflowY = "auto";
  modal.onclick = function (e) {
    if (e.target.id === "order-form-modal") {
      modal.remove();
      pendingForm = null;
    }
  };

  modal.innerHTML = `
    <div class="bg-zinc-900 p-4 md:p-5 rounded-xl max-w-lg w-full border border-zinc-800 shadow-2xl my-4 max-h-[min(92vh,720px)] flex flex-col" onclick="event.stopPropagation()">
      <div class="flex justify-between items-start gap-2 mb-3 shrink-0">
        <h2 class="text-lg font-bold text-[#C19A6B] font-[Orbitron] leading-tight">${escapeHtml(cfg.formTitle)}</h2>
        <button type="button" onclick="document.getElementById('order-form-modal').remove(); window.__strzelcaClearPendingOrder && window.__strzelcaClearPendingOrder();"
                class="text-zinc-400 hover:text-white p-1 -mr-1" aria-label="Zamknij">
          <i class="fa-solid fa-times text-lg"></i>
        </button>
      </div>

      <form id="shop-order-form" class="flex flex-col min-h-0 flex-1 overflow-y-auto" onsubmit="window.submitStrzelcaOrderInquiry(event)">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3 pb-3 border-b border-zinc-800">
          <span class="font-[Orbitron] font-black uppercase text-white text-sm md:text-base tracking-tight min-w-0 flex-1 truncate" title="${rawTitleSafe}">${rawTitleSafe}</span>
          ${priceLine}
        </div>

        <div class="mb-3">
          <label class="block text-xs text-zinc-500 mb-1">Email (z konta)</label>
          <input type="email" id="order-email" value="${escapeHtml(userProfile?.email || user.email || "")}"
                 class="${orderFieldClass} cursor-not-allowed opacity-90" readonly required aria-readonly="true" title="E-mail z konta — edycja w profilu">
        </div>

        <div class="mb-3">
          <button type="button" onclick="window.openStrzelcaOrderContactDialog()"
                  class="w-full py-2.5 px-3 rounded-lg border border-zinc-600 text-zinc-200 text-sm font-medium hover:bg-zinc-800 hover:border-zinc-500 transition text-left flex items-center justify-between gap-2">
            <span>Dane kontaktowe</span>
            <i class="fa-solid fa-chevron-right text-zinc-500 text-xs" aria-hidden="true"></i>
          </button>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-zinc-500 mb-1">Uwagi</label>
          <textarea id="order-notes" class="${orderFieldClass}" rows="2" placeholder="Opcjonalnie…"></textarea>
        </div>

        <div class="mb-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
          <p class="text-[11px] text-zinc-400 leading-snug">
            <strong>Uwaga:</strong> ${escapeHtml(cfg.disclaimerWarning)} ${cfg.disclaimerAcceptHtml}
            <button type="button" class="text-white hover:text-[#C19A6B] hover:underline font-bold align-baseline bg-transparent border-0 p-0 cursor-pointer transition-colors" onclick="window.openStrzelcaRegulaminModal(event)">${escapeHtml(cfg.regulaminLinkLabel)}</button>.
          </p>
        </div>

        <div class="flex justify-center pt-1 pb-1">
          <button type="submit" class="inline-flex items-center justify-center gap-2 bg-[#C19A6B] text-black px-6 py-3 uppercase text-[10px] font-black rounded tracking-widest shadow-lg hover:bg-[#b18a5f] transition">
            <i class="fa-solid ${escapeHtml(cfg.submitIcon)}" aria-hidden="true"></i>
            ${escapeHtml(cfg.submitLabel)}
          </button>
        </div>
      </form>

      <div id="strzelca-order-contact-modal" class="hidden fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
           role="dialog" aria-modal="true" aria-labelledby="strzelca-order-contact-title"
           onclick="if (event.target.id === 'strzelca-order-contact-modal') window.strzelcaOrderContactDialogCancel()">
        <div class="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-md w-full p-4 max-h-[min(85vh,560px)] overflow-y-auto" onclick="event.stopPropagation()">
          <h3 id="strzelca-order-contact-title" class="text-base font-bold text-[#C19A6B] font-[Orbitron] mb-4">Dane kontaktowe</h3>
          <div class="mb-4">
            <label class="block text-xs font-medium text-zinc-400 mb-1">Telefon</label>
            <input type="text" id="order-phone" form="shop-order-form"
                   value="${escapeHtml(userProfile?.phone ? b64DecodeUtf8(userProfile.phone) : "")}"
                   class="${orderFieldClass}" placeholder="Numer telefonu" autocomplete="tel">
          </div>
          ${contactParcel}
          ${contactAddress}
          <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end mt-5">
            <button type="button" onclick="window.strzelcaOrderContactDialogCancel()"
                    class="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition">
              Anuluj
            </button>
            <button type="button" onclick="window.strzelcaOrderContactDialogSave()"
                    class="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-[#C19A6B] text-black text-sm font-bold hover:bg-[#b18a5f] transition">
              Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function attachOrderInquiryGlobals() {
  if (typeof window === "undefined") return;

  window.closeStrzelcaRegulaminModal = closeRegulaminModal;

  window.openStrzelcaRegulaminModal = async function (ev) {
    const cfg = pendingForm?.regulaminCfg;
    if (!cfg) return;
    await openRegulaminModal(ev, cfg);
  };

  function contactDialogFieldIds() {
    const p = pendingForm;
    if (!p) return [];
    const ids = ["order-phone"];
    if (p.showParcel) ids.push("order-parcelLocker");
    if (p.showAddress) {
      ids.push(
        "order-address-street",
        "order-address-building",
        "order-address-postal",
        "order-address-city"
      );
    }
    return ids;
  }

  window.openStrzelcaOrderContactDialog = function () {
    if (!pendingForm) return;
    const snap = {};
    contactDialogFieldIds().forEach((id) => {
      const el = document.getElementById(id);
      if (el) snap[id] = el.value;
    });
    window.__strzelcaContactSnapshot = snap;
    document.getElementById("strzelca-order-contact-modal")?.classList.remove("hidden");
  };

  window.strzelcaOrderContactDialogCancel = function () {
    const snap = window.__strzelcaContactSnapshot || {};
    Object.keys(snap).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = snap[id];
    });
    document.getElementById("strzelca-order-contact-modal")?.classList.add("hidden");
  };

  window.strzelcaOrderContactDialogSave = function () {
    document.getElementById("strzelca-order-contact-modal")?.classList.add("hidden");
  };

  window.__strzelcaClearPendingOrder = function () {
    pendingForm = null;
  };

  window.submitStrzelcaOrderInquiry = async function (event) {
    event.preventDefault();
    const p = pendingForm;
    if (!p) return;

    try {
      const user = p.auth.currentUser;
      if (!user) {
        alert("Musisz być zalogowany.");
        return;
      }

      const getVal = (id) => document.getElementById(id)?.value || "";

      const orderData = {
        userId: user.uid,
        email: getVal("order-email"),
        orderDetails: `${p.displayName}${p.price ? ` (${p.price} PLN)` : ""}`,
        notes: getVal("order-notes") || "",
        phone: getVal("order-phone") || "",
        parcelLocker: p.showParcel ? getVal("order-parcelLocker") || "" : "",
        address: p.showAddress
          ? {
              street: getVal("order-address-street") || "",
              buildingNumber: getVal("order-address-building") || "",
              postalCode: getVal("order-address-postal") || "",
              city: getVal("order-address-city") || "",
            }
          : { street: "", buildingNumber: "", postalCode: "", city: "" },
        price: p.price || 0,
        shipping: 0,
        additionalCosts: 0,
        tax: 0,
        status: "zlozone",
      };

      const response = await fetch(STRZELCA_ORDERS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(orderData),
      });

      const data = await response.json().catch(() => ({}));

      if (!data.success) {
        throw new Error(data.error || "Nie udało się zapisać zamówienia");
      }

      await logOrderActivity(p.db, user, p.displayName, p.context);

      document.getElementById("order-form-modal")?.remove();
      pendingForm = null;
      alert(p.successMessage);
    } catch (error) {
      console.error("Error submitting order:", error);
      alert("Błąd: " + (error.message || error));
    }
  };
}

attachOrderInquiryGlobals();
