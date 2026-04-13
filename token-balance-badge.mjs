const API_BASE = 'https://strzelca.pl/api/bazar';

const tokenModalState = {
  summaryData: null,
  code: '',
  appliedCode: null,
  customTokens: '',
  selectedPackageId: '',
};

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

function pluralizeŻetony(count) {
  const value = Math.abs(Number(count) || 0);
  if (value === 1) return 'żeton';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'żetony';
  return 'żetonów';
}

async function getAuthHeaders(json = false) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser?.getIdToken) return headers;
  const token = await auth.currentUser.getIdToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiGet(path) {
  const headers = await getAuthHeaders(false);
  const res = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

async function apiJson(path, method, body) {
  const headers = await getAuthHeaders(true);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

function getTokenPricingConfig() {
  return tokenModalState.summaryData?.config?.tokenPricing || {
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

function computeCustomPackage(tokens) {
  const quantity = Math.max(1, parseInt(tokens, 10) || 1);
  const cfg = getTokenPricingConfig();
  const basePriceCents = quantity * Math.max(0, parseInt(cfg.tokenPriceCents, 10) || 0);
  const discountPercent = getQuantityDiscountPercent(quantity);
  const effectivePriceCents = Math.max(0, Math.round(basePriceCents * (100 - discountPercent) / 100));
  return {
    id: `custom_${quantity}`,
    label: `${quantity} ${pluralizeŻetony(quantity)}`,
    tokens: quantity,
    priceCents: basePriceCents,
    effectivePriceCents,
    pricePerTokenCents: Math.max(0, Math.round(effectivePriceCents / quantity)),
    discountPercent,
    isCustom: true,
  };
}

function getPackages() {
  const packages = Array.isArray(tokenModalState.summaryData?.config?.packages)
    ? tokenModalState.summaryData.config.packages
    : [];
  return packages.filter((pkg) => pkg.active !== false);
}

function getSelectedPackage() {
  if (Number(tokenModalState.customTokens || 0) > 0) {
    return computeCustomPackage(tokenModalState.customTokens);
  }
  const packages = getPackages();
  const selectedId = tokenModalState.selectedPackageId || packages[0]?.id || '';
  return packages.find((pkg) => pkg.id === selectedId) || packages[0] || null;
}

function collectBuyerInput() {
  const profile = tokenModalState.summaryData?.profile || {};
  if (profile.role === 'company') return {};
  const buyer = tokenModalState.summaryData?.buyerPrefill || {};
  const fields = buyer.addressFields || {};
  const root = document.getElementById('global-token-buyer-modal');
  const nameEl = root?.querySelector('#global-token-buyer-name');
  if (!nameEl) {
    return {
      name: String(buyer.name || '').trim(),
      email: String(buyer.email || '').trim(),
      addressFields: {
        street: String(fields.street || '').trim(),
        buildingNumber: String(fields.buildingNumber || '').trim(),
        postalCode: String(fields.postalCode || '').trim(),
        city: String(fields.city || '').trim(),
      },
    };
  }
  return {
    name: nameEl.value?.trim() || '',
    email: root.querySelector('#global-token-buyer-email')?.value?.trim() || '',
    addressFields: {
      street: root.querySelector('#global-token-buyer-street')?.value?.trim() || '',
      buildingNumber: root.querySelector('#global-token-buyer-building')?.value?.trim() || '',
      postalCode: root.querySelector('#global-token-buyer-postal')?.value?.trim() || '',
      city: root.querySelector('#global-token-buyer-city')?.value?.trim() || '',
    },
  };
}

function renderBuyerFields() {
  const profile = tokenModalState.summaryData?.profile || {};
  const buyer = tokenModalState.summaryData?.buyerPrefill || {};
  const fields = buyer.addressFields || {};
  if (profile.role === 'company') {
    return `
      <div class="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-5 text-sm text-zinc-100">
        Dane do dokumentu dla konta firmowego pobieramy z profilu firmy.
      </div>
    `;
  }
  return `
    <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5 space-y-4">
      <div class="text-sm font-semibold text-white">Dane do dokumentu sprzedaży</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Imię i nazwisko</span>
          <input id="global-token-buyer-name" type="text" class="w-full" maxlength="240" value="${escapeHtml(buyer.name || '')}" placeholder="Jan Kowalski">
        </label>
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">E-mail</span>
          <input id="global-token-buyer-email" type="email" class="w-full" maxlength="180" value="${escapeHtml(buyer.email || '')}" placeholder="mail@adres.pl">
        </label>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Ulica</span>
          <input id="global-token-buyer-street" type="text" class="w-full" maxlength="120" value="${escapeHtml(fields.street || '')}">
        </label>
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Numer budynku / lokalu</span>
          <input id="global-token-buyer-building" type="text" class="w-full" maxlength="60" value="${escapeHtml(fields.buildingNumber || '')}">
        </label>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod pocztowy</span>
          <input id="global-token-buyer-postal" type="text" class="w-full" maxlength="40" value="${escapeHtml(fields.postalCode || '')}">
        </label>
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Miejscowość</span>
          <input id="global-token-buyer-city" type="text" class="w-full" maxlength="120" value="${escapeHtml(fields.city || '')}">
        </label>
      </div>
    </div>
  `;
}

function renderPromoBox() {
  const applied = tokenModalState.appliedCode;
  if (!applied) return '';
  if (applied.kind === 'grant') {
    return `
      <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-100">
        <div class="font-semibold text-white">Kod gratisowy: ${escapeHtml(applied.code)}</div>
        <div class="mt-2">Ten kod dopisze do konta <strong>${escapeHtml(applied.grantTokens || 0)} ${pluralizeŻetony(applied.grantTokens || 0)}</strong>.</div>
        <div class="mt-4 flex gap-3">
          <button type="button" id="global-token-redeem" class="bg-emerald-500 text-black px-5 py-3 rounded-2xl text-sm font-black hover:bg-emerald-400 transition">Odbierz żetony</button>
          <button type="button" id="global-token-remove-code" class="px-4 py-3 rounded-2xl border border-zinc-600 text-zinc-200 hover:bg-zinc-800 transition">Usuń kod</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-zinc-100">
      <div class="font-semibold text-white">Kod rozpoznany: ${escapeHtml(applied.code)}</div>
      <div class="mt-2">Ten kod nie dodaje darmowych żetonów do konta. Możesz go usunąć i kontynuować zakup.</div>
      <div class="mt-4">
        <button type="button" id="global-token-remove-code" class="px-4 py-3 rounded-2xl border border-zinc-600 text-zinc-200 hover:bg-zinc-800 transition">Usuń kod</button>
      </div>
    </div>
  `;
}

function renderPackageCards() {
  return getPackages().map((pkg) => {
    const isSelected = !tokenModalState.customTokens && (tokenModalState.selectedPackageId || getPackages()[0]?.id) === pkg.id;
    const effectivePrice = Number(pkg.effectivePriceCents ?? pkg.priceCents ?? 0);
    const basePrice = Number(pkg.priceCents || 0);
    const hasDiscount = effectivePrice < basePrice;
    const tokensCount = Math.max(1, Number(pkg.tokens || 1));
    const pricePerAfterDiscount = Math.round(effectivePrice / tokensCount);
    return `
      <button type="button" data-token-package="${escapeHtml(pkg.id)}" class="global-token-package-card text-left rounded-2xl border ${isSelected ? 'global-token-package-card--selected border-[#C19A6B] bg-[#C19A6B]/10' : 'border-zinc-700 bg-zinc-900/50'} p-4 hover:border-[#C19A6B] transition">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xl font-black text-white">${escapeHtml(pkg.tokens)} ${pluralizeŻetony(pkg.tokens)}</div>
            <div class="text-sm text-zinc-500 mt-1.5">${formatMoneyCents(pricePerAfterDiscount)} zł / żeton</div>
          </div>
          ${Number(pkg.discountPercent || 0) > 0 ? `<span class="px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">-${escapeHtml(pkg.discountPercent || 0)}%</span>` : ''}
        </div>
        <div class="mt-3">
          ${hasDiscount ? `<div class="text-xs text-zinc-500 line-through">${formatMoneyCents(basePrice)} zł</div>` : ''}
          <div class="text-2xl font-black text-[#C19A6B]">${formatMoneyCents(effectivePrice)} zł</div>
        </div>
      </button>
    `;
  }).join('');
}

function getCustomTokenQuantityForUi() {
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const raw = Math.max(0, parseInt(tokenModalState.customTokens, 10) || 0);
  if (raw > 0) return Math.min(raw, maxQ);
  return 1;
}

function renderCustomTokensBlock() {
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const qty = getCustomTokenQuantityForUi();
  const sliderVal = tokenModalState.customTokens ? qty : Math.min(250, maxQ);
  return `
    <div id="global-token-custom-block" class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4 space-y-3">
      <div class="global-token-slider-wrap relative rounded-2xl border border-[#C19A6B]/35 bg-[linear-gradient(90deg,rgba(193,154,107,0.12),rgba(59,130,246,0.08),rgba(193,154,107,0.1))] p-3 shadow-[0_0_28px_rgba(193,154,107,0.12)]">
        <div class="flex items-center justify-between gap-3 mb-2">
          <span class="text-xs font-bold uppercase tracking-[0.2em] text-[#C19A6B]">Wybierz na suwaku</span>
          <span id="global-token-slider-bubble" class="tabular-nums text-lg font-black text-white">${escapeHtml(sliderVal)}</span>
        </div>
        <input id="global-token-custom-slider" type="range" min="1" max="${escapeHtml(maxQ)}" step="1" value="${escapeHtml(sliderVal)}" class="global-token-range w-full" aria-label="Liczba żetonów">
      </div>
      <div class="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-end">
        <label class="block">
          <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Albo wpisz ręcznie</span>
          <input id="global-token-custom-quantity" type="number" min="1" max="${escapeHtml(maxQ)}" class="w-full" value="${escapeHtml(tokenModalState.customTokens || '')}" placeholder="np. 275">
        </label>
        <button type="button" id="global-token-clear-custom" class="px-4 py-3 rounded-2xl border border-zinc-700 text-zinc-300 text-sm font-black uppercase tracking-[0.12em] hover:border-[#C19A6B] hover:text-white transition">Wyczyść</button>
      </div>
      <div class="text-xs text-zinc-500 leading-snug">Rabat zależy od ilości zakupionych żetonów.</div>
    </div>
  `;
}

function truthCheckboxMarkup() {
  return `
    <div class="flex items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4">
      <input id="global-token-truth-confirm" type="checkbox" class="mt-1 accent-[#C19A6B] shrink-0">
      <div class="text-sm text-zinc-300 leading-relaxed">
        <label for="global-token-truth-confirm" class="cursor-pointer">
          Potwierdzam, że dane kupującego, potrzebne do wystawienia dokumentu sprzedaży są prawdziwe. Dokument zostanie wystawiony jako
        </label>
        <button type="button" id="global-token-vat-link" class="text-[#C19A6B] font-semibold underline underline-offset-2 hover:text-white transition px-0 py-0 bg-transparent border-0 cursor-pointer text-sm leading-relaxed align-baseline">faktura zwolniona z VAT</button>
        <label for="global-token-truth-confirm" class="cursor-pointer">.</label>
      </div>
    </div>
  `;
}

function renderBuyerPanelCta() {
  const profile = tokenModalState.summaryData?.profile || {};
  if (profile.role === 'company') {
    return `
      <div class="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-zinc-200 leading-relaxed">
        Dane do dokumentu dla konta firmowego pobieramy z profilu firmy.
      </div>
    `;
  }
  return `
    <button type="button" id="global-token-open-buyer" class="w-full rounded-2xl border border-[#C19A6B]/45 bg-[#C19A6B]/10 px-5 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-[#C19A6B] hover:bg-[#C19A6B]/20 transition">
      Dane do dokumentu sprzedaży
    </button>
  `;
}

function buildVatExemptInfoPanelHtml() {
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

function ensureAuxiliaryModals() {
  injectTokenBadgeStyles();
  injectTokenModalUiStyles();
  if (!document.getElementById('global-token-buyer-modal')) {
    const buyer = document.createElement('div');
    buyer.id = 'global-token-buyer-modal';
    buyer.className = 'fixed inset-0 z-[10000] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-md';
    buyer.innerHTML = `
      <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[26px] border border-zinc-700 bg-[#0d0d0f] p-6 shadow-2xl text-zinc-100" role="dialog" aria-modal="true" aria-labelledby="global-token-buyer-title" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h4 id="global-token-buyer-title" class="text-lg font-bold text-white">Dane do dokumentu sprzedaży</h4>
          <button type="button" id="global-token-buyer-close" class="text-zinc-400 hover:text-white text-xl" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
        <div id="global-token-buyer-inner"></div>
      </div>
    `;
    buyer.addEventListener('click', () => closeGlobalTokenBuyerModal());
    document.body.appendChild(buyer);
    buyer.querySelector('#global-token-buyer-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGlobalTokenBuyerModal();
    });
  }
  if (!document.getElementById('global-token-vat-modal')) {
    const vat = document.createElement('div');
    vat.id = 'global-token-vat-modal';
    vat.className = 'fixed inset-0 z-[10001] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-md';
    vat.innerHTML = `
      <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[26px] border border-zinc-700 bg-[#0d0d0f] p-6 shadow-2xl text-zinc-100" role="dialog" aria-modal="true" aria-labelledby="global-token-vat-title" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h4 id="global-token-vat-title" class="text-lg font-bold text-white">Faktura zwolniona z VAT</h4>
          <button type="button" id="global-token-vat-close" class="text-zinc-400 hover:text-white text-xl" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
        <div id="global-token-vat-inner">${buildVatExemptInfoPanelHtml()}</div>
        <button type="button" id="global-token-vat-ok" class="mt-6 w-full rounded-2xl bg-[#C19A6B] px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-black hover:bg-white transition">Rozumiem</button>
      </div>
    `;
    vat.addEventListener('click', () => closeGlobalTokenVatModal());
    document.body.appendChild(vat);
    vat.querySelector('#global-token-vat-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGlobalTokenVatModal();
    });
    vat.querySelector('#global-token-vat-ok')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeGlobalTokenVatModal();
    });
  }
}

function openGlobalTokenBuyerModal() {
  ensureAuxiliaryModals();
  const inner = document.getElementById('global-token-buyer-inner');
  if (inner) inner.innerHTML = renderBuyerFields();
  const el = document.getElementById('global-token-buyer-modal');
  el?.classList.remove('hidden');
  el?.classList.add('flex');
}

function closeGlobalTokenBuyerModal() {
  const el = document.getElementById('global-token-buyer-modal');
  el?.classList.add('hidden');
  el?.classList.remove('flex');
}

function openGlobalTokenVatModal() {
  ensureAuxiliaryModals();
  const inner = document.getElementById('global-token-vat-inner');
  if (inner) inner.innerHTML = buildVatExemptInfoPanelHtml();
  const el = document.getElementById('global-token-vat-modal');
  el?.classList.remove('hidden');
  el?.classList.add('flex');
}

function closeGlobalTokenVatModal() {
  const el = document.getElementById('global-token-vat-modal');
  el?.classList.add('hidden');
  el?.classList.remove('flex');
}

function ensureModal() {
  let modal = document.getElementById('global-token-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'global-token-modal';
  modal.className = 'fixed inset-0 z-[9999] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-md';
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeTokenModal();
  });
  document.body.appendChild(modal);
  return modal;
}

function closeTokenModal() {
  const modal = document.getElementById('global-token-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.innerHTML = '';
  document.body.style.overflow = '';
  closeGlobalTokenBuyerModal();
  closeGlobalTokenVatModal();
}

function renderTokenModal() {
  ensureAuxiliaryModals();
  const modal = ensureModal();
  const summary = tokenModalState.summaryData?.summary || {};
  const selected = getSelectedPackage();
  const selTokens = Math.max(0, Number(selected?.tokens || 0));
  const selEff = Math.max(0, Number(selected?.effectivePriceCents || 0));
  const summaryLine = selTokens
    ? `${escapeHtml(selTokens)} ${pluralizeŻetony(selTokens)} — ${formatMoneyCents(selEff)} zł`
    : '—';
  modal.innerHTML = `
    <div class="w-full max-w-5xl max-h-[min(92dvh,880px)] flex flex-col overflow-hidden rounded-[24px] border border-zinc-700 bg-[#0d0d0f] text-zinc-100 shadow-2xl" onclick="event.stopPropagation()">
      <div class="shrink-0 border-b border-zinc-800 bg-[radial-gradient(circle_at_top_right,rgba(193,154,107,0.14),transparent_30%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(10,10,10,0.96))] px-4 py-3 md:px-5 md:py-3.5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 pr-2">
            <h3 class="text-lg md:text-xl font-black text-white leading-tight tracking-tight">Doładowanie żetonów</h3>
            <p class="text-xs md:text-sm text-zinc-400 mt-1.5 leading-snug max-w-2xl">Żetonami możesz opłacić produkt w sklepie, ogłoszenie w bazarze, a także rezerwacje strzelnicy.</p>
          </div>
          <button type="button" id="global-token-close" class="text-zinc-400 hover:text-white text-xl shrink-0 mt-0.5 leading-none" aria-label="Zamknij"><i class="fa-solid fa-times"></i></button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-5 space-y-4">
        <div class="rounded-2xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-1">Aktualne saldo</div>
          <div class="text-3xl font-black text-white tabular-nums">${escapeHtml(summary.balance || 0)}</div>
          <div class="text-xs text-zinc-400 mt-1 leading-snug">Wykorzystasz je m.in. w sklepie, Bazarze i przy rezerwacjach.</div>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(280px,0.88fr)] gap-4 items-start">
          <section class="space-y-4 min-w-0">
            <div class="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Pakiety</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${renderPackageCards()}</div>
            ${renderCustomTokensBlock()}
          </section>
          <section class="space-y-4 xl:sticky xl:top-0 min-w-0 self-start">
            ${renderBuyerPanelCta()}
            ${renderPromoBox()}
            <div class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4" id="global-token-code-row">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod promocyjny</div>
              <div class="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
                <input id="global-token-code" type="text" class="w-full min-w-0" maxlength="64" value="${escapeHtml(tokenModalState.code || '')}" placeholder="Wpisz kod promocyjny">
                <button type="button" id="global-token-apply-code" class="px-4 py-3 rounded-2xl border border-[#C19A6B]/40 text-[#C19A6B] text-sm font-black uppercase tracking-[0.12em] hover:bg-[#C19A6B]/10 transition shrink-0">Sprawdź</button>
              </div>
            </div>
            ${truthCheckboxMarkup()}
            <div class="rounded-2xl border border-zinc-700 bg-zinc-900/55 p-4 space-y-3">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500">Podsumowanie</div>
              <div id="global-token-summary-line" class="text-lg font-black text-white tabular-nums">${summaryLine}</div>
              <button type="button" id="global-token-checkout" class="global-token-checkout-btn relative isolate w-full overflow-hidden rounded-2xl px-5 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-black shadow-lg">
                <span class="relative z-[1]">DOŁADUJ ŻETONY</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  bindModalEvents(modal);
}

async function openTokenModal() {
  tokenModalState.summaryData = await apiGet('/token-summary');
  tokenModalState.selectedPackageId = tokenModalState.selectedPackageId || getPackages()[0]?.id || '';
  renderTokenModal();
}

async function applyCodeFromModal() {
  const selected = getSelectedPackage();
  const code = String(document.getElementById('global-token-code')?.value || '').trim();
  if (!code) {
    alert('Wpisz kod promocyjny.');
    return;
  }
  const data = await apiGet(`/promo-code-preview?code=${encodeURIComponent(code)}&packageId=${encodeURIComponent(selected?.id || '')}&tokens=${encodeURIComponent(selected?.tokens || 0)}`);
  tokenModalState.code = code;
  tokenModalState.appliedCode = data.promoCode || null;
  renderTokenModal();
}

async function redeemGrantCode() {
  if (!tokenModalState.appliedCode?.code) return;
  await apiJson('/promo-code-redeem', 'POST', { code: tokenModalState.appliedCode.code });
  tokenModalState.code = '';
  tokenModalState.appliedCode = null;
  await loadTokenBalanceBadge();
  await openTokenModal();
}

async function checkoutSelectedTokens(modal) {
  const selected = getSelectedPackage();
  if (!selected?.tokens) {
    alert('Wybierz liczbę żetonów.');
    return;
  }
  if (tokenModalState.appliedCode?.kind === 'grant') {
    alert('Kod gratisowy nie wymaga płatności. Kliknij „Odbierz żetony”.');
    return;
  }
  const truthConfirmed = modal.querySelector('#global-token-truth-confirm')?.checked === true;
  if (!truthConfirmed) {
    alert('Potwierdź prawdziwość danych przed zakupem.');
    return;
  }
  const button = modal.querySelector('#global-token-checkout');
  button?.setAttribute('disabled', 'disabled');
  try {
    const data = await apiJson('/tokens/checkout-session', 'POST', {
      packageId: selected.isCustom ? '' : selected.id,
      tokens: selected.tokens,
      truthConfirmed,
      buyerInput: collectBuyerInput(),
      promoCode: '',
    });
    if (data.url) window.location.href = data.url;
  } catch (error) {
    alert(error.message || 'Nie udało się rozpocząć zakupu.');
    button?.removeAttribute('disabled');
  }
}

function enterCustomTokenSelectionFromUi(modal) {
  tokenModalState.selectedPackageId = '';
  if (Number(tokenModalState.customTokens || 0) > 0) {
    syncTokenModalSelectionVisuals(modal);
    return;
  }
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const s = modal.querySelector('#global-token-custom-slider');
  const v = Math.max(1, Math.min(parseInt(s?.value, 10) || 1, maxQ));
  tokenModalState.customTokens = String(v);
  syncTokenModalSelectionVisuals(modal);
}

function syncTokenModalSelectionVisuals(modal) {
  if (!modal) return;
  const packages = getPackages();
  const selectedId = tokenModalState.selectedPackageId || packages[0]?.id || '';
  const customOn = Number(tokenModalState.customTokens || 0) > 0;
  modal.querySelectorAll('[data-token-package]').forEach((btn) => {
    const pid = btn.getAttribute('data-token-package');
    const isSelected = !customOn && selectedId === pid;
    btn.classList.toggle('global-token-package-card--selected', isSelected);
    btn.classList.toggle('border-[#C19A6B]', isSelected);
    btn.classList.toggle('bg-[#C19A6B]/10', isSelected);
    btn.classList.toggle('border-zinc-700', !isSelected);
    btn.classList.toggle('bg-zinc-900/50', !isSelected);
  });
  const selected = getSelectedPackage();
  const t = Math.max(0, Number(selected?.tokens || 0));
  const e = Math.max(0, Number(selected?.effectivePriceCents || 0));
  const line = modal.querySelector('#global-token-summary-line');
  if (line) line.textContent = t ? `${t} ${pluralizeŻetony(t)} — ${formatMoneyCents(e)} zł` : '—';
  const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
  const bubble = modal.querySelector('#global-token-slider-bubble');
  const slider = modal.querySelector('#global-token-custom-slider');
  const qtyInput = modal.querySelector('#global-token-custom-quantity');
  if (customOn) {
    const v = Math.min(Math.max(1, parseInt(tokenModalState.customTokens, 10) || 1), maxQ);
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

function bindModalEvents(modal) {
  modal.querySelector('#global-token-close')?.addEventListener('click', closeTokenModal);
  modal.querySelector('#global-token-open-buyer')?.addEventListener('click', (e) => {
    e.preventDefault();
    openGlobalTokenBuyerModal();
  });
  modal.querySelector('#global-token-vat-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openGlobalTokenVatModal();
  });
  modal.querySelector('#global-token-apply-code')?.addEventListener('click', async () => {
    try {
      await applyCodeFromModal();
    } catch (error) {
      alert(error.message || 'Nie udało się sprawdzić kodu.');
    }
  });
  modal.querySelector('#global-token-remove-code')?.addEventListener('click', () => {
    tokenModalState.code = '';
    tokenModalState.appliedCode = null;
    renderTokenModal();
  });
  modal.querySelector('#global-token-redeem')?.addEventListener('click', async () => {
    try {
      await redeemGrantCode();
    } catch (error) {
      alert(error.message || 'Nie udało się odebrać żetonów.');
    }
  });
  modal.querySelectorAll('[data-token-package]').forEach((button) => {
    button.addEventListener('click', () => {
      tokenModalState.selectedPackageId = button.getAttribute('data-token-package') || '';
      tokenModalState.customTokens = '';
      renderTokenModal();
    });
  });
  modal.querySelector('#global-token-custom-slider')?.addEventListener('pointerdown', () => {
    enterCustomTokenSelectionFromUi(modal);
  });
  modal.querySelector('#global-token-custom-block')?.addEventListener('focusin', (ev) => {
    if (ev.target?.closest?.('#global-token-clear-custom')) return;
    enterCustomTokenSelectionFromUi(modal);
  });
  modal.querySelector('#global-token-custom-slider')?.addEventListener('input', (event) => {
    const maxQ = getTokenPricingConfig().maxPurchaseQuantity || 10000;
    const v = Math.max(1, Math.min(parseInt(event.target?.value, 10) || 1, maxQ));
    tokenModalState.customTokens = String(v);
    tokenModalState.selectedPackageId = '';
    syncTokenModalSelectionVisuals(modal);
  });
  modal.querySelector('#global-token-custom-quantity')?.addEventListener('input', (event) => {
    const maxQuantity = getTokenPricingConfig().maxPurchaseQuantity || 10000;
    const quantity = Math.max(0, parseInt(event.target?.value, 10) || 0);
    tokenModalState.customTokens = quantity > 0 ? String(Math.min(quantity, maxQuantity)) : '';
    tokenModalState.selectedPackageId = '';
    if (tokenModalState.customTokens) {
      syncTokenModalSelectionVisuals(modal);
    } else {
      renderTokenModal();
    }
  });
  modal.querySelector('#global-token-clear-custom')?.addEventListener('click', () => {
    tokenModalState.customTokens = '';
    tokenModalState.selectedPackageId = getPackages()[0]?.id || '';
    renderTokenModal();
  });
  modal.querySelector('#global-token-checkout')?.addEventListener('click', async () => {
    await checkoutSelectedTokens(modal);
  });
}

function injectTokenModalUiStyles() {
  if (document.getElementById('global-token-modal-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'global-token-modal-ui-styles';
  style.textContent = `
.global-token-package-card--selected {
  box-shadow: 0 0 0 2px rgba(193, 154, 107, 0.5), 0 0 26px rgba(193, 154, 107, 0.22);
  animation: global-token-pkg-pulse 2.2s ease-in-out infinite;
}
@keyframes global-token-pkg-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(193, 154, 107, 0.45), 0 0 20px rgba(193, 154, 107, 0.16); }
  50% { box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.85), 0 0 38px rgba(193, 154, 107, 0.38); }
}
.global-token-range {
  -webkit-appearance: none;
  appearance: none;
  height: 16px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(193,154,107,0.2), rgba(96,165,250,0.22), rgba(193,154,107,0.28));
  outline: none;
}
.global-token-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #fffef5, #e8cfa3 40%, #c19a6b 72%, #4a3d2a);
  box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.55), 0 8px 22px rgba(0,0,0,0.5);
  cursor: grab;
}
.global-token-range:active::-webkit-slider-thumb { cursor: grabbing; }
.global-token-range::-moz-range-thumb {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: radial-gradient(circle at 32% 28%, #fffef5, #e8cfa3 40%, #c19a6b 72%, #4a3d2a);
  box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.55), 0 8px 22px rgba(0,0,0,0.5);
}
.global-token-checkout-btn {
  background: linear-gradient(118deg, #c19a6b, #f3e3c8, #c19a6b, #9d7a4f, #c19a6b);
  background-size: 320% 100%;
  animation: global-token-checkout-bg 3.4s ease-in-out infinite;
  box-shadow: 0 0 26px rgba(193, 154, 107, 0.42);
}
.global-token-checkout-btn:hover { filter: brightness(1.07); }
.global-token-checkout-btn:disabled {
  animation: none;
  opacity: 0.65;
  filter: grayscale(0.15);
}
@keyframes global-token-checkout-bg {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
.global-token-checkout-btn::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,0.45), transparent);
  background-size: 220% 100%;
  animation: global-token-checkout-shine 2.2s linear infinite;
  opacity: 0.5;
  z-index: 0;
  pointer-events: none;
}
@keyframes global-token-checkout-shine {
  0% { background-position: -80% 0; }
  100% { background-position: 180% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .global-token-package-card--selected { animation: none !important; }
  .global-token-checkout-btn,
  .global-token-checkout-btn::before { animation: none !important; }
}
`;
  document.head.appendChild(style);
}

function injectTokenBadgeStyles() {
  if (document.getElementById('global-token-badge-styles')) return;
  const style = document.createElement('style');
  style.id = 'global-token-badge-styles';
  style.textContent = `
#global-token-badge.global-token-badge {
  --token-accent-rgb: 193, 154, 107;
  top: 50%;
  transform: translateY(-50%) translateZ(0);
  border-radius: 12px;
  border: none;
  background: rgba(0, 0, 0, 0.82);
  box-shadow: 0 0 0 1px rgba(var(--token-accent-rgb), 0.38);
  transition: box-shadow 0.35s ease, transform 0.3s ease;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  overflow: hidden;
}
#global-token-badge.global-token-badge > * {
  position: relative;
  z-index: 1;
}
#global-token-badge.global-token-badge:hover,
#global-token-badge.global-token-badge:focus-visible {
  box-shadow:
    0 0 0 1px rgba(var(--token-accent-rgb), 0.98),
    0 0 16px rgba(var(--token-accent-rgb), 0.5),
    0 0 32px rgba(var(--token-accent-rgb), 0.22);
  transform: translateY(-50%) scale(1.045) translateZ(0);
}
#global-token-badge.global-token-badge::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(
    105deg,
    transparent 0%,
    transparent 40%,
    rgba(255, 248, 220, 0.28) 50%,
    transparent 60%,
    transparent 100%
  );
  background-size: 240% 100%;
  background-position: 100% 0;
  opacity: 0;
}
#global-token-badge.global-token-badge:hover::after,
#global-token-badge.global-token-badge:focus-visible::after {
  opacity: 1;
  animation: global-token-badge-shimmer 2.1s ease-in-out infinite;
}
#global-token-badge.global-token-badge:hover .fa-coins,
#global-token-badge.global-token-badge:focus-visible .fa-coins {
  animation: global-token-badge-coin 0.75s ease-in-out infinite;
}
@keyframes global-token-badge-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
@keyframes global-token-badge-coin {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  35% { transform: translateY(-2px) rotate(-7deg); }
  70% { transform: translateY(1px) rotate(6deg); }
}
@media (prefers-reduced-motion: reduce) {
  #global-token-badge.global-token-badge,
  #global-token-badge.global-token-badge::after,
  #global-token-badge.global-token-badge .fa-coins {
    animation: none !important;
  }
  #global-token-badge.global-token-badge::after {
    opacity: 0 !important;
  }
  #global-token-badge.global-token-badge:hover,
  #global-token-badge.global-token-badge:focus-visible {
    transform: translateY(-50%) translateZ(0);
    box-shadow:
      0 0 0 1px rgba(var(--token-accent-rgb), 0.85),
      0 0 12px rgba(var(--token-accent-rgb), 0.35);
  }
}
`;
  document.head.appendChild(style);
}

function ensureTokenBadge() {
  injectTokenBadgeStyles();
  let badge = document.getElementById('global-token-badge');
  if (badge) return badge;
  const avatarButton = document.getElementById('user-avatar-button');
  if (!avatarButton || !avatarButton.parentElement) return null;
  badge = document.createElement('button');
  badge.id = 'global-token-badge';
  badge.type = 'button';
  badge.className = 'global-token-badge absolute right-14 md:right-16 top-1/2 flex h-10 min-w-[54px] px-3 text-sm font-black text-[#C19A6B] hidden items-center justify-center gap-2';
  badge.innerHTML = '<i class="fa-solid fa-coins"></i><span>…</span>';
  badge.addEventListener('click', async () => {
    try {
      await openTokenModal();
    } catch (error) {
      alert(error.message || 'Nie udało się otworzyć panelu żetonów.');
    }
  });
  avatarButton.parentElement.appendChild(badge);
  return badge;
}

function ensureMenuShortcut() {
  const menu = document.getElementById('user-menu')?.querySelector('.space-y-2');
  if (!menu || document.getElementById('global-token-badge-link')) return;
  const btn = document.createElement('button');
  btn.id = 'global-token-badge-link';
  btn.type = 'button';
  btn.className = 'block w-full text-left text-zinc-300 hover:text-[#C19A6B] transition text-sm';
  btn.innerHTML = '<i class="fa-solid fa-coins mr-2"></i>Żetony';
  btn.addEventListener('click', async () => {
    try {
      document.getElementById('user-menu')?.classList.add('hidden');
      await openTokenModal();
    } catch (error) {
      alert(error.message || 'Nie udało się otworzyć panelu żetonów.');
    }
  });
  menu.insertBefore(btn, menu.firstChild);
}

async function loadTokenBalanceBadge() {
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser) return;
  try {
    tokenModalState.summaryData = await apiGet('/token-summary');
    const badge = ensureTokenBadge();
    if (badge) {
      badge.classList.remove('hidden');
      badge.classList.add('flex');
      badge.innerHTML = `<i class="fa-solid fa-coins"></i><span>${escapeHtml(tokenModalState.summaryData.summary?.balance || 0)}</span>`;
    }
    ensureMenuShortcut();
  } catch (error) {
    console.warn('token-balance-badge:', error);
  }
}

window.addEventListener('load', () => {
  const tryInit = () => {
    if (!window.strzelcaFirebaseAuth?.currentUser) return false;
    loadTokenBalanceBadge().catch(() => null);
    return true;
  };
  if (tryInit()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (tryInit() || attempts > 15) clearInterval(timer);
  }, 700);
});

window.openStrzelcaVatExemptInfoModal ??= () => {
  ensureAuxiliaryModals();
  openGlobalTokenVatModal();
};
