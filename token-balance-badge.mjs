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

function collectBuyerInput(modal) {
  const profile = tokenModalState.summaryData?.profile || {};
  if (profile.role === 'company') return {};
  return {
    name: modal.querySelector('#global-token-buyer-name')?.value?.trim() || '',
    email: modal.querySelector('#global-token-buyer-email')?.value?.trim() || '',
    addressFields: {
      street: modal.querySelector('#global-token-buyer-street')?.value?.trim() || '',
      buildingNumber: modal.querySelector('#global-token-buyer-building')?.value?.trim() || '',
      postalCode: modal.querySelector('#global-token-buyer-postal')?.value?.trim() || '',
      city: modal.querySelector('#global-token-buyer-city')?.value?.trim() || '',
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
      <div class="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-zinc-100">
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
    <div class="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-zinc-100">
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
    return `
      <button type="button" data-token-package="${escapeHtml(pkg.id)}" class="text-left rounded-[26px] border ${isSelected ? 'border-[#C19A6B] bg-[#C19A6B]/10' : 'border-zinc-700 bg-zinc-900/50'} p-5 hover:border-[#C19A6B] transition">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-2xl font-black text-white">${escapeHtml(pkg.tokens)} ${pluralizeŻetony(pkg.tokens)}</div>
            <div class="text-sm text-zinc-500 mt-2">${formatMoneyCents(pkg.pricePerTokenCents || Math.round(effectivePrice / Math.max(1, Number(pkg.tokens || 1))))} zł / żeton</div>
          </div>
          ${Number(pkg.discountPercent || 0) > 0 ? `<span class="px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">-${escapeHtml(pkg.discountPercent || 0)}%</span>` : ''}
        </div>
        <div class="mt-5">
          ${hasDiscount ? `<div class="text-xs text-zinc-500 line-through">${formatMoneyCents(basePrice)} zł</div>` : ''}
          <div class="text-3xl font-black text-[#C19A6B]">${formatMoneyCents(effectivePrice)} zł</div>
        </div>
      </button>
    `;
  }).join('');
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
}

function renderTokenModal() {
  const modal = ensureModal();
  const summary = tokenModalState.summaryData?.summary || {};
  const selected = getSelectedPackage();
  modal.innerHTML = `
    <div class="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[28px] border border-zinc-700 bg-[#0d0d0f] text-zinc-100 shadow-2xl" onclick="event.stopPropagation()">
      <div class="p-5 md:p-7 border-b border-zinc-800 bg-[radial-gradient(circle_at_top_right,rgba(193,154,107,0.18),transparent_28%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(10,10,10,0.96))]">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-xs uppercase tracking-[0.24em] text-zinc-500 mb-2">Żetony</div>
            <h3 class="text-3xl font-black text-white">Saldo i zakup żetonów</h3>
            <p class="text-sm text-zinc-400 mt-3">Klikasz przy avatarze i od razu zarządzasz żetonami bez przechodzenia do profilu.</p>
          </div>
          <button type="button" id="global-token-close" class="text-zinc-400 hover:text-white text-2xl"><i class="fa-solid fa-times"></i></button>
        </div>
      </div>
      <div class="p-5 md:p-7 space-y-5">
        <div class="rounded-3xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-5">
          <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Aktualne saldo</div>
          <div class="text-4xl font-black text-white">${escapeHtml(summary.balance || 0)}</div>
          <div class="text-sm text-zinc-400 mt-2">Dostępne do publikacji, odświeżeń, przypięć i wyróżnień.</div>
        </div>
        ${renderPromoBox()}
        <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5">
          <div class="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-4">
            <input id="global-token-code" type="text" class="w-full" maxlength="64" value="${escapeHtml(tokenModalState.code || '')}" placeholder="Wpisz kod na darmowe żetony">
            <button type="button" id="global-token-apply-code" class="px-4 py-3 rounded-2xl border border-[#C19A6B]/40 text-[#C19A6B] text-sm font-black uppercase tracking-[0.12em] hover:bg-[#C19A6B]/10 transition">Sprawdź</button>
          </div>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(360px,0.88fr)] gap-5 items-start">
          <section class="space-y-5">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${renderPackageCards()}</div>
            <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5 space-y-3">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500">Dowolna liczba żetonów</div>
              <div class="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-4 items-end">
                <label class="block">
                  <span class="block text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Ilość żetonów</span>
                  <input id="global-token-custom-quantity" type="number" min="1" max="${escapeHtml(getTokenPricingConfig().maxPurchaseQuantity || 10000)}" class="w-full" value="${escapeHtml(tokenModalState.customTokens || '')}" placeholder="np. 275">
                </label>
                <button type="button" id="global-token-clear-custom" class="px-4 py-3 rounded-2xl border border-zinc-700 text-zinc-300 text-sm font-black uppercase tracking-[0.12em] hover:border-[#C19A6B] hover:text-white transition">Wyczyść</button>
              </div>
              <div class="text-xs text-zinc-500">Progi rabatowe: 0-49 bez zniżki, 50-99: 2%, 100-999: 5%, 1000-9999: 10%, 10000: 15%.</div>
            </div>
          </section>
          <section class="space-y-5">
            ${renderBuyerFields()}
            <label class="flex items-start gap-3 rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5 cursor-pointer">
              <input id="global-token-truth-confirm" type="checkbox" class="mt-1 accent-[#C19A6B]">
              <span class="text-sm text-zinc-300">Potwierdzam, że dane do dokumentu sprzedaży są prawdziwe.</span>
            </label>
            <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Wybrany pakiet</div>
              <div class="text-lg font-bold text-white">${escapeHtml(selected?.tokens || 0)} ${pluralizeŻetony(selected?.tokens || 0)}</div>
              <div class="text-sm text-zinc-500 mt-1">${formatMoneyCents(selected?.pricePerTokenCents || 0)} zł / żeton</div>
              <div class="text-2xl font-black text-[#C19A6B] mt-3">${formatMoneyCents(selected?.effectivePriceCents || 0)} zł</div>
              <div class="text-xs text-zinc-500 mt-2">${Number(selected?.discountPercent || 0) > 0 ? `Rabat ilościowy: -${escapeHtml(selected?.discountPercent || 0)}%` : 'Bez rabatu ilościowego'}</div>
              <button type="button" id="global-token-checkout" class="mt-5 w-full bg-[#C19A6B] text-black px-5 py-3.5 rounded-2xl text-sm font-black uppercase tracking-[0.14em] hover:bg-white transition">Przejdź do płatności</button>
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
      buyerInput: collectBuyerInput(modal),
      promoCode: '',
    });
    if (data.url) window.location.href = data.url;
  } catch (error) {
    alert(error.message || 'Nie udało się rozpocząć zakupu.');
    button?.removeAttribute('disabled');
  }
}

function bindModalEvents(modal) {
  modal.querySelector('#global-token-close')?.addEventListener('click', closeTokenModal);
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
  modal.querySelector('#global-token-custom-quantity')?.addEventListener('input', (event) => {
    const maxQuantity = getTokenPricingConfig().maxPurchaseQuantity || 10000;
    const quantity = Math.max(0, parseInt(event.target?.value, 10) || 0);
    tokenModalState.customTokens = quantity > 0 ? String(Math.min(quantity, maxQuantity)) : '';
    tokenModalState.selectedPackageId = '';
    renderTokenModal();
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

function ensureTokenBadge() {
  let badge = document.getElementById('global-token-badge');
  if (badge) return badge;
  const avatarButton = document.getElementById('user-avatar-button');
  if (!avatarButton || !avatarButton.parentElement) return null;
  badge = document.createElement('button');
  badge.id = 'global-token-badge';
  badge.type = 'button';
  badge.className = 'absolute right-14 md:right-16 top-1/2 -translate-y-1/2 border border-[#C19A6B]/40 bg-black/80 text-[#C19A6B] h-10 min-w-[54px] px-3 rounded-xl text-sm font-black hidden items-center justify-center gap-2 hover:border-[#C19A6B] hover:bg-black transition';
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
