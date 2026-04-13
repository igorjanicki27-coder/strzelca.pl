/**
 * Wspólny formularz zamówienia dla sklepu i szkoleń.
 * POST → https://strzelca.pl/api/orders (Bearer ID token + opcjonalnie cookie SSO .strzelca.pl)
 */

const REGULAMIN_TXT_URL = "https://dokumenty.strzelca.pl/regulamin-witryny.txt";
export const STRZELCA_ORDERS_API = "https://strzelca.pl/api/orders";
export const STRZELCA_PROMO_CODES_API = "https://strzelca.pl/api/promo-codes";
const KONTAKT_EMBED_ORIGIN = "https://kontakt.strzelca.pl";

let regulaminPlainTextCache = null;
let regulaminRichHtmlCache = null;

/** @type {null | { context: string, db: import('firebase/firestore').Firestore, auth: import('firebase/auth').Auth, regulaminCfg: { docTitle: string }, showParcel: boolean, showAddress: boolean, customerType?: 'private'|'company', displayName?: string, price?: number, successMessage?: string, itemId?: string, appliedPromo?: any, individualPricing?: boolean, step?: number, profileAddress?: { street: string, buildingNumber: string, postalCode: string, city: string }, profileParcelLocker?: string }} */
let pendingForm = null;

function prefixDisplayTitle(context, rawTitle) {
  const fallback = context === "shop" ? "Produkt" : "Szkolenie";
  const t = String(rawTitle || "").trim() || fallback;
  if (context === "shop") return `SKLEP: ${t}`;
  return `SZKOLENIE: ${t}`;
}

function rawTitleFromDisplayName(displayName, context) {
  const value = String(displayName || "").trim();
  const prefix = context === "shop" ? "SKLEP: " : "SZKOLENIE: ";
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
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
    regulaminDocTitle: "Regulamin strzelca.pl",
    regulaminLinkLabel: "regulamin",
    disclaimerWarning: "Zamówienie może nie zostać zaakceptowane.",
    disclaimerAcceptHtml: "Klikając przycisk „Złóż zamówienie” akceptujesz",
    showParcel: true,
    showAddress: true,
    successMessage: "Zamówienie zostało złożone pomyślnie! Otrzymasz potwierdzenie na adres email.",
    activityDetails: (displayName) => `Zamówienie: ${displayName}`,
  },
  training: {
    loginTitle: "Zamówienie szkolenia",
    loginLeadHtml: (raw) =>
      `Aby złożyć zamówienie szkolenia <strong>${escapeHtml(raw)}</strong>, musisz być zalogowany.`,
    contactTopic: "Zamówienie szkolenia",
    formTitle: "Złóż zamówienie",
    submitIcon: "fa-shopping-cart",
    submitLabel: "Złóż zamówienie",
    regulaminDocTitle: "Regulamin strzelca.pl",
    regulaminLinkLabel: "regulamin",
    disclaimerWarning: "Zamówienie może nie zostać zaakceptowane.",
    disclaimerAcceptHtml: "Klikając przycisk „Złóż zamówienie” akceptujesz",
    showParcel: false,
    showAddress: false,
    successMessage: "Zamówienie zostało złożone pomyślnie! Otrzymasz potwierdzenie na adres email.",
    activityDetails: (displayName) => `Zamówienie: ${displayName}`,
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(value) {
  const amount = Math.max(0, Number(value) || 0);
  return `${amount.toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} zł`;
}

function roundMoney(value) {
  return Math.round((Math.max(0, Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function blankAddress() {
  return {
    street: "",
    buildingNumber: "",
    postalCode: "",
    city: "",
  };
}

function cloneAddress(address) {
  return {
    street: String(address?.street || "").trim(),
    buildingNumber: String(address?.buildingNumber || "").trim(),
    postalCode: String(address?.postalCode || "").trim(),
    city: String(address?.city || "").trim(),
  };
}

function isAddressComplete(address) {
  const a = cloneAddress(address);
  return Boolean(a.street && a.buildingNumber && a.postalCode && a.city);
}

function formatAddressInline(address) {
  const a = cloneAddress(address);
  return [a.street, a.buildingNumber, a.postalCode, a.city].filter(Boolean).join(", ");
}

function b64DecodeUtf8(str) {
  if (!str) return "";
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

/** Tekst startowy w polu wiadomości (min. 10 znaków — walidacja kontaktu). */
function kontaktPrefillForTraining(rawTitle) {
  const name = String(rawTitle || "").trim() || "szkolenie";
  return `Pytanie o szkolenie „${name}”: proszę o więcej informacji.`;
}

function openKontaktEmbedModal(prefillText) {
  if (typeof document === "undefined") return;
  window.strzelcaCloseKontaktEmbedModal?.();

  const wrap = document.createElement("div");
  wrap.id = "strzelca-kontakt-embed-modal";
  wrap.className =
    "fixed inset-0 z-[205] flex items-center justify-center p-3 md:p-4 bg-black/90 backdrop-blur-md";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Formularz kontaktowy");

  const panel = document.createElement("div");
  panel.className =
    "relative w-full max-w-lg max-h-[min(92dvh,720px)] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className =
    "absolute top-3 right-3 z-10 text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition";
  closeBtn.setAttribute("aria-label", "Zamknij");
  closeBtn.innerHTML = '<i class="fa-solid fa-times text-xl" aria-hidden="true"></i>';
  closeBtn.onclick = function () {
    window.strzelcaCloseKontaktEmbedModal?.();
  };

  const iframe = document.createElement("iframe");
  iframe.title = "Formularz kontaktowy STRZELCA.PL";
  iframe.className = "w-full border-0 min-h-[420px] h-[min(75dvh,560px)] bg-zinc-950";
  iframe.src = `${KONTAKT_EMBED_ORIGIN}/?embed=1&prefill=${encodeURIComponent(prefillText)}`;
  iframe.setAttribute("loading", "lazy");
  iframe.referrerPolicy = "strict-origin-when-cross-origin";

  panel.appendChild(closeBtn);
  panel.appendChild(iframe);
  wrap.appendChild(panel);
  wrap.onclick = function (e) {
    if (e.target === wrap) window.strzelcaCloseKontaktEmbedModal?.();
  };
  panel.onclick = function (e) {
    e.stopPropagation();
  };

  const onMsg = function (ev) {
    if (ev.origin !== KONTAKT_EMBED_ORIGIN) return;
    if (ev.data && ev.data.type === "strzelca-contact-embed-done") {
      window.strzelcaCloseKontaktEmbedModal?.();
    }
  };
  window.__strzelcaKontaktEmbedOnMessage = onMsg;
  window.addEventListener("message", onMsg);

  document.body.appendChild(wrap);
}

function ensurePromoNoticeModal() {
  let modal = document.getElementById("strzelca-promo-notice-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "strzelca-promo-notice-modal";
  modal.className =
    "fixed inset-0 z-[230] hidden items-center justify-center p-4 bg-black/90 backdrop-blur-md";
  modal.onclick = function (e) {
    if (e.target.id === "strzelca-promo-notice-modal") {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
  };
  document.body.appendChild(modal);
  return modal;
}

function showPromoNotice(result) {
  const modal = ensurePromoNoticeModal();
  const actionButton =
    result?.actionUrl && result?.actionLabel
      ? `<a href="${escapeHtml(result.actionUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#C19A6B] text-black text-sm font-bold hover:bg-[#b18a5f] transition">${escapeHtml(result.actionLabel)}</a>`
      : "";
  modal.innerHTML = `
    <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-5" onclick="event.stopPropagation()">
      <div class="flex justify-between items-start gap-3 mb-4">
        <h3 class="text-lg font-bold text-[#C19A6B] font-[Orbitron]">Kod promocyjny</h3>
        <button type="button" onclick="document.getElementById('strzelca-promo-notice-modal').classList.add('hidden'); document.getElementById('strzelca-promo-notice-modal').classList.remove('flex');" class="text-zinc-400 hover:text-white p-1" aria-label="Zamknij">
          <i class="fa-solid fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <p class="text-sm text-zinc-200 leading-relaxed">${escapeHtml(result?.message || "Nie udało się zastosować kodu.")}</p>
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
        <button type="button" onclick="document.getElementById('strzelca-promo-notice-modal').classList.add('hidden'); document.getElementById('strzelca-promo-notice-modal').classList.remove('flex');" class="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition">
          Zamknij
        </button>
        ${actionButton}
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function ensureUnappliedPromoConfirmModal() {
  let modal = document.getElementById("strzelca-promo-unapplied-confirm-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "strzelca-promo-unapplied-confirm-modal";
  modal.className =
    "fixed inset-0 z-[240] hidden items-center justify-center p-4 bg-black/90 backdrop-blur-md";
  document.body.appendChild(modal);
  return modal;
}

/** @returns {Promise<boolean>} `true` gdy użytkownik wybierze „Tak” (kontynuuj zamówienie). */
function showUnappliedPromoConfirmModal() {
  return new Promise((resolve) => {
    const modal = ensureUnappliedPromoConfirmModal();
    const finish = (value) => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      modal.onclick = null;
      resolve(value);
    };
    modal.onclick = (e) => {
      if (e.target === modal) finish(false);
    };
    modal.innerHTML = `
    <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-5" onclick="event.stopPropagation()">
      <div class="flex justify-between items-start gap-3 mb-4">
        <h3 class="text-lg font-bold text-[#C19A6B] font-[Orbitron]">Kody rabatowe</h3>
        <button type="button" class="strzelca-promo-unapplied-close text-zinc-400 hover:text-white p-1" aria-label="Zamknij">
          <i class="fa-solid fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <p class="text-sm text-zinc-200 leading-relaxed">${escapeHtml(
        "Masz niezatwierdzone zmiany w polu kody rabatowe. Aby je zastosować należy kliknąć przycisk +. Czy mimo to chcesz kontynuować?",
      )}</p>
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
        <button type="button" class="strzelca-promo-unapplied-tak px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition">
          Tak
        </button>
        <button type="button" class="strzelca-promo-unapplied-no px-4 py-2 rounded-lg bg-[#C19A6B] text-black text-sm font-bold hover:bg-[#b18a5f] transition">
          Nie
        </button>
      </div>
    </div>
  `;
    modal.querySelector(".strzelca-promo-unapplied-close")?.addEventListener("click", () => finish(false));
    modal.querySelector(".strzelca-promo-unapplied-no")?.addEventListener("click", () => finish(false));
    modal.querySelector(".strzelca-promo-unapplied-tak")?.addEventListener("click", () => finish(true));
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  });
}

function updatePromoFeedback(result, tone = "info") {
  const box = document.getElementById("order-promo-feedback");
  if (!box) return;
  if (!result) {
    box.className = "hidden mt-3 rounded-lg border px-3 py-2 text-sm";
    box.innerHTML = "";
    return;
  }
  const palette =
    tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : "border-red-500/40 bg-red-500/10 text-red-100";
  box.className = `mt-3 rounded-lg border px-3 py-2 text-sm ${palette}`;
  box.innerHTML = escapeHtml(result.message || "");
}

function updateOrderPriceSummary() {
  const p = pendingForm;
  const finalEl = document.getElementById("order-price-final");
  const baseEl = document.getElementById("order-price-base");
  const discountEl = document.getElementById("order-price-discount");
  if (!p || !finalEl || !baseEl || !discountEl) return;

  if (p.individualPricing) {
    finalEl.textContent = "Wycena indywidualna";
    finalEl.className =
      "text-base md:text-lg text-[#C19A6B] font-bold leading-tight text-right break-words max-w-[14rem] md:max-w-[18rem] ml-auto";
    baseEl.className = "hidden text-xs text-zinc-500 line-through mt-1";
    baseEl.textContent = "";
    discountEl.className = "hidden text-xs text-emerald-300 mt-1";
    discountEl.textContent = "";
    return;
  }

  const basePrice = Math.max(0, Number(p.price) || 0);
  const appliedPromo = p.appliedPromo;
  if (!appliedPromo?.ok) {
    finalEl.textContent = basePrice > 0 ? formatMoney(basePrice) : "—";
    finalEl.className =
      basePrice > 0
        ? "text-[1.225rem] md:text-[1.4rem] text-[#C19A6B] font-bold tabular-nums leading-tight"
        : "text-zinc-500 text-[1.225rem] md:text-[1.4rem] leading-tight";
    baseEl.className = "hidden text-xs text-zinc-500 line-through mt-1";
    baseEl.textContent = "";
    discountEl.className = "hidden text-xs text-emerald-300 mt-1";
    discountEl.textContent = "";
    return;
  }

  finalEl.textContent = formatMoney(appliedPromo.finalPrice);
  finalEl.className =
    "text-[1.225rem] md:text-[1.4rem] text-emerald-300 font-bold tabular-nums leading-tight";
  baseEl.className = "text-xs text-zinc-500 line-through mt-1";
  baseEl.textContent = formatMoney(basePrice);
  discountEl.className = "text-xs text-emerald-300 mt-1";
  discountEl.textContent = `Rabat: -${formatMoney(appliedPromo.discountAmount)}`;
}

function closeRegulaminModal() {
  const el = document.getElementById("strzelca-regulamin-modal");
  if (el) el.remove();
}

function closeUnderlyingDetailsModal() {
  if (typeof window === "undefined") return;
  if (typeof window.closeDetailsModal === "function") {
    window.closeDetailsModal();
    return;
  }
  const detailsModal = document.getElementById("details-modal");
  if (detailsModal) detailsModal.classList.add("hidden");
  if (window.galleryKeyHandler) {
    document.removeEventListener("keydown", window.galleryKeyHandler);
    window.galleryKeyHandler = null;
  }
}

async function fetchRegulaminPlainText() {
  if (regulaminPlainTextCache != null) return regulaminPlainTextCache;
  const res = await fetch(REGULAMIN_TXT_URL, { credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  regulaminPlainTextCache = await res.text();
  return regulaminPlainTextCache;
}

async function fetchRegulaminRichHtml() {
  if (regulaminRichHtmlCache != null) return regulaminRichHtmlCache;
  const { renderRegulaminTxtToHtml } = await import("https://strzelca.pl/regulamin-txt-render.mjs?v=2026-04-12-1");
  const text = await fetchRegulaminPlainText();
  regulaminRichHtmlCache = renderRegulaminTxtToHtml(text, { includeFooter: true });
  return regulaminRichHtmlCache;
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
        <div id="strzelca-regulamin-body" class="p-4 md:p-6 overflow-y-auto text-sm text-zinc-300 custom-render max-w-none regulamin-modal-body"></div>
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
    const html = await fetchRegulaminRichHtml();
    bodyEl.innerHTML = html;
  } catch (err) {
    console.error("Regulamin:", err);
    const fb = REGULAMIN_TXT_URL.replace(/"/g, "&quot;");
    bodyEl.innerHTML = `<p class="text-red-400">Nie udało się wczytać regulaminu. Otwórz <a href="${fb}" target="_blank" rel="noopener noreferrer" class="text-[#C19A6B] underline">regulamin-witryny.txt</a> na dokumenty.strzelca.pl.</p>`;
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

function getOrderWizardSteps() {
  if (!pendingForm) return [];
  return pendingForm.context === "shop"
    ? ["type", "delivery", "customer", "summary"]
    : ["type", "customer", "summary"];
}

function getOrderFieldValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function setOrderFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = String(value || "");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function formatPostalCode(value) {
  const digits = digitsOnly(value).slice(0, 5);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function getOrderAddressFromInputs(prefix) {
  return cloneAddress({
    street: getOrderFieldValue(`${prefix}-street`),
    buildingNumber: getOrderFieldValue(`${prefix}-building`),
    postalCode: getOrderFieldValue(`${prefix}-postal`),
    city: getOrderFieldValue(`${prefix}-city`),
  });
}

function setOrderAddressInputs(prefix, address) {
  const a = cloneAddress(address);
  setOrderFieldValue(`${prefix}-street`, a.street);
  setOrderFieldValue(`${prefix}-building`, a.buildingNumber);
  setOrderFieldValue(`${prefix}-postal`, a.postalCode);
  setOrderFieldValue(`${prefix}-city`, a.city);
}

function getOrderCustomerType() {
  if (!pendingForm) return "";
  return pendingForm.customerType === "company" ? "company" : pendingForm.customerType === "private" ? "private" : "";
}

function isOrderCompany() {
  return getOrderCustomerType() === "company";
}

function getCurrentOrderDeliveryMethod() {
  return document.querySelector('input[name="order-delivery-method"]:checked')?.value || "";
}

function getCurrentOrderShippingCost() {
  if (!pendingForm || pendingForm.context !== "shop") return 0;
  const method = getCurrentOrderDeliveryMethod();
  if (method === "courier") return 30;
  if (method === "inpost") return 25;
  return 0;
}

function getCurrentOrderDiscountSnapshot() {
  const p = pendingForm;
  if (!p || p.individualPricing || !p.appliedPromo?.ok) {
    return {
      label: "—",
      discountAmount: 0,
      finalBasePrice: roundMoney(p?.price || 0),
    };
  }

  const promo = p.appliedPromo;
  let label = `- ${formatMoney(promo.discountAmount)}`;
  if (promo.application === "training_access") {
    label = `- 100% (${formatMoney(promo.discountAmount)})`;
  } else if (promo.discountType === "percent") {
    const percentValue = Number(promo.discountValue || 0);
    label = `- ${percentValue.toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}% (${formatMoney(promo.discountAmount)})`;
  }

  return {
    label,
    discountAmount: roundMoney(promo.discountAmount),
    finalBasePrice: roundMoney(promo.finalPrice),
  };
}

function syncOrderCustomerTypeUI() {
  const p = pendingForm;
  if (!p) return;

  const customerType = getOrderCustomerType();
  const isCompany = customerType === "company";
  const isPrivate = customerType === "private";
  const deliveryMethod = p.context === "shop" ? getCurrentOrderDeliveryMethod() : "";
  const showPrivateAddress = p.context === "shop" && isPrivate && deliveryMethod === "courier";
  const showAddress = isCompany || showPrivateAddress;
  const showParcelLocker = p.context === "shop" && deliveryMethod === "inpost";

  [["private", isPrivate], ["company", isCompany]].forEach(([type, active]) => {
    const card = document.getElementById(`order-type-card-${type}`);
    if (!card) return;
    card.className = active
      ? "rounded-3xl border border-[#C19A6B]/80 bg-[#C19A6B]/12 shadow-lg shadow-[#C19A6B]/10 px-5 py-5 text-left transition"
      : "rounded-3xl border border-zinc-700/80 bg-zinc-950/50 hover:border-zinc-500/80 hover:bg-zinc-900/70 px-5 py-5 text-left transition";
  });

  const companyFields = document.getElementById("order-company-fields");
  if (companyFields) companyFields.classList.toggle("hidden", !isCompany);

  const addressSection = document.getElementById("order-address-section");
  if (addressSection) addressSection.classList.toggle("hidden", !showAddress);
  const parcelSection = document.getElementById("order-parcel-section");
  if (parcelSection) parcelSection.classList.toggle("hidden", !showParcelLocker);

  const addressLabel = document.getElementById("order-address-label");
  if (addressLabel) {
    addressLabel.textContent = isCompany ? "Adres firmy" : "Adres dostawy";
  }
}

function syncOrderDeliveryUI() {
  const p = pendingForm;
  if (!p || p.context !== "shop") return;

  const method = getCurrentOrderDeliveryMethod();
  const courierCard = document.getElementById("order-delivery-card-courier");
  const inpostCard = document.getElementById("order-delivery-card-inpost");

  [courierCard, inpostCard].forEach((card, index) => {
    if (!card) return;
    const active = (index === 0 && method === "courier") || (index === 1 && method === "inpost");
    card.className = active
      ? "rounded-3xl border border-[#C19A6B]/80 bg-[#C19A6B]/12 shadow-lg shadow-[#C19A6B]/10 px-5 py-5 text-left transition"
      : "rounded-3xl border border-zinc-700/80 bg-zinc-950/50 hover:border-zinc-500/80 hover:bg-zinc-900/70 px-5 py-5 text-left transition";
  });

  const lockerField = document.getElementById("order-delivery-parcelLocker");
  if (lockerField) {
    if (method === "inpost" && !lockerField.value && p.profileParcelLocker) {
      lockerField.value = p.profileParcelLocker;
    }
  }
}

function updateOrderSummaryPanel() {
  const p = pendingForm;
  if (!p) return;

  const shippingCost = getCurrentOrderShippingCost();
  const discount = getCurrentOrderDiscountSnapshot();
  const total = p.individualPricing
    ? null
    : roundMoney(discount.finalBasePrice + (p.context === "shop" ? shippingCost : 0));
  const deliveryMethod = getCurrentOrderDeliveryMethod();
  const billingAddress = getOrderAddressFromInputs("order-address");
  const selectedDeliveryLabel =
    p.context !== "shop"
      ? "Brak dostawy"
      : deliveryMethod === "courier"
      ? `Kurier`
      : deliveryMethod === "inpost"
      ? `Paczkomat InPost`
      : "Nie wybrano";
  const summaryDeliveryHint =
    p.context !== "shop"
      ? "Szkolenia nie wymagają dostawy."
      : deliveryMethod === "courier"
      ? formatAddressInline(billingAddress) || "Uzupełnij adres dostawy."
      : deliveryMethod === "inpost"
      ? getOrderFieldValue("order-delivery-parcelLocker") || "Wpisz numer paczkomatu."
      : "Wybierz sposób dostawy.";

  const priceRow = document.getElementById("order-summary-price");
  const shippingRow = document.getElementById("order-summary-shipping");
  const discountRow = document.getElementById("order-summary-discount");
  const discountRowWrap = document.getElementById("order-summary-discount-row");
  const totalRow = document.getElementById("order-summary-total");
  const deliveryMethodRow = document.getElementById("order-summary-delivery-method");
  const deliveryHintRow = document.getElementById("order-summary-delivery-hint");
  const hasDiscount = !p.individualPricing && discount.discountAmount > 0;

  if (priceRow) priceRow.textContent = p.individualPricing ? "-" : formatMoney(p.price || 0);
  if (shippingRow) {
    shippingRow.textContent = p.individualPricing ? "-" : p.context === "shop" ? formatMoney(shippingCost) : formatMoney(0);
  }
  if (discountRow) discountRow.textContent = p.individualPricing ? "-" : discount.label;
  if (discountRowWrap) discountRowWrap.classList.toggle("hidden", !hasDiscount);
  if (totalRow) {
    totalRow.textContent = p.individualPricing
      ? "Cena ustalana po wycenie zamówienia."
      : formatMoney(total || 0);
    totalRow.className = p.individualPricing
      ? "text-right text-sm text-[#C19A6B] font-bold leading-snug max-w-[15rem]"
      : "text-right text-lg md:text-xl text-[#C19A6B] font-bold";
  }
  if (deliveryMethodRow) deliveryMethodRow.textContent = selectedDeliveryLabel;
  if (deliveryHintRow) deliveryHintRow.textContent = summaryDeliveryHint;

  updateOrderPriceSummary();
}

function refreshOrderWizardView() {
  const p = pendingForm;
  if (!p) return;

  const steps = getOrderWizardSteps();
  const maxStep = Math.max(0, steps.length - 1);
  p.step = Math.min(Math.max(0, Number(p.step) || 0), maxStep);

  syncOrderCustomerTypeUI();
  syncOrderDeliveryUI();
  updateOrderSummaryPanel();

  steps.forEach((step, index) => {
    const panel = document.getElementById(`order-step-${step}`);
    if (!panel) return;
    panel.classList.toggle("hidden", index !== p.step);
  });

  const indicators = document.getElementById("order-step-indicators");
  if (indicators) {
    indicators.style.gridTemplateColumns = `repeat(${steps.length}, minmax(0, 1fr))`;
    indicators.innerHTML = steps
      .map((step, index) => {
        const labelMap = {
          type: "Kupujący",
          customer: "Dane",
          delivery: "Dostawa",
          summary: "Podsumowanie",
        };
        const active = index === p.step;
        const complete = index < p.step;
        const classes = active
          ? "border-[#C19A6B] bg-[#C19A6B]/15 text-[#F3DEC0]"
          : complete
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
          : "border-zinc-700/80 bg-zinc-950/60 text-zinc-400";
        return `<div class="min-w-0 rounded-2xl border px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] ${classes}">
          <div class="text-[10px] opacity-80">Krok ${index + 1}</div>
          <div class="truncate mt-1">${labelMap[step] || step}</div>
        </div>`;
      })
      .join("");
  }

  const currentTitle = document.getElementById("order-current-step-title");
  if (currentTitle) {
    currentTitle.textContent =
      {
        type: "Kupujesz jako",
        delivery: "Sposób dostawy",
        customer: "Dane do zamówienia",
        summary: "Podsumowanie zamówienia",
      }[steps[p.step]] || "Zamówienie";
  }

  const backButton = document.getElementById("order-back-button");
  const nextButton = document.getElementById("order-next-button");
  const closeButton = document.getElementById("order-close-button");
  if (backButton) {
    backButton.classList.toggle("invisible", p.step === 0);
    backButton.disabled = p.step === 0 || p.isSubmitting === true;
  }
  if (nextButton) {
    nextButton.disabled = p.isSubmitting === true;
    nextButton.classList.toggle("opacity-70", p.isSubmitting === true);
    nextButton.classList.toggle("cursor-not-allowed", p.isSubmitting === true);
    if (p.step === maxStep && p.isSubmitting === true) {
      nextButton.innerHTML = `<span class="inline-flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Wysyłanie...</span></span>`;
    } else {
      nextButton.textContent = p.step === maxStep ? "Złóż zamówienie" : "Dalej";
    }
  }
  if (closeButton) {
    closeButton.disabled = p.isSubmitting === true;
    closeButton.classList.toggle("opacity-60", p.isSubmitting === true);
    closeButton.classList.toggle("cursor-not-allowed", p.isSubmitting === true);
  }

  const scrollBox = document.getElementById("order-form-scroll");
  if (scrollBox && p.renderedStep !== p.step) {
    scrollBox.scrollTop = 0;
  }
  p.renderedStep = p.step;
}

function renderOrderFormModal({
  cfg,
  context,
  rawTitle,
  price,
  db,
  auth,
  user,
  userProfile,
  itemId,
  individualPricing = false,
}) {
  const displayName = prefixDisplayTitle(context, rawTitle);
  const address = userProfile?.address || {};
  const decodedAddress = {
    street: b64DecodeUtf8(address.street || ""),
    buildingNumber: b64DecodeUtf8(address.buildingNumber || ""),
    postalCode: b64DecodeUtf8(address.postalCode || ""),
    city: b64DecodeUtf8(address.city || ""),
  };
  const firstNameVal = String(userProfile?.firstName || "").trim();
  const lastNameVal = String(userProfile?.lastName || "").trim();
  const phoneVal = userProfile?.phone ? b64DecodeUtf8(userProfile.phone) : "";
  const parcelLockerVal = userProfile?.parcelLocker ? b64DecodeUtf8(userProfile.parcelLocker) : "";
  const emailValue = String(userProfile?.email || user?.email || "").trim();
  const rawTitleSafe = escapeHtml(String(rawTitle || "").trim());

  pendingForm = {
    context,
    db,
    auth,
    displayName,
    price: roundMoney(price || 0),
    regulaminCfg: {
      docTitle: cfg.regulaminDocTitle,
    },
    customerType: "",
    showParcel: cfg.showParcel,
    showAddress: cfg.showAddress,
    successMessage: cfg.successMessage,
    itemId: String(itemId || ""),
    appliedPromo: null,
    individualPricing: individualPricing === true,
    step: 0,
    isSubmitting: false,
    profileAddress: cloneAddress(decodedAddress),
    profileParcelLocker: parcelLockerVal,
    companyNoticeAccepted: false,
  };

  const orderFieldClass =
    "w-full rounded-2xl border border-zinc-700/80 bg-zinc-950/75 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#C19A6B] focus:ring-1 focus:ring-[#C19A6B]/40";
  const tileClass =
    "rounded-3xl border border-zinc-700/80 bg-zinc-950/50 px-5 py-5 text-left transition";

  const modal = document.createElement("div");
  modal.id = "order-form-modal";
  modal.className =
    "fixed inset-0 z-[200] flex items-center justify-center p-3 md:p-5 bg-black/90 backdrop-blur-md";

  const disclaimerText =
    context === "shop"
      ? "Złożenie zamówienia nie jest jednoznaczne z uzyskaniem przedmiotu aukcji. Decyzję podejmuje obsługa na podstawie dostępności produktów."
      : "Złożenie zamówienia nie jest jednoznaczne z uzyskaniem dostępu do szkolenia. Decyzję podejmuje obsługa na podstawie dostępności oferty.";

  modal.innerHTML = `
    <div class="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col rounded-[28px] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(18,18,18,0.96),rgba(8,8,8,0.96))] shadow-2xl shadow-black/60 overflow-hidden" onclick="event.stopPropagation()">
      <button type="button" id="order-close-button" onclick="document.getElementById('order-form-modal').remove(); window.__strzelcaClearPendingOrder && window.__strzelcaClearPendingOrder();"
              class="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700/80 bg-black/40 text-zinc-300 hover:border-zinc-500 hover:text-white transition"
              aria-label="Zamknij">
        <i class="fa-solid fa-times text-lg" aria-hidden="true"></i>
      </button>

      <div class="border-b border-zinc-800/90 bg-black/30 px-5 py-5 md:px-8 md:py-6 pr-20 md:pr-24">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-[0.32em] text-zinc-500 font-semibold">FORMULARZ ZAMÓWIENIA</p>
            <h2 class="mt-2 text-xl md:text-2xl font-black uppercase font-[Orbitron] text-white leading-tight">${rawTitleSafe}</h2>
            <p id="order-current-step-title" class="mt-3 text-sm text-[#D2B48C] font-semibold">Kupujesz jako</p>
          </div>
          <div id="order-price-summary" class="text-left md:text-right shrink-0 max-w-full">
            <div id="order-price-final" class="${individualPricing ? "text-base md:text-lg text-[#C19A6B] font-bold leading-tight break-words max-w-[14rem] md:max-w-[18rem]" : price > 0 ? "text-[1.3rem] md:text-[1.55rem] text-[#C19A6B] font-bold tabular-nums leading-tight" : "text-zinc-500 text-[1.3rem] md:text-[1.55rem] leading-tight"}">${individualPricing ? "Cena ustalana indywidualnie" : price > 0 ? formatMoney(price) : "—"}</div>
            <div id="order-price-base" class="hidden text-xs text-zinc-500 line-through mt-1"></div>
            <div id="order-price-discount" class="hidden text-xs text-emerald-300 mt-1"></div>
          </div>
        </div>
        <div id="order-step-indicators" class="mt-5 grid gap-2"></div>
      </div>

      <form id="shop-order-form" class="flex min-h-0 flex-1 flex-col">
        <div id="order-form-scroll" class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-7">
          <section id="order-step-type" class="space-y-4">
            <div class="grid gap-4 md:grid-cols-2">
              <button type="button" id="order-type-card-private" onclick="window.selectStrzelcaOrderCustomerType('private')" class="${tileClass} py-6 md:py-7 text-center flex items-center justify-center">
                <div class="text-xl font-black text-white uppercase font-[Orbitron]">OSOBA PRYWATNA</div>
              </button>
              <button type="button" id="order-type-card-company" onclick="window.selectStrzelcaOrderCustomerType('company')" class="${tileClass} py-6 md:py-7 text-center flex items-center justify-center">
                <div class="text-xl font-black text-white uppercase font-[Orbitron]">FIRMA</div>
              </button>
            </div>
          </section>

          <section id="order-step-delivery" class="hidden space-y-4">
            <div class="p-0">
              <div class="grid gap-4 md:grid-cols-2">
                <button type="button" id="order-delivery-card-courier" onclick="window.selectStrzelcaOrderDeliveryMethod('courier')" class="${tileClass}">
                  <input type="radio" name="order-delivery-method" value="courier" class="sr-only">
                  <div class="text-xl font-black text-white font-[Orbitron]">Kurier</div>
                  <p class="mt-2 text-sm text-zinc-400">Koszt 30,00 zł</p>
                </button>
                <button type="button" id="order-delivery-card-inpost" onclick="window.selectStrzelcaOrderDeliveryMethod('inpost')" class="${tileClass}">
                  <input type="radio" name="order-delivery-method" value="inpost" class="sr-only">
                  <div class="text-xl font-black text-white font-[Orbitron]">Paczkomat InPost</div>
                  <p class="mt-2 text-sm text-zinc-400">Koszt: 25,00 zł</p>
                </button>
              </div>
            </div>
          </section>

          <section id="order-step-customer" class="hidden space-y-6">
            <div class="rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6">
              <div class="flex flex-col gap-1 mb-4">
                <h3 class="text-lg font-bold text-white">Dane osobowe</h3>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Imię</label>
                  <input type="text" id="order-first-name" value="${escapeHtml(firstNameVal)}" class="${orderFieldClass}" placeholder="Imię" autocomplete="given-name">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Nazwisko</label>
                  <input type="text" id="order-last-name" value="${escapeHtml(lastNameVal)}" class="${orderFieldClass}" placeholder="Nazwisko" autocomplete="family-name">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Adres e-mail</label>
                  <input type="email" id="order-email" value="${escapeHtml(emailValue)}" class="${orderFieldClass} bg-zinc-900/90 text-zinc-500 cursor-not-allowed opacity-75" readonly aria-readonly="true" title="Adres e-mail z konta">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Numer telefonu</label>
                  <input type="tel" id="order-phone" value="${escapeHtml(phoneVal)}" class="${orderFieldClass}" placeholder="Numer telefonu" autocomplete="tel" inputmode="numeric">
                </div>
              </div>
            </div>

            <div id="order-company-fields" class="hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6">
              <div class="flex flex-col gap-1 mb-4">
                <h3 class="text-lg font-bold text-white">Dane firmy</h3>
                <p class="text-sm text-zinc-500">
                  Zamówienie firmowe: dokument bez VAT do odliczenia —
                  <button type="button" class="text-[#C19A6B] font-medium underline underline-offset-2 hover:text-white transition" onclick="window.openStrzelcaVatExemptInfoModal && window.openStrzelcaVatExemptInfoModal()">faktura zwolniona z VAT</button>.
                </p>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Nazwa firmy</label>
                  <input type="text" id="order-company-name" class="${orderFieldClass}" placeholder="Nazwa firmy" autocomplete="organization">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">NIP</label>
                  <input type="text" id="order-tax-id" class="${orderFieldClass}" placeholder="NIP" inputmode="numeric" autocomplete="off" maxlength="10">
                </div>
              </div>
            </div>

            <div id="order-address-section" class="hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6">
              <div class="flex flex-col gap-1 mb-4">
                <h3 class="text-lg font-bold text-white" id="order-address-label">Adres</h3>
              </div>
              <div class="grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Ulica</label>
                  <input type="text" id="order-address-street" value="${escapeHtml(decodedAddress.street)}" class="${orderFieldClass}" placeholder="Ulica">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Nr budynku / nr lokalu</label>
                  <input type="text" id="order-address-building" value="${escapeHtml(decodedAddress.buildingNumber)}" class="${orderFieldClass}" placeholder="Nr budynku / nr lokalu">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Miejscowość</label>
                  <input type="text" id="order-address-city" value="${escapeHtml(decodedAddress.city)}" class="${orderFieldClass}" placeholder="Miejscowość">
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod pocztowy</label>
                  <input type="text" id="order-address-postal" value="${escapeHtml(decodedAddress.postalCode)}" class="${orderFieldClass}" placeholder="Kod pocztowy">
                </div>
              </div>
            </div>
            <div id="order-parcel-section" class="hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6">
              <div class="flex flex-col gap-1 mb-4">
                <h3 class="text-lg font-bold text-white">Numer paczkomatu</h3>
              </div>
              <div>
                <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 mb-2">Numer paczkomatu</label>
                <input type="text" id="order-delivery-parcelLocker" value="${escapeHtml(parcelLockerVal)}" class="${orderFieldClass}" placeholder="Np. WRO123M">
              </div>
            </div>
          </section>

          <section id="order-step-summary" class="hidden space-y-6">
            <div class="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
              <div class="${individualPricing ? "h-full" : "grid h-full gap-5 lg:grid-rows-2"}">
                ${individualPricing ? "" : `
                <div class="rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6 h-full flex flex-col">
                  <h3 class="text-lg font-bold text-white mb-3">Kod rabatowy</h3>
                  <div class="relative">
                    <input
                      type="text"
                      id="order-promo-code"
                      class="${orderFieldClass} pr-14"
                      placeholder="Wpisz kod rabatowy"
                      autocomplete="off"
                      spellcheck="false"
                    >
                    <button
                      type="button"
                      onclick="window.applyStrzelcaPromoCode()"
                      class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#E9D3B7] hover:bg-[#C19A6B]/20 transition"
                      aria-label="Zastosuj kod"
                    >
                      <i class="fa-solid fa-plus" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div id="order-promo-feedback" class="hidden mt-3 rounded-2xl border px-4 py-3 text-sm"></div>
                </div>`}

                <div class="rounded-3xl border border-zinc-800/80 bg-zinc-950/45 p-5 md:p-6 h-full flex flex-col">
                  <h3 class="text-lg font-bold text-white mb-3">Dodatkowe informacje</h3>
                  <textarea id="order-notes" class="${orderFieldClass} flex-1 min-h-[220px] lg:min-h-0" placeholder="Dodatkowe informacje dot. zamówienia lub dostawy."></textarea>
                </div>
              </div>

              <div class="rounded-3xl border border-[#C19A6B]/25 bg-[linear-gradient(180deg,rgba(193,154,107,0.10),rgba(12,12,12,0.82))] p-5 md:p-6 h-full flex flex-col">
                <h3 class="text-lg font-bold text-white mb-4">Podsumowanie</h3>
                <div class="space-y-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-zinc-400">Cena</span>
                    <span id="order-summary-price" class="text-right text-zinc-100 font-medium">—</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-zinc-400">Wysyłka</span>
                    <span id="order-summary-shipping" class="text-right text-zinc-100 font-medium">—</span>
                  </div>
                  <div id="order-summary-discount-row" class="hidden flex items-center justify-between gap-3">
                    <span class="text-zinc-400">Rabat</span>
                    <span id="order-summary-discount" class="text-right text-emerald-300 font-medium">—</span>
                  </div>
                  <div class="flex items-start justify-between gap-3">
                    <span class="text-zinc-400">Dostawa</span>
                    <span id="order-summary-delivery-method" class="text-right text-zinc-100 font-medium max-w-[16rem] break-words">—</span>
                  </div>
                  <div id="order-summary-delivery-hint" class="text-xs text-zinc-500"></div>
                  <div class="border-t border-zinc-700/80 pt-4 flex items-start justify-between gap-3">
                    <span class="text-zinc-200 font-semibold">Razem</span>
                    <span id="order-summary-total" class="text-right text-lg md:text-xl text-[#C19A6B] font-bold">—</span>
                  </div>
                </div>

                <p class="mt-4 text-xs leading-relaxed text-zinc-500">
                  Dokument sprzedaży:
                  <button type="button" class="text-[#C19A6B] font-medium underline underline-offset-2 hover:text-white transition" onclick="window.openStrzelcaVatExemptInfoModal && window.openStrzelcaVatExemptInfoModal()">faktura zwolniona z VAT</button>
                  — bez podatku VAT na dokumencie (brak VAT do odliczenia dla firm).
                </p>

                <p class="mt-auto pt-5 text-[12px] leading-relaxed text-zinc-500">
                  ${escapeHtml(disclaimerText)}
                  Złożenie zamówienia oznacza akceptację
                  <button type="button" class="text-inherit hover:underline underline-offset-2 transition" onclick="window.openStrzelcaRegulaminModal(event)">${escapeHtml(cfg.regulaminLinkLabel)}u</button>
                  i jest zobowiązujące.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-zinc-800/90 bg-black/25 px-5 py-4 md:px-8">
          <button type="button" id="order-back-button" onclick="window.prevStrzelcaOrderStep()" class="inline-flex items-center justify-center rounded-2xl border border-zinc-700/80 bg-zinc-900/60 px-5 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 transition">
            Cofnij
          </button>
          <button type="button" id="order-next-button" onclick="window.nextStrzelcaOrderStep()" class="inline-flex items-center justify-center rounded-2xl bg-[#C19A6B] px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-black shadow-lg shadow-[#C19A6B]/10 hover:bg-[#b18a5f] transition">
            Dalej
          </button>
        </div>
      </form>

      <div id="strzelca-order-company-info-modal" class="hidden fixed inset-0 z-[230] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
           role="dialog" aria-modal="true" aria-labelledby="strzelca-order-company-info-title">
        <div class="w-full max-w-md rounded-[28px] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(24,24,24,0.98),rgba(8,8,8,0.98))] p-6 shadow-2xl" onclick="event.stopPropagation()">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Informacja</div>
              <h3 id="strzelca-order-company-info-title" class="mt-2 text-xl font-black text-white font-[Orbitron]">Zakup jako firma</h3>
            </div>
            <button type="button" onclick="window.cancelStrzelcaOrderCompanyMode()" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700/80 text-zinc-400 hover:text-white transition" aria-label="Zamknij">
              <i class="fa-solid fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <p class="mt-4 text-sm leading-relaxed text-zinc-300">Dokument sprzedaży będzie wystawiony jako faktura zwolniona z VAT (bez naliczonego podatku VAT na dokumencie).</p>
          <button type="button" onclick="window.openStrzelcaVatExemptInfoModal && window.openStrzelcaVatExemptInfoModal()" class="mt-4 w-full rounded-2xl border border-[#C19A6B]/35 bg-[#C19A6B]/10 px-4 py-3 text-sm font-semibold text-[#C19A6B] hover:bg-[#C19A6B]/20 transition">Czym jest faktura zwolniona z VAT?</button>
          <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onclick="window.cancelStrzelcaOrderCompanyMode()" class="rounded-2xl border border-zinc-700/80 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 transition">
              Cofnij
            </button>
            <button type="button" onclick="window.confirmStrzelcaOrderCompanyMode()" class="rounded-2xl bg-[#C19A6B] px-4 py-3 text-sm font-bold text-black hover:bg-[#b18a5f] transition">
              Akceptuję
            </button>
          </div>
        </div>
      </div>

      <div id="strzelca-vat-exempt-info-modal" class="hidden fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
           role="dialog" aria-modal="true" aria-labelledby="strzelca-vat-exempt-title"
           onclick="if (event.target === this) window.closeStrzelcaVatExemptInfoModal && window.closeStrzelcaVatExemptInfoModal()">
        <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[28px] border border-zinc-800/90 bg-[linear-gradient(180deg,rgba(24,24,24,0.98),rgba(8,8,8,0.98))] p-6 shadow-2xl" onclick="event.stopPropagation()">
          <div class="flex items-start justify-between gap-3">
            <h3 id="strzelca-vat-exempt-title" class="text-xl font-black text-white font-[Orbitron]">Faktura zwolniona z VAT</h3>
            <button type="button" onclick="window.closeStrzelcaVatExemptInfoModal && window.closeStrzelcaVatExemptInfoModal()" class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700/80 text-zinc-400 hover:text-white transition" aria-label="Zamknij">
              <i class="fa-solid fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <div class="mt-4 space-y-4 text-sm leading-relaxed text-zinc-300">
            <p><strong class="text-white">Faktura zwolniona z VAT</strong> to dokument sprzedaży wystawiany, gdy sprzedawca korzysta ze zwolnienia z podatku VAT (m.in. na podstawie art. 113 ustawy o VAT). Na takim dokumencie nie ma podziałki netto / VAT — płacisz wyłącznie kwotę brutto widoczną przy zamówieniu.</p>
            <p><strong class="text-white">Klient prywatny:</strong> nadal otrzymujesz normalny dowód zakupu do reklamacji i kontaktu z obsługą. Dla zakupów na własny użytek <strong class="text-white">nic „ekstra” z tego tytułu się nie zmienia</strong> — po prostu nie ma na dokumencie VAT do odliczenia.</p>
            <p><strong class="text-white">Firma:</strong> nie jest to faktura VAT z podatkiem do odliczenia w rozliczeniu firmy. Jeśli potrzebujecie pełnej faktury VAT od podatnika VAT, musicie ustalić to bezpośrednio ze sprzedawcą (inna ścieżka dokumentowa).</p>
          </div>
          <button type="button" onclick="window.closeStrzelcaVatExemptInfoModal && window.closeStrzelcaVatExemptInfoModal()" class="mt-6 w-full rounded-2xl bg-[#C19A6B] px-4 py-3 text-sm font-bold text-black hover:bg-[#b18a5f] transition">Rozumiem</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  window.openStrzelcaVatExemptInfoModal = function openStrzelcaVatExemptInfoModal() {
    document.getElementById("strzelca-vat-exempt-info-modal")?.classList.remove("hidden");
  };
  window.closeStrzelcaVatExemptInfoModal = function closeStrzelcaVatExemptInfoModal() {
    document.getElementById("strzelca-vat-exempt-info-modal")?.classList.add("hidden");
  };

  const liveIds = [
    "order-first-name",
    "order-last-name",
    "order-phone",
    "order-company-name",
    "order-tax-id",
    "order-address-street",
    "order-address-building",
    "order-address-postal",
    "order-address-city",
    "order-delivery-parcelLocker",
    "order-notes",
  ];
  liveIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => window.refreshStrzelcaOrderWizard?.());
  });

  const phoneInput = document.getElementById("order-phone");
  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      phoneInput.value = digitsOnly(phoneInput.value).slice(0, 15);
      window.refreshStrzelcaOrderWizard?.();
    });
  }

  const taxIdInput = document.getElementById("order-tax-id");
  if (taxIdInput) {
    taxIdInput.addEventListener("input", () => {
      taxIdInput.value = digitsOnly(taxIdInput.value).slice(0, 10);
      window.refreshStrzelcaOrderWizard?.();
    });
  }

  ["order-address-postal"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      el.value = formatPostalCode(el.value);
      window.refreshStrzelcaOrderWizard?.();
    });
  });

  const promoInput = document.getElementById("order-promo-code");
  if (promoInput) {
    promoInput.addEventListener("input", () => {
      if (pendingForm) pendingForm.appliedPromo = null;
      updatePromoFeedback(null);
      window.refreshStrzelcaOrderWizard?.();
    });
  }

  window.refreshStrzelcaOrderWizard?.();
}

function showLoginModal(cfg, rawTitle, flowDeps) {
  const modal = document.createElement("div");
  modal.id = "order-login-modal";
  modal.className =
    "fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md";
  if (typeof window !== "undefined" && flowDeps) {
    window.__strzelcaPendingLoginFlowDeps = { ...flowDeps };
  }
  modal.onclick = function (e) {
    if (e.target.id === "order-login-modal") {
      if (typeof window !== "undefined") window.__strzelcaPendingLoginFlowDeps = null;
      modal.remove();
    }
  };

  const loginHref = `https://konto.strzelca.pl/logowanie.html?redirect=${encodeURIComponent(window.location.href)}`;
  const registerHref = "https://konto.strzelca.pl/rejestracja.html";

  modal.innerHTML = `
    <div class="bg-zinc-900 p-8 rounded-2xl max-w-md w-full border border-zinc-800 shadow-2xl" onclick="event.stopPropagation()">
      <h2 class="text-2xl font-bold text-[#C19A6B] font-[Orbitron] mb-4">Wymagane konto</h2>
      <p class="text-zinc-300 mb-6">
        Do złożenia zamówienia wymagane jest konto.
        <a href="${loginHref}" data-open-login-modal class="text-[#C19A6B] hover:underline font-semibold">Zaloguj się</a>
        lub
        <a href="${registerHref}" class="text-[#C19A6B] hover:underline font-semibold">załóż konto</a>.
      </p>
      <div class="space-y-3">
        <a href="${loginHref}" data-open-login-modal
           class="block w-full bg-[#C19A6B] text-black px-6 py-3 rounded-lg font-bold text-center hover:bg-[#b18a5f] transition">
          <i class="fa-solid fa-sign-in-alt mr-2" aria-hidden="true"></i>
          Zaloguj się
        </a>
        <a href="${registerHref}"
           class="block w-full border border-zinc-700 text-zinc-300 px-6 py-3 rounded-lg font-bold text-center hover:bg-zinc-800 transition">
          <i class="fa-solid fa-user-plus mr-2" aria-hidden="true"></i>
          Załóż konto
        </a>
        <button type="button" onclick="window.__strzelcaPendingLoginFlowDeps=null;this.closest('#order-login-modal').remove()"
                class="block w-full text-zinc-400 px-6 py-2 text-sm hover:text-white transition">
          Anuluj
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  updateOrderPriceSummary();
  const promoInput = document.getElementById("order-promo-code");
  if (promoInput) {
    promoInput.addEventListener("input", () => {
      if (pendingForm) pendingForm.appliedPromo = null;
      updatePromoFeedback(null);
      updateOrderPriceSummary();
    });
  }
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
 * @param {string} [deps.itemId]
 * @param {boolean} [deps.individualPricing]
 */
export async function openOrderInquiryFlow(deps) {
  const {
    auth,
    db,
    getDoc,
    doc,
    context,
    rawTitle,
    price = 0,
    itemId = "",
    individualPricing = false,
  } = deps;
  const cfg = CONTEXT[context];
  if (!cfg) {
    console.error("openOrderInquiryFlow: nieznany context", context);
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    showLoginModal(cfg, rawTitle, {
      auth,
      db,
      getDoc,
      doc,
      context,
      rawTitle,
      price,
      itemId,
      individualPricing,
    });
    return;
  }

  let userProfile = null;
  try {
    const profileDoc = await getDoc(doc(db, "userProfiles", user.uid));
    if (profileDoc.exists()) userProfile = profileDoc.data();
  } catch (error) {
    console.error("Error loading user profile:", error);
  }

  renderOrderFormModal({
    cfg,
    context,
    rawTitle,
    price,
    db,
    auth,
    user,
    userProfile,
    itemId,
    individualPricing,
  });
}

function attachOrderInquiryGlobals() {
  if (typeof window === "undefined") return;

  window.strzelcaCloseKontaktEmbedModal = function () {
    document.getElementById("strzelca-kontakt-embed-modal")?.remove();
    if (window.__strzelcaKontaktEmbedOnMessage) {
      window.removeEventListener("message", window.__strzelcaKontaktEmbedOnMessage);
      window.__strzelcaKontaktEmbedOnMessage = null;
    }
  };

  window.__strzelcaOpenKontaktEmbedFromTraining = function () {
    const d = window.__strzelcaPendingLoginFlowDeps;
    document.getElementById("order-login-modal")?.remove();
    window.__strzelcaPendingLoginFlowDeps = null;
    if (!d || d.context !== "training") return;
    openKontaktEmbedModal(kontaktPrefillForTraining(d.rawTitle));
  };

  window.closeStrzelcaRegulaminModal = closeRegulaminModal;

  window.openStrzelcaRegulaminModal = async function (ev) {
    const cfg = pendingForm?.regulaminCfg;
    if (!cfg) return;
    await openRegulaminModal(ev, cfg);
  };

  function reportOrderFields(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const rawValue = typeof el.value === "string" ? el.value : String(el.value ?? "");
      const value = rawValue.trim();
      if (typeof el.setCustomValidity === "function") {
        el.setCustomValidity(value ? "" : "To pole jest wymagane");
      }
      if (typeof el.reportValidity === "function" && !el.reportValidity()) {
        try {
          el.focus({ preventScroll: false });
        } catch {
          el.focus();
        }
        return false;
      }
    }
    return true;
  }

  function validateCurrentOrderStep() {
    const p = pendingForm;
    if (!p) return false;

    const stepKey = getOrderWizardSteps()[p.step];
    if (stepKey === "type") {
      if (!getOrderCustomerType()) {
        alert("Wybierz, czy kupujesz jako osoba prywatna, czy firma.");
        return false;
      }
      return true;
    }

    if (stepKey === "customer" || stepKey === "summary") {
      const customerType = getOrderCustomerType();
      const requiredIds = ["order-email", "order-phone"];
      const deliveryMethod = p.context === "shop" ? getCurrentOrderDeliveryMethod() : "";
      requiredIds.push("order-first-name", "order-last-name");
      if (customerType === "company") {
        requiredIds.push(
          "order-company-name",
          "order-tax-id",
          "order-address-street",
          "order-address-building",
          "order-address-postal",
          "order-address-city"
        );
      } else if (p.context === "shop" && deliveryMethod === "courier") {
        requiredIds.push(
          "order-address-street",
          "order-address-building",
          "order-address-postal",
          "order-address-city"
        );
      }
      if (p.context === "shop" && deliveryMethod === "inpost") {
        requiredIds.push("order-delivery-parcelLocker");
      }
      return reportOrderFields(requiredIds);
    }

    if (stepKey === "delivery") {
      const method = getCurrentOrderDeliveryMethod();
      if (!method) {
        alert("Wybierz sposób dostawy.");
        return false;
      }
      return true;
    }

    return true;
  }

  window.refreshStrzelcaOrderWizard = function () {
    if (!pendingForm) return;
    refreshOrderWizardView();
  };

  window.selectStrzelcaOrderCustomerType = function (type) {
    if (!pendingForm) return;
    pendingForm.customerType = type === "company" ? "company" : "private";
    if (pendingForm.customerType !== "company") {
      pendingForm.companyNoticeAccepted = false;
      pendingForm.step = Math.min(1, getOrderWizardSteps().length - 1);
    }
    window.refreshStrzelcaOrderWizard();
    if (pendingForm.customerType === "company") {
      document.getElementById("strzelca-order-company-info-modal")?.classList.remove("hidden");
    }
  };

  window.selectStrzelcaOrderDeliveryMethod = function (method) {
    if (!pendingForm) return;
    const normalizedMethod = method === "inpost" ? "inpost" : "courier";
    const radio = document.querySelector(`input[name="order-delivery-method"][value="${normalizedMethod}"]`);
    if (radio) radio.checked = true;
    window.refreshStrzelcaOrderWizard();
    if (getOrderWizardSteps()[pendingForm.step] !== "delivery") return;
    if (!validateCurrentOrderStep()) return;
    pendingForm.step = Math.min(pendingForm.step + 1, getOrderWizardSteps().length - 1);
    window.refreshStrzelcaOrderWizard();
  };

  window.prevStrzelcaOrderStep = function () {
    if (!pendingForm || pendingForm.isSubmitting === true) return;
    pendingForm.step = Math.max(0, (Number(pendingForm.step) || 0) - 1);
    window.refreshStrzelcaOrderWizard();
  };

  window.nextStrzelcaOrderStep = async function () {
    const p = pendingForm;
    if (!p || p.isSubmitting === true) return;
    const steps = getOrderWizardSteps();
    const currentStep = steps[p.step];
    const lastStep = steps.length - 1;

    if (currentStep === "type" && getOrderCustomerType() === "company" && p.companyNoticeAccepted !== true) {
      document.getElementById("strzelca-order-company-info-modal")?.classList.remove("hidden");
      return;
    }

    if (!validateCurrentOrderStep()) return;

    if (p.step >= lastStep) {
      await window.submitStrzelcaOrderInquiry();
      return;
    }

    p.step += 1;
    window.refreshStrzelcaOrderWizard();
  };

  window.cancelStrzelcaOrderCompanyMode = function () {
    if (pendingForm && pendingForm.step === 0 && pendingForm.companyNoticeAccepted !== true) {
      pendingForm.customerType = "";
      window.refreshStrzelcaOrderWizard();
    }
    document.getElementById("strzelca-order-company-info-modal")?.classList.add("hidden");
  };

  window.confirmStrzelcaOrderCompanyMode = function () {
    if (!pendingForm) return;
    pendingForm.customerType = "company";
    pendingForm.companyNoticeAccepted = true;
    document.getElementById("strzelca-order-company-info-modal")?.classList.add("hidden");
    if (pendingForm.step === 0) pendingForm.step = 1;
    window.refreshStrzelcaOrderWizard();
  };

  window.__strzelcaClearPendingOrder = function () {
    pendingForm = null;
  };

  window.applyStrzelcaPromoCode = async function () {
    const p = pendingForm;
    if (!p) return;
    if (p.individualPricing) {
      showPromoNotice({ message: "Dla produktów z ceną ustalaną indywidualnie kody promocyjne nie są dostępne." });
      return;
    }
    const input = document.getElementById("order-promo-code");
    if (!input) return;

    const code = String(input.value || "").trim();
    if (!code) {
      p.appliedPromo = null;
      updatePromoFeedback({ message: "Wpisz kod promocyjny." }, "error");
      window.refreshStrzelcaOrderWizard();
      return;
    }

    try {
      const user = p.auth.currentUser;
      if (!user) {
        showPromoNotice({ message: "Musisz być zalogowany, aby użyć kodu." });
        return;
      }

      const idToken = await user.getIdToken();
      const response = await fetch(STRZELCA_PROMO_CODES_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        credentials: "include",
        body: JSON.stringify({
          action: "validate",
          code,
          context: p.context,
          trainingId: p.context === "training" ? p.itemId || "" : "",
          basePrice: p.price || 0,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Nie udało się sprawdzić kodu.");
      }

      const result = payload.data || {};
      if (!result.ok) {
        p.appliedPromo = null;
        updatePromoFeedback(result, "error");
        window.refreshStrzelcaOrderWizard();
        showPromoNotice(result);
        return;
      }

      p.appliedPromo = { ok: true, ...result };
      updatePromoFeedback({ message: result.customerMessage || "Kod został zastosowany." }, "success");
      window.refreshStrzelcaOrderWizard();
    } catch (error) {
      console.error("Promo code validation failed:", error);
      p.appliedPromo = null;
      updatePromoFeedback({ message: error.message || "Nie udało się sprawdzić kodu." }, "error");
      window.refreshStrzelcaOrderWizard();
      showPromoNotice({ message: error.message || "Nie udało się sprawdzić kodu." });
    }
  };

  window.submitStrzelcaOrderInquiry = async function (event) {
    if (event?.preventDefault) event.preventDefault();
    const p = pendingForm;
    if (!p || p.isSubmitting === true) return;

    try {
      if (!validateCurrentOrderStep()) {
        return;
      }

      if (!p.individualPricing) {
        const promoDraft = getOrderFieldValue("order-promo-code");
        if (promoDraft && !p.appliedPromo?.ok) {
          const proceed = await showUnappliedPromoConfirmModal();
          if (!proceed) return;
        }
      }

      const user = p.auth.currentUser;
      if (!user) {
        alert("Musisz być zalogowany.");
        return;
      }

      const customerType = getOrderCustomerType();
      const deliveryMethod = p.context === "shop" ? getCurrentOrderDeliveryMethod() : "";
      const billingAddress =
        customerType === "company" || (p.context === "shop" && deliveryMethod === "courier")
          ? getOrderAddressFromInputs("order-address")
          : blankAddress();
      const deliveryAddress =
        deliveryMethod === "courier" ? cloneAddress(billingAddress) : blankAddress();
      const shippingCost = p.context === "shop" ? getCurrentOrderShippingCost() : 0;
      p.isSubmitting = true;
      window.refreshStrzelcaOrderWizard();

      const orderData = {
        userId: user.uid,
        email: getOrderFieldValue("order-email"),
        orderDetails: p.displayName,
        firstName: getOrderFieldValue("order-first-name"),
        lastName: getOrderFieldValue("order-last-name"),
        customerType,
        isCompany: customerType === "company",
        companyName: customerType === "company" ? getOrderFieldValue("order-company-name") : "",
        taxId: customerType === "company" ? getOrderFieldValue("order-tax-id") : "",
        notes: getOrderFieldValue("order-notes") || "",
        phone: getOrderFieldValue("order-phone") || "",
        parcelLocker: deliveryMethod === "inpost" ? getOrderFieldValue("order-delivery-parcelLocker") || "" : "",
        address: billingAddress,
        deliveryMethod,
        deliverySameAsBilling: deliveryMethod === "courier",
        deliveryAddress,
        price: p.price || 0,
        individualPricing: p.individualPricing === true,
        shipping: shippingCost,
        additionalCosts: 0,
        tax: 0,
        status: "zlozone",
        promoCode: p.individualPricing ? "" : getOrderFieldValue("order-promo-code") || "",
        orderContext: p.context,
        orderItemId: p.itemId || "",
        orderItemTitle: rawTitleFromDisplayName(p.displayName, p.context),
      };

      const idToken = await user.getIdToken();
      const response = await fetch(STRZELCA_ORDERS_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        credentials: "include",
        body: JSON.stringify(orderData),
      });

      const data = await response.json().catch(() => ({}));

      if (!data.success) {
        if (data.promoCodeError) {
          p.appliedPromo = null;
          updatePromoFeedback(data.promoCodeError, "error");
          window.refreshStrzelcaOrderWizard();
          showPromoNotice(data.promoCodeError);
        }
        throw new Error(data.error || "Nie udało się zapisać zamówienia");
      }

      document.getElementById("order-form-modal")?.remove();
      closeUnderlyingDetailsModal();
      document.getElementById("strzelca-promo-notice-modal")?.classList.add("hidden");
      document.getElementById("strzelca-promo-notice-modal")?.classList.remove("flex");
      const trainingAccessTitle =
        String(p.appliedPromo?.trainingTitle || "").trim() ||
        String(p.appliedPromo?.codeData?.targetTrainingTitle || "").trim() ||
        rawTitleFromDisplayName(p.displayName, p.context);
      const successMessage =
        p.appliedPromo?.application === "training_access"
          ? `Uzyskano dostęp do szkolenia: ${trainingAccessTitle}`.trim()
          : p.successMessage;
      logOrderActivity(p.db, user, p.displayName, p.context).catch((logError) => {
        console.error("Błąd podczas logowania aktywności zamówienia:", logError);
      });
      const orderCreatedDetail = {
        context: p.context,
        orderItemId: p.itemId || "",
        userId: user.uid,
        promoApplication: p.appliedPromo?.application || "",
      };

      pendingForm = null;
      window.dispatchEvent(new CustomEvent("strzelca-order-created", { detail: orderCreatedDetail }));
      alert(successMessage);
      if (orderCreatedDetail.context === "training" && orderCreatedDetail.promoApplication === "training_access") {
        void (async () => {
          try {
            await window.fetchAllTrainings?.();
          } catch (e) {
            console.error("fetchAllTrainings po kodzie dostępu:", e);
          }
          const detailsModal = document.getElementById("details-modal");
          if (detailsModal && !detailsModal.classList.contains("hidden")) {
            const oid = String(orderCreatedDetail.orderItemId || "").trim();
            if (oid) void window.showTrainingDetails?.(oid);
          }
        })();
      }
    } catch (error) {
      console.error("Error submitting order:", error);
      if (pendingForm) {
        pendingForm.isSubmitting = false;
        window.refreshStrzelcaOrderWizard();
      }
      alert("Błąd: " + (error.message || error));
    }
  };
}

attachOrderInquiryGlobals();
