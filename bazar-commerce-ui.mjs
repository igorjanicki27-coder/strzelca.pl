const API_BASE = () => window.STRZELCA_BAZAR_API || 'https://strzelca.pl/api/bazar';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoneyCents(cents) {
  const value = Math.max(0, Number(cents || 0)) / 100;
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatTs(value) {
  if (!value) return '—';
  const sec = value?._seconds ?? value?.seconds;
  const date = sec != null ? new Date(sec * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('pl-PL');
}

function pluralizeŻetony(count) {
  const value = Math.abs(Number(count) || 0);
  if (value === 1) return 'Żeton';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'Żetony';
  return 'Żetonów';
}

function buildPackageDisplayLabel(pkg) {
  const tokens = Math.max(1, Number(pkg?.tokens || 0));
  return `${tokens} ${pluralizeŻetony(tokens)}`;
}

async function getAuthHeaders() {
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser?.getIdToken) return {};
  const token = await auth.currentUser.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE()}${path}`, { headers, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

async function apiJson(path, method = 'GET', body) {
  const headers = await getAuthHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE()}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

function getBuyerPrefill() {
  return window.__bazarBuyerPrefill || {};
}

function getBuyerProfile() {
  return window.__bazarBuyerProfile || {};
}

function getBuyerAddressFields() {
  const buyer = getBuyerPrefill();
  const fields = buyer.addressFields || {};
  return {
    street: String(fields.street || '').trim(),
    buildingNumber: String(fields.buildingNumber || '').trim(),
    postalCode: String(fields.postalCode || '').trim(),
    city: String(fields.city || '').trim(),
  };
}

function ensureJetonChip() {
  let chip = document.getElementById('bazar-token-chip');
  if (chip) return chip;
  const cluster = document.getElementById('bazar-nav-user-cluster');
  if (!cluster) return null;
  chip = document.createElement('button');
  chip.id = 'bazar-token-chip';
  chip.type = 'button';
  chip.className =
    'shrink-0 border border-[#C19A6B]/40 bg-black/70 text-[#C19A6B] h-10 min-w-[48px] px-2.5 rounded-xl text-sm font-black tracking-wide hidden items-center justify-center gap-1.5 hover:border-[#C19A6B] hover:bg-black/85 transition';
  chip.innerHTML = '<i class="fa-solid fa-coins"></i><span>…</span>';
  chip.addEventListener('click', () => openJetonPackagesModal(window.__bazarJetonPackages || []));
  cluster.insertBefore(chip, cluster.firstChild);
  return chip;
}

function renderJetonChip(summary) {
  const chip = ensureJetonChip();
  if (!chip) return;
  chip.classList.remove('hidden');
  chip.classList.add('flex');
  chip.innerHTML = `<i class="fa-solid fa-coins"></i><span>${escapeHtml(summary.balance || 0)}</span>`;
}

function closeJetonPackagesModal() {
  document.getElementById('bazar-jeton-modal')?.remove();
  document.body.style.overflow = '';
  closeBazarJetonBuyerModal();
  closeBazarJetonVatModal();
}

function collectBuyerInput() {
  const profile = getBuyerProfile();
  if (profile.role === 'company') return {};
  const root = document.getElementById('bazar-jeton-buyer-modal');
  const addressFields = {
    street: root?.querySelector('#bazar-buyer-street')?.value?.trim() || '',
    buildingNumber: root?.querySelector('#bazar-buyer-building-number')?.value?.trim() || '',
    postalCode: root?.querySelector('#bazar-buyer-postal-code')?.value?.trim() || '',
    city: root?.querySelector('#bazar-buyer-city')?.value?.trim() || '',
  };
  return {
    name: root?.querySelector('#bazar-buyer-name')?.value?.trim() || '',
    email: root?.querySelector('#bazar-buyer-email')?.value?.trim() || '',
    addressFields,
  };
}

function buildBuyerFieldsMarkup() {
  const buyer = getBuyerPrefill();
  const profile = getBuyerProfile();
  const addressFields = getBuyerAddressFields();
  if (profile.role === 'company') {
    return `
      <div class="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-5 text-sm text-zinc-100">
        Dane do dokumentu dla konta firmowego pobieramy z profilu i statusu weryfikacji firmy.
      </div>
    `;
  }
  return `
    <div class="rounded-3xl border border-zinc-700 bg-zinc-900/60 p-5 md:p-6 space-y-5">
      <div>
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div class="text-sm font-semibold text-white">Dane do dokumentu sprzedaży</div>
            <div class="text-xs text-zinc-500 mt-1">Możesz wpisać je jednorazowo tylko do tego zakupu.</div>
          </div>
          <div class="rounded-2xl border border-[#C19A6B]/20 bg-[#C19A6B]/8 px-3 py-2 text-[11px] leading-5 text-zinc-300">
            Pola są zgodne z profilem, więc system może je automatycznie uzupełnić.
          </div>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Imię i nazwisko</span>
          <input id="bazar-buyer-name" type="text" class="filter-input w-full" maxlength="240" value="${escapeHtml(buyer.name || '')}" placeholder="Jan Kowalski">
        </label>
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">E-mail do dokumentu</span>
          <input id="bazar-buyer-email" type="email" class="filter-input w-full" maxlength="180" value="${escapeHtml(buyer.email || '')}" placeholder="mail@adres.pl">
        </label>
      </div>
      <div class="rounded-2xl border border-white/5 bg-black/15 p-4 space-y-4">
        <div class="text-xs uppercase tracking-[0.18em] text-zinc-500">Adres do dokumentu</div>
        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr),minmax(180px,0.8fr)] gap-4">
          <label class="block">
            <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Ulica</span>
            <input id="bazar-buyer-street" type="text" class="filter-input w-full" maxlength="120" value="${escapeHtml(addressFields.street)}" placeholder="np. Nowowiejska">
          </label>
          <label class="block">
            <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Numer budynku / lokalu</span>
            <input id="bazar-buyer-building-number" type="text" class="filter-input w-full" maxlength="60" value="${escapeHtml(addressFields.buildingNumber)}" placeholder="np. 12/3">
          </label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="block">
            <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod pocztowy</span>
            <input id="bazar-buyer-postal-code" type="text" class="filter-input w-full" maxlength="40" value="${escapeHtml(addressFields.postalCode)}" placeholder="00-000">
          </label>
          <label class="block">
            <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Miejscowość</span>
            <input id="bazar-buyer-city" type="text" class="filter-input w-full" maxlength="120" value="${escapeHtml(addressFields.city)}" placeholder="Warszawa">
          </label>
        </div>
      </div>
    </div>
  `;
}

function buildJetonBuyerCtaMarkup() {
  const profile = getBuyerProfile();
  if (profile.role === 'company') {
    return `
      <div class="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-zinc-200 leading-relaxed">
        Dane do dokumentu dla konta firmowego pobieramy z profilu i statusu weryfikacji firmy.
      </div>
    `;
  }
  return `
    <button type="button" id="bazar-jeton-open-buyer" class="w-full rounded-2xl border border-[#C19A6B]/45 bg-[#C19A6B]/10 px-5 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-[#C19A6B] hover:bg-[#C19A6B]/20 transition">
      Dane do dokumentu sprzedaży
    </button>
  `;
}

function buildJetonVatInfoHtml() {
  return `
    <p class="text-sm text-zinc-300 leading-relaxed">
      <strong class="text-white">Faktura zwolniona z VAT</strong> to dokument sprzedaży wystawiany, gdy sprzedawca korzysta ze zwolnienia z podatku VAT
      (m.in. na podstawie art. 113 ustawy o VAT). Na takim dokumencie nie ma podziałki netto / VAT — płacisz wyłącznie kwotę brutto widoczną przy zakupie.
    </p>
    <p class="text-sm text-zinc-300 leading-relaxed mt-4">
      <strong class="text-white">Klient prywatny:</strong> nadal otrzymujesz normalny dowód zakupu do reklamacji i kontaktu z obsługą.
      Dla zakupów na własny użytek <strong class="text-white">nic „ekstra” z tego tytułu się nie zmienia</strong> — po prostu nie ma na dokumencie VAT do odliczenia.
    </p>
    <p class="text-sm text-zinc-300 leading-relaxed mt-4">
      <strong class="text-white">Firma:</strong> nie jest to faktura VAT z podatkiem do odliczenia w rozliczeniu firmy.
      Jeśli potrzebujecie pełnej faktury VAT od podatnika VAT, musicie ustalić to bezpośrednio ze sprzedawcą (inna ścieżka dokumentowa) — ta ścieżka zakupu żetonów jest na zwolnieniu.
    </p>
  `;
}

function injectBazarJetonModalStyles() {
  if (document.getElementById('bazar-jeton-modal-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'bazar-jeton-modal-ui-styles';
  style.textContent = `
.bazar-jeton-package-card--selected {
  box-shadow: 0 0 0 2px rgba(193, 154, 107, 0.5), 0 0 26px rgba(193, 154, 107, 0.22);
  animation: bazar-jeton-pkg-pulse 2.2s ease-in-out infinite;
}
@keyframes bazar-jeton-pkg-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(193, 154, 107, 0.45), 0 0 20px rgba(193, 154, 107, 0.16); }
  50% { box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.85), 0 0 38px rgba(193, 154, 107, 0.38); }
}
.bazar-jeton-range {
  -webkit-appearance: none;
  appearance: none;
  height: 16px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(193,154,107,0.2), rgba(96,165,250,0.22), rgba(193,154,107,0.28));
  outline: none;
}
.bazar-jeton-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #fffef5, #e8cfa3 40%, #c19a6b 72%, #4a3d2a);
  box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.55), 0 8px 22px rgba(0,0,0,0.5);
  cursor: grab;
}
.bazar-jeton-range:active::-webkit-slider-thumb { cursor: grabbing; }
.bazar-jeton-range::-moz-range-thumb {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: radial-gradient(circle at 32% 28%, #fffef5, #e8cfa3 40%, #c19a6b 72%, #4a3d2a);
  box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.55), 0 8px 22px rgba(0,0,0,0.5);
}
.bazar-jeton-checkout-btn {
  background: linear-gradient(118deg, #c19a6b, #f3e3c8, #c19a6b, #9d7a4f, #c19a6b);
  background-size: 320% 100%;
  animation: bazar-jeton-checkout-bg 3.4s ease-in-out infinite;
  box-shadow: 0 0 26px rgba(193, 154, 107, 0.42);
}
.bazar-jeton-checkout-btn:hover { filter: brightness(1.07); }
.bazar-jeton-checkout-btn:disabled { animation: none; opacity: 0.65; filter: grayscale(0.15); }
@keyframes bazar-jeton-checkout-bg {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.bazar-jeton-checkout-btn::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,0.45), transparent);
  background-size: 220% 100%;
  animation: bazar-jeton-checkout-shine 2.2s linear infinite;
  opacity: 0.5;
  z-index: 0;
  pointer-events: none;
}
@keyframes bazar-jeton-checkout-shine {
  0% { background-position: -80% 0; }
  100% { background-position: 180% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bazar-jeton-package-card--selected { animation: none !important; }
  .bazar-jeton-checkout-btn,
  .bazar-jeton-checkout-btn::before { animation: none !important; }
}
`;
  document.head.appendChild(style);
}

function ensureBazarJetonAuxiliaryModals() {
  injectBazarJetonModalStyles();
  if (!document.getElementById('bazar-jeton-buyer-modal')) {
    const buyer = document.createElement('div');
    buyer.id = 'bazar-jeton-buyer-modal';
    buyer.className = 'fixed inset-0 z-[12050] hidden items-center justify-center p-4 bg-black/85 backdrop-blur-md';
    buyer.innerHTML = `
      <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[26px] border border-zinc-700 bg-[#0d0d0f] p-6 shadow-2xl text-zinc-100" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h4 class="text-lg font-bold text-white">Dane do dokumentu sprzedaży</h4>
          <button type="button" id="bazar-jeton-buyer-close" class="text-zinc-400 hover:text-white text-xl" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
        <div id="bazar-jeton-buyer-inner"></div>
      </div>
    `;
    buyer.addEventListener('click', () => closeBazarJetonBuyerModal());
    document.body.appendChild(buyer);
    buyer.querySelector('#bazar-jeton-buyer-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBazarJetonBuyerModal();
    });
  }
  if (!document.getElementById('bazar-jeton-vat-modal')) {
    const vat = document.createElement('div');
    vat.id = 'bazar-jeton-vat-modal';
    vat.className = 'fixed inset-0 z-[12060] hidden items-center justify-center p-4 bg-black/85 backdrop-blur-md';
    vat.innerHTML = `
      <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[26px] border border-zinc-700 bg-[#0d0d0f] p-6 shadow-2xl text-zinc-100" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h4 class="text-lg font-bold text-white">Faktura zwolniona z VAT</h4>
          <button type="button" id="bazar-jeton-vat-close" class="text-zinc-400 hover:text-white text-xl" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
        <div id="bazar-jeton-vat-inner">${buildJetonVatInfoHtml()}</div>
        <button type="button" id="bazar-jeton-vat-ok" class="mt-6 w-full rounded-2xl bg-[#C19A6B] px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-black hover:bg-white transition">Rozumiem</button>
      </div>
    `;
    vat.addEventListener('click', () => closeBazarJetonVatModal());
    document.body.appendChild(vat);
    vat.querySelector('#bazar-jeton-vat-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBazarJetonVatModal();
    });
    vat.querySelector('#bazar-jeton-vat-ok')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBazarJetonVatModal();
    });
  }
}

function openBazarJetonBuyerModal() {
  ensureBazarJetonAuxiliaryModals();
  const inner = document.getElementById('bazar-jeton-buyer-inner');
  if (inner) inner.innerHTML = buildBuyerFieldsMarkup();
  const el = document.getElementById('bazar-jeton-buyer-modal');
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('flex');
  }
}

function closeBazarJetonBuyerModal() {
  const el = document.getElementById('bazar-jeton-buyer-modal');
  el?.classList.add('hidden');
  el?.classList.remove('flex');
}

function openBazarJetonVatModal() {
  ensureBazarJetonAuxiliaryModals();
  const inner = document.getElementById('bazar-jeton-vat-inner');
  if (inner) inner.innerHTML = buildJetonVatInfoHtml();
  const el = document.getElementById('bazar-jeton-vat-modal');
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('flex');
  }
}

function closeBazarJetonVatModal() {
  const el = document.getElementById('bazar-jeton-vat-modal');
  el?.classList.add('hidden');
  el?.classList.remove('flex');
}

function getPromoState() {
  return window.__bazarPromoState || {
    code: '',
    appliedCode: null,
    packagePreviews: null,
    selectedPackageId: null,
    customTokens: '',
  };
}

function setPromoState(nextState) {
  window.__bazarPromoState = {
    ...getPromoState(),
    ...(nextState || {}),
  };
}

function getTokenPricingConfig() {
  return window.__bazarTokenPricing || {
    tokenPriceCents: 0,
    presetQuantities: [10, 50, 100, 1000],
    maxPurchaseQuantity: 10000,
  };
}

function getQuantityDiscountPercent(tokens) {
  const quantity = Math.max(0, parseInt(tokens, 10) || 0);
  if (quantity >= 10000) return 15;
  if (quantity >= 1000) return 10;
  if (quantity >= 100) return 5;
  if (quantity >= 50) return 2;
  return 0;
}

function computeCustomTokenPricing(tokens) {
  const quantity = Math.max(1, parseInt(tokens, 10) || 1);
  const cfg = getTokenPricingConfig();
  const basePriceCents = quantity * Math.max(0, parseInt(cfg.tokenPriceCents, 10) || 0);
  const discountPercent = getQuantityDiscountPercent(quantity);
  const effectivePriceCents = Math.max(0, Math.round(basePriceCents * (100 - discountPercent) / 100));
  const pricePerTokenCents = Math.max(0, Math.round(effectivePriceCents / quantity));
  return {
    id: `custom_${quantity}`,
    label: `${quantity} ${pluralizeŻetony(quantity)}`,
    tokens: quantity,
    priceCents: basePriceCents,
    effectivePriceCents,
    pricePerTokenCents,
    discountPercent,
    isCustom: true,
  };
}

function resolveSelectedTokenPackage(packages, state = getPromoState()) {
  const customTokens = Math.max(0, parseInt(state.customTokens, 10) || 0);
  if (customTokens > 0) {
    return computeCustomTokenPricing(customTokens);
  }
  const selectedId = state.selectedPackageId || packages[0]?.id || '';
  return packages.find((pkg) => pkg.id === selectedId) || packages[0] || null;
}

function buildCustomQuantityMarkup(state = getPromoState()) {
  const cfg = getTokenPricingConfig();
  const customTokens = String(state.customTokens || '');
  const maxQ = cfg.maxPurchaseQuantity || 10000;
  const qtyRaw = Math.max(0, parseInt(customTokens, 10) || 0);
  const sliderVal = qtyRaw > 0 ? Math.min(qtyRaw, maxQ) : Math.min(250, maxQ);
  return `
    <div id="bazar-custom-token-block" class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4 space-y-3">
      <div class="relative rounded-2xl border border-[#C19A6B]/35 bg-[linear-gradient(90deg,rgba(193,154,107,0.12),rgba(59,130,246,0.08),rgba(193,154,107,0.1))] p-3 shadow-[0_0_28px_rgba(193,154,107,0.12)]">
        <div class="flex items-center justify-between gap-3 mb-2">
          <span class="text-xs font-bold uppercase tracking-[0.2em] text-[#C19A6B]">Wybierz na suwaku</span>
          <span id="bazar-custom-slider-bubble" class="tabular-nums text-lg font-black text-white">${escapeHtml(sliderVal)}</span>
        </div>
        <input id="bazar-custom-token-slider" type="range" min="1" max="${escapeHtml(maxQ)}" step="1" value="${escapeHtml(sliderVal)}" class="bazar-jeton-range w-full" aria-label="Liczba żetonów">
      </div>
      <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr),auto] gap-3 items-end">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Albo wpisz ręcznie</span>
          <input id="bazar-custom-token-quantity" type="number" min="1" max="${escapeHtml(maxQ)}" class="filter-input w-full" value="${escapeHtml(customTokens)}" placeholder="np. 275">
        </label>
        <button type="button" id="bazar-custom-token-clear" class="px-4 py-3 rounded-2xl border border-zinc-700 text-zinc-300 text-sm font-black uppercase tracking-[0.12em] hover:border-[#C19A6B] hover:text-white transition">
          Wyczyść
        </button>
      </div>
      <div class="text-xs text-zinc-500 leading-snug">Rabat zależy od ilości zakupionych żetonów.</div>
    </div>
  `;
}

function buildPackageCardsMarkup(packages, promoState) {
  const previews = Array.isArray(promoState.packagePreviews) && promoState.packagePreviews.length
    ? promoState.packagePreviews
    : packages.map((pkg) => ({
        ...pkg,
        effectivePriceCents: Number(pkg.priceCents || 0),
        pricePerTokenCents: Math.round(Number(pkg.priceCents || 0) / Math.max(1, Number(pkg.tokens || 1))),
      }));
  const defaultId = promoState.selectedPackageId || packages[0]?.id || '';
  return previews.map((pkg) => {
    const customOn = Math.max(0, parseInt(promoState.customTokens, 10) || 0) > 0;
    const isSelected = !customOn && defaultId === pkg.id;
    const basePrice = Number(pkg.priceCents || 0);
    const effectivePrice = Number(pkg.effectivePriceCents ?? basePrice);
    const tok = Math.max(1, Number(pkg.tokens || 1));
    const pricePerJeton = Math.round(effectivePrice / tok);
    const hasDiscount = effectivePrice < basePrice;
    return `
      <button
        type="button"
        class="bazar-jeton-package-card text-left rounded-2xl border ${isSelected ? 'bazar-jeton-package-card--selected border-[#C19A6B] bg-[#C19A6B]/10' : 'border-zinc-700 bg-zinc-900/50'} p-4 hover:border-[#C19A6B] transition"
        data-package-id="${escapeHtml(pkg.id)}"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-xl font-black text-white">${escapeHtml(buildPackageDisplayLabel(pkg))}</div>
            <div class="text-sm text-zinc-500 mt-1.5">${formatMoneyCents(pricePerJeton)} zł / żeton</div>
          </div>
          ${hasDiscount ? `<span class="px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">-${escapeHtml(pkg.discountPercent || 0)}%</span>` : ''}
        </div>
        <div class="mt-3">
          ${hasDiscount ? `<div class="text-xs text-zinc-500 line-through">${formatMoneyCents(basePrice)} zł</div>` : ''}
          <div class="text-2xl font-black text-[#C19A6B]">${formatMoneyCents(effectivePrice)} zł</div>
        </div>
      </button>
    `;
  }).join('');
}

function buildPromoResultMarkup(state) {
  const applied = state.appliedCode;
  if (!applied) return '';
  if (applied.kind === 'grant') {
    return `
      <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-100">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div class="text-xs uppercase tracking-[0.18em] text-emerald-300 mb-2">Kod gratisowy</div>
            <div class="text-lg font-bold text-white">${escapeHtml(applied.code)}</div>
            <div class="text-zinc-200 mt-2">Ten kod dopisze do konta <strong>${escapeHtml(applied.grantTokens || 0)} ${pluralizeŻetony(applied.grantTokens || 0).toLowerCase()}</strong>.</div>
          </div>
          <button type="button" id="bazar-promo-grant-redeem" class="bg-emerald-500 text-black px-5 py-3 rounded-2xl text-sm font-black uppercase tracking-[0.12em] hover:bg-emerald-400 transition">
            Odbierz żetony
          </button>
        </div>
      </div>
    `;
  }
  return `
    <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-100">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div class="text-xs uppercase tracking-[0.18em] text-emerald-300 mb-2">Kod rabatowy aktywny</div>
          <div class="text-lg font-bold text-white">${escapeHtml(applied.code)}</div>
          <div class="text-zinc-200 mt-2">Rabat <strong>${escapeHtml(applied.discountPercent || 0)}%</strong> został doliczony do pakietów żetonów.</div>
        </div>
        <button type="button" id="bazar-promo-remove" class="px-4 py-2 rounded-2xl border border-zinc-200/20 text-sm font-bold text-white hover:bg-white/5 transition">
          Usuń kod
        </button>
      </div>
    </div>
  `;
}

function enterBazarJetonCustomFromUi(modal, packages) {
  const st = getPromoState();
  if (Math.max(0, parseInt(st.customTokens, 10) || 0) > 0) {
    setPromoState({ selectedPackageId: '' });
    syncBazarJetonSelectionVisuals(modal, packages);
    return;
  }
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const s = modal.querySelector('#bazar-custom-token-slider');
  const v = Math.max(1, Math.min(parseInt(s?.value, 10) || 1, maxQ));
  setPromoState({ customTokens: String(v), selectedPackageId: '' });
  syncBazarJetonSelectionVisuals(modal, packages);
}

function syncBazarJetonSelectionVisuals(modal, packages) {
  if (!modal) return;
  const st = getPromoState();
  const defaultId = st.selectedPackageId || packages[0]?.id || '';
  const customOn = Math.max(0, parseInt(st.customTokens, 10) || 0) > 0;
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    const pid = btn.getAttribute('data-package-id');
    const isSelected = !customOn && defaultId === pid;
    btn.classList.toggle('bazar-jeton-package-card--selected', isSelected);
    btn.classList.toggle('border-[#C19A6B]', isSelected);
    btn.classList.toggle('bg-[#C19A6B]/10', isSelected);
    btn.classList.toggle('border-zinc-700', !isSelected);
    btn.classList.toggle('bg-zinc-900/50', !isSelected);
  });
  const selectedPkg = resolveSelectedTokenPackage(packages, st);
  const t = Math.max(0, Number(selectedPkg?.tokens || 0));
  const e = Math.max(0, Number(selectedPkg?.effectivePriceCents || 0));
  const line = modal.querySelector('#bazar-selected-package');
  if (line) line.textContent = t ? `${t} ${pluralizeŻetony(t)} — ${formatMoneyCents(e)} zł` : '—';
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const bubble = modal.querySelector('#bazar-custom-slider-bubble');
  const slider = modal.querySelector('#bazar-custom-token-slider');
  const qtyInput = modal.querySelector('#bazar-custom-token-quantity');
  if (customOn) {
    const v = Math.min(Math.max(1, parseInt(st.customTokens, 10) || 1), maxQ);
    if (bubble) bubble.textContent = String(v);
    if (slider) slider.value = String(v);
    if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = String(v);
  } else {
    const hint = Math.min(250, maxQ);
    if (bubble) bubble.textContent = String(hint);
    if (slider) slider.value = String(hint);
    if (qtyInput && !qtyInput.value) qtyInput.value = '';
  }
}

function renderJetonModal(modal, packages) {
  const state = getPromoState();
  const selectedPackageId = state.selectedPackageId || packages[0]?.id || '';
  setPromoState({ selectedPackageId });
  modal.innerHTML = `
    <div class="modal-panel max-w-5xl w-full max-h-[min(92dvh,880px)] flex flex-col overflow-hidden shadow-2xl" onclick="event.stopPropagation()">
      <div class="relative shrink-0 overflow-hidden border-b border-zinc-800">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(193,154,107,0.14),transparent_30%),radial-gradient(circle_at_left_center,rgba(59,130,246,0.1),transparent_34%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(10,10,10,0.96))]"></div>
        <div class="relative flex items-start justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5">
          <div class="min-w-0 pr-2">
            <h3 class="text-lg md:text-xl font-black text-white leading-tight tracking-tight">Doładowanie żetonów</h3>
            <p class="text-xs md:text-sm text-zinc-400 mt-1.5 leading-snug max-w-2xl">Żetonami możesz opłacić produkt w sklepie, ogłoszenie w bazarze, a także rezerwacje strzelnicy.</p>
          </div>
          <button type="button" class="text-zinc-400 hover:text-white text-xl shrink-0 mt-0.5 leading-none" id="bazar-jeton-close" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#0d0d0f] p-4 md:p-5 space-y-4">
        ${buildPromoResultMarkup(state)}
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(280px,0.88fr)] gap-4 items-start">
          <section class="space-y-4 min-w-0">
            <div class="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Pakiety</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${buildPackageCardsMarkup(packages, getPromoState())}
            </div>
            ${buildCustomQuantityMarkup(getPromoState())}
          </section>
          <section class="space-y-4 xl:sticky xl:top-0 min-w-0 self-start">
            ${buildJetonBuyerCtaMarkup()}
            <div class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod promocyjny</div>
              <div class="flex flex-col sm:flex-row sm:items-end gap-3">
                <input id="bazar-promo-code-input" type="text" class="filter-input w-full flex-1 min-w-0" maxlength="64" value="${escapeHtml(state.code || '')}" placeholder="Wpisz kod promocyjny">
                <button type="button" id="bazar-promo-apply" class="px-4 py-3 rounded-2xl border border-[#C19A6B]/40 text-[#C19A6B] text-sm font-black uppercase tracking-[0.12em] hover:bg-[#C19A6B]/10 transition shrink-0">
                  Sprawdź
                </button>
              </div>
            </div>
            <div class="flex items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/55 p-3.5 md:p-4">
              <input id="bazar-jeton-truth-confirm" type="checkbox" class="mt-0.5 accent-[#C19A6B] shrink-0" />
              <div class="text-sm text-zinc-300 leading-relaxed">
                <label for="bazar-jeton-truth-confirm" class="cursor-pointer">
                  Potwierdzam, że dane kupującego, potrzebne do wystawienia dokumentu sprzedaży są prawdziwe. Dokument zostanie wystawiony jako
                </label>
                <button type="button" id="bazar-jeton-vat-link" class="text-[#C19A6B] font-semibold underline underline-offset-2 hover:text-white transition px-0 py-0 bg-transparent border-0 cursor-pointer text-sm leading-relaxed align-baseline">faktura zwolniona z VAT</button>
                <label for="bazar-jeton-truth-confirm" class="cursor-pointer">.</label>
              </div>
            </div>
            <div class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4 space-y-3">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500">Podsumowanie</div>
              <div id="bazar-selected-package" class="text-lg font-black text-white tabular-nums"></div>
              <button type="button" id="bazar-jeton-checkout" class="bazar-jeton-checkout-btn relative isolate w-full overflow-hidden rounded-2xl px-5 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-black shadow-lg">
                <span class="relative z-[1]">DOŁADUJ ŻETONY</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('#bazar-jeton-close')?.addEventListener('click', closeJetonPackagesModal);
  modal.querySelector('#bazar-jeton-open-buyer')?.addEventListener('click', (e) => {
    e.preventDefault();
    openBazarJetonBuyerModal();
  });
  modal.querySelector('#bazar-jeton-vat-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openBazarJetonVatModal();
  });
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPromoState({ selectedPackageId: btn.getAttribute('data-package-id') || '', customTokens: '' });
      renderJetonModal(modal, packages);
    });
  });
  modal.querySelector('#bazar-custom-token-slider')?.addEventListener('pointerdown', () => {
    enterBazarJetonCustomFromUi(modal, packages);
  });
  modal.querySelector('#bazar-custom-token-block')?.addEventListener('focusin', (ev) => {
    if (ev.target?.closest?.('#bazar-custom-token-clear')) return;
    enterBazarJetonCustomFromUi(modal, packages);
  });
  modal.querySelector('#bazar-custom-token-slider')?.addEventListener('input', (event) => {
    const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
    const v = Math.max(1, Math.min(parseInt(event.target?.value, 10) || 1, maxQ));
    setPromoState({ customTokens: String(v), selectedPackageId: '' });
    syncBazarJetonSelectionVisuals(modal, packages);
  });
  modal.querySelector('#bazar-custom-token-quantity')?.addEventListener('input', (event) => {
    const maxQuantity = getTokenPricingConfig().maxPurchaseQuantity || 10000;
    const raw = Math.max(0, parseInt(event.target?.value, 10) || 0);
    const nextValue = raw > 0 ? String(Math.min(raw, maxQuantity)) : '';
    setPromoState({ customTokens: nextValue, selectedPackageId: '' });
    if (nextValue) {
      syncBazarJetonSelectionVisuals(modal, packages);
    } else {
      renderJetonModal(modal, packages);
    }
  });
  modal.querySelector('#bazar-custom-token-clear')?.addEventListener('click', () => {
    setPromoState({ customTokens: '', selectedPackageId: packages[0]?.id || '' });
    renderJetonModal(modal, packages);
  });
  modal.querySelector('#bazar-promo-apply')?.addEventListener('click', async () => {
    const code = modal.querySelector('#bazar-promo-code-input')?.value?.trim() || '';
    if (!code) {
      alert('Wpisz kod promocyjny.');
      return;
    }
    try {
      const selected = resolveSelectedTokenPackage(packages, getPromoState());
      const data = await apiGet(`/promo-code-preview?code=${encodeURIComponent(code)}&packageId=${encodeURIComponent(selected?.id || '')}&tokens=${encodeURIComponent(selected?.tokens || 0)}`);
      setPromoState({
        code,
        appliedCode: data.promoCode || null,
        packagePreviews: data.packages || null,
      });
      renderJetonModal(modal, packages);
    } catch (error) {
      alert(error.message || 'Nie udało się zastosować kodu promocyjnego.');
    }
  });
  modal.querySelector('#bazar-promo-remove')?.addEventListener('click', () => {
    setPromoState({ code: '', appliedCode: null, packagePreviews: null });
    renderJetonModal(modal, packages);
  });
  modal.querySelector('#bazar-promo-grant-redeem')?.addEventListener('click', async () => {
    const applied = getPromoState().appliedCode;
    if (!applied?.code) return;
    try {
      await apiJson('/promo-code-redeem', 'POST', { code: applied.code });
      alert(`Kod został zrealizowany. ${applied.grantTokens || 0} ${pluralizeŻetony(applied.grantTokens || 0).toLowerCase()} dodano do konta.`);
      setPromoState({ code: '', appliedCode: null, packagePreviews: null });
      await loadJetonSummary();
      closeJetonPackagesModal();
    } catch (error) {
      alert(error.message || 'Nie udało się zrealizować kodu.');
    }
  });
  modal.querySelector('#bazar-jeton-checkout')?.addEventListener('click', async () => {
    const selectedPackage = resolveSelectedTokenPackage(packages, getPromoState());
    if (!selectedPackage?.tokens) {
      alert('Wybierz liczbę żetonów.');
      return;
    }
    const truthConfirmed = modal.querySelector('#bazar-jeton-truth-confirm')?.checked === true;
    if (!truthConfirmed) {
      alert('Potwierdź prawdziwość danych przed zakupem żetonów.');
      return;
    }
    const applied = getPromoState().appliedCode;
    if (applied?.kind === 'grant') {
      alert('Kod gratisowy nie wymaga płatności. Kliknij „Odbierz żetony”.');
      return;
    }
    const button = modal.querySelector('#bazar-jeton-checkout');
    button?.setAttribute('disabled', 'disabled');
    try {
      const data = await apiJson('/tokens/checkout-session', 'POST', {
        packageId: selectedPackage.isCustom ? '' : selectedPackage.id,
        tokens: selectedPackage.tokens,
        truthConfirmed,
        buyerInput: collectBuyerInput(),
        promoCode: applied?.code || '',
      });
      if (data.url) window.location.href = data.url;
    } catch (error) {
      alert(error.message || 'Nie udało się rozpocząć zakupu.');
      button?.removeAttribute('disabled');
    }
  });

  syncBazarJetonSelectionVisuals(modal, packages);
}

function openJetonPackagesModal(packages) {
  ensureBazarJetonAuxiliaryModals();
  closeJetonPackagesModal();
  const modal = document.createElement('div');
  modal.id = 'bazar-jeton-modal';
  modal.className = 'modal-overlay py-4 md:py-6';
  modal.style.alignItems = 'center';
  modal.onclick = (event) => {
    if (event.target === modal) closeJetonPackagesModal();
  };
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  renderJetonModal(modal, packages);
}

async function openPremiumAction(offerId, action, question) {
  if (!confirm(question)) return;
  try {
    await apiJson(`/promote/${encodeURIComponent(offerId)}`, 'POST', { action });
    alert('Akcja wykonana pomyślnie.');
    await loadJetonSummary();
    await window.showMyOffers();
    if (typeof window.loadAllOffers === 'function' && typeof window.renderCarousels === 'function') {
      window.loadAllOffers().then(() => window.renderCarousels()).catch(() => null);
    }
  } catch (error) {
    alert(error.message || 'Nie udało się wykonać akcji premium.');
  }
}

async function showMyOffersEnhanced() {
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser) return;
  const modal = document.getElementById('my-offers-modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)window.closeMyOffers()">
    <div class="modal-panel">
      <div class="flex items-center justify-between p-4 border-b border-zinc-800">
        <span class="text-sm font-bold text-[#C19A6B] uppercase tracking-widest">Moje ogłoszenia i żetony</span>
        <button onclick="window.closeMyOffers()" class="text-zinc-400 hover:text-white text-xl"><i class="fa-solid fa-times"></i></button>
      </div>
      <div class="p-4" id="my-offers-content"><div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-2xl text-zinc-400"></i></div></div>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const [offersData, jetonSummary] = await Promise.all([apiGet('/my'), apiGet('/token-summary')]);
    const container = document.getElementById('my-offers-content');
    const offers = Array.isArray(offersData.offers) ? offersData.offers : [];
    const summary = jetonSummary.summary || {};
    if (!offers.length) {
      container.innerHTML = `
        <div class="rounded-2xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-4 mb-4">
          <div class="text-sm text-zinc-300">Saldo żetonów: <strong class="text-white">${summary.balance || 0}</strong></div>
        </div>
        <div class="text-center py-8 text-zinc-500"><i class="fa-solid fa-box-open text-3xl mb-3"></i><p>Nie masz jeszcze żadnych ogłoszeń.</p></div>
      `;
      return;
    }
    const statusLabels = { PENDING: 'Oczekująca', ACTIVE: 'Aktywna', REJECTED: 'Odrzucona', EXPIRED: 'Wygasła', SOLD: 'Sprzedana' };
    const statusColors = { PENDING: 'text-yellow-400', ACTIVE: 'text-green-400', REJECTED: 'text-red-400', EXPIRED: 'text-zinc-500', SOLD: 'text-blue-400' };
    container.innerHTML = `
      <div class="rounded-2xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Saldo żetonów</div>
          <div class="text-2xl font-black text-white">${summary.balance || 0}</div>
        </div>
        <button type="button" id="my-offers-buy-jetons" class="bg-[#C19A6B] text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-white transition">
          <i class="fa-solid fa-coins mr-1"></i>Dokup żetony
        </button>
      </div>
      <div class="space-y-3">
        ${offers.map((o) => `
          <article class="flex flex-col gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                ${o.mainImage ? `<img src="${o.mainImage}" class="w-full h-full object-cover" alt="">` : '<div class="w-full h-full flex items-center justify-center text-zinc-600"><i class="fa-solid fa-image"></i></div>'}
              </div>
              <div class="flex-1 min-w-0">
                <h4 class="text-sm font-bold text-white truncate">${escapeHtml(o.title || '')}</h4>
                <p class="text-[#C19A6B] font-bold">${o.price ? Number(o.price).toLocaleString('pl-PL') + ' PLN' : ''}</p>
                <div class="flex flex-wrap items-center gap-2 mt-1">
                  <span class="text-xs ${statusColors[o.status] || 'text-zinc-400'}">${statusLabels[o.status] || o.status}</span>
                  ${o.is_pinned ? '<span class="text-[10px] px-2 py-0.5 rounded bg-[#C19A6B] text-black font-bold">Przypięta</span>' : ''}
                  ${o.is_highlighted ? '<span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">Wyróżniona</span>' : ''}
                </div>
                ${o.rejection_reason ? `<p class="text-xs text-red-400 mt-1">Powód: ${escapeHtml(o.rejection_reason)}</p>` : ''}
                <p class="text-xs text-zinc-500 mt-1">Ostatnie odświeżenie: ${escapeHtml(formatTs(o.last_refreshed_at))}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              ${(o.status === 'ACTIVE' || o.status === 'EXPIRED') ? `<button type="button" class="text-xs bg-green-700 text-white px-3 py-1 rounded hover:bg-green-600 transition" data-action="refresh" data-id="${escapeHtml(o.id)}">${o.status === 'EXPIRED' ? 'Aktywuj ponownie' : 'Odśwież'}</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button type="button" class="text-xs border border-[#C19A6B]/40 text-[#C19A6B] px-3 py-1 rounded hover:bg-[#C19A6B]/10 transition" data-action="highlight" data-id="${escapeHtml(o.id)}">Wyróżnij</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button type="button" class="text-xs border border-sky-500/40 text-sky-300 px-3 py-1 rounded hover:bg-sky-500/10 transition" data-action="pin" data-id="${escapeHtml(o.id)}">Przypnij</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button onclick="window.markSold('${escapeHtml(o.id)}')" class="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-500 transition">Sprzedane</button>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    `;
    container.querySelector('#my-offers-buy-jetons')?.addEventListener('click', () => openJetonPackagesModal(window.__bazarJetonPackages || []));
    container.querySelectorAll('[data-action]').forEach((btn) => {
      const offerId = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const label =
        action === 'refresh'
          ? 'Zużyć 1 żeton na natychmiastowe odświeżenie oferty i podbicie jej na górę listy?'
          : action === 'highlight'
            ? 'Zużyć 1 żeton na wyróżnienie oferty na 30 dni i pokazanie jej w karuzeli strony głównej przez 7 dni?'
            : 'Zużyć 1 żeton na przypięcie oferty na górze listy przez 7 dni?';
      btn.addEventListener('click', () => openPremiumAction(offerId, action, label));
    });
  } catch (error) {
    document.getElementById('my-offers-content').innerHTML = `<p class="text-red-400 text-center py-4">${escapeHtml(error.message || 'Błąd ładowania ofert')}</p>`;
  }
}

async function loadJetonSummary() {
  try {
    const data = await apiGet('/token-summary');
    window.__bazarJetonPackages = data.config?.packages || [];
    window.__bazarTokenPricing = data.config?.tokenPricing || null;
    window.__bazarBuyerPrefill = data.buyerPrefill || {};
    window.__bazarBuyerProfile = data.profile || {};
    renderJetonChip(data.summary || {});
    return data;
  } catch (error) {
    console.warn('Bazar żetony load failed:', error);
    return null;
  }
}

function installUserMenuShortcut() {
  const menu = document.getElementById('user-menu')?.querySelector('.space-y-2');
  if (!menu || document.getElementById('bazar-user-menu-jetons')) return;
  const btn = document.createElement('button');
  btn.id = 'bazar-user-menu-jetons';
  btn.type = 'button';
  btn.className = 'block w-full text-left text-zinc-300 hover:text-[#C19A6B] transition text-sm';
  btn.innerHTML = '<i class="fa-solid fa-coins mr-2"></i>Żetony Bazaru';
  btn.addEventListener('click', () => openJetonPackagesModal(window.__bazarJetonPackages || []));
  menu.insertBefore(btn, menu.firstChild);
}

async function openBazarRulesModal() {
  const txtUrl = 'https://dokumenty.strzelca.pl/regulamin-bazaru.txt';
  try {
    const res = await fetch(txtUrl, { credentials: 'omit', cache: 'force-cache' });
    const raw = res.ok ? await res.text() : '';
    let html = '';
    if (raw) {
      try {
        const mod = await import('https://strzelca.pl/regulamin-txt-render.mjs?v=2026-04-12-1');
        html = mod.renderRegulaminTxtToHtml(raw, { includeFooter: true });
      } catch (_) {
        html = `<pre class="whitespace-pre-wrap text-sm text-zinc-300">${escapeHtml(raw)}</pre>`;
      }
    } else {
      html = `<p class="text-zinc-400">Nie udało się załadować Regulaminu Bazaru.</p>`;
    }
    const modal = document.createElement('div');
    modal.id = 'bazar-rules-modal';
    modal.className = 'modal-overlay';
    modal.onclick = (event) => {
      if (event.target === modal) {
        modal.remove();
        document.body.style.overflow = '';
      }
    };
    modal.innerHTML = `
      <div class="modal-panel max-w-4xl" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between p-4 border-b border-zinc-800">
          <span class="text-sm font-bold text-[#C19A6B] uppercase tracking-widest">Centrum zasad Bazaru</span>
          <button type="button" class="text-zinc-400 hover:text-white text-xl" id="bazar-rules-close"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="p-4 md:p-6 max-h-[75vh] overflow-y-auto">
          <div class="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4 mb-4 text-sm text-zinc-300">
            <strong class="text-zinc-100">Najważniejsze zasady:</strong><br>
            Bazar jest platformą ogłoszeniową i nie pośredniczy w płatnościach za broń oraz amunicję. Kupujesz wyłącznie żetony do usług premium operatora. Operator może moderować, ukrywać i usuwać ogłoszenia naruszające regulamin lub prawo.
          </div>
          ${html}
          <div class="mt-6">
            <a href="${txtUrl}" target="_blank" rel="noopener noreferrer" class="text-[#C19A6B] hover:underline text-sm">Otwórz pełny Regulamin Bazaru w osobnej karcie</a>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    modal.querySelector('#bazar-rules-close')?.addEventListener('click', () => {
      modal.remove();
      document.body.style.overflow = '';
    });
  } catch (error) {
    alert(error.message || 'Nie udało się otworzyć zasad Bazaru.');
  }
}

function installRulesShortcut() {
  const existingBtn = document.getElementById('bazar-rules-shortcut');
  if (existingBtn) {
    if (existingBtn.dataset.ready === '1') return;
    existingBtn.dataset.ready = '1';
    existingBtn.addEventListener('click', openBazarRulesModal);
    window.openRegulationModal = openBazarRulesModal;
    return;
  }
  window.openRegulationModal = openBazarRulesModal;
}

function installHookOverrides() {
  window.showMyOffers = showMyOffersEnhanced;
}

window.addEventListener('load', () => {
  installHookOverrides();
  const tryInit = async () => {
    if (!window.strzelcaFirebaseAuth?.currentUser) return false;
    await loadJetonSummary();
    installUserMenuShortcut();
    return true;
  };
  tryInit().catch(() => null);
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (window.strzelcaFirebaseAuth?.currentUser) {
      clearInterval(timer);
      loadJetonSummary().then(installUserMenuShortcut).catch(() => null);
      installRulesShortcut();
    } else if (attempts > 15) {
      clearInterval(timer);
    }
  }, 700);
  installRulesShortcut();
});
