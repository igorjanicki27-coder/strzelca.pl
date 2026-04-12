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
  const nav = document.querySelector('nav');
  if (!nav) return null;
  chip = document.createElement('button');
  chip.id = 'bazar-token-chip';
  chip.type = 'button';
  chip.className =
    'absolute right-[4.75rem] md:right-[5.5rem] top-1/2 -translate-y-1/2 border border-[#C19A6B]/40 bg-black/70 text-[#C19A6B] h-10 min-w-[52px] px-3 rounded-xl text-sm font-black tracking-wide hidden flex items-center justify-center gap-2 hover:border-[#C19A6B] hover:bg-black/85 transition';
  chip.innerHTML = '<i class="fa-solid fa-coins"></i><span>…</span>';
  chip.addEventListener('click', () => openJetonPackagesModal(window.__bazarJetonPackages || []));
  nav.appendChild(chip);
  return chip;
}

function renderJetonChip(summary) {
  const chip = ensureJetonChip();
  if (!chip) return;
  chip.classList.remove('hidden');
  chip.innerHTML = `<i class="fa-solid fa-coins"></i><span>${escapeHtml(summary.balance || 0)}</span>`;
}

function installTopControls() {
  const addOfferBtn = document.getElementById('btn-add-offer');
  if (addOfferBtn) {
    addOfferBtn.className =
      'absolute right-[9.5rem] md:right-[10.75rem] top-1/2 -translate-y-1/2 bg-[#C19A6B] text-black h-10 px-3.5 rounded-xl text-xs font-black uppercase tracking-[0.14em] hover:bg-white transition hidden flex items-center justify-center';
    addOfferBtn.innerHTML = '<i class="fa-solid fa-plus mr-1.5"></i>OGŁOSZENIE';
  }
}

function closeJetonPackagesModal() {
  document.getElementById('bazar-jeton-modal')?.remove();
  document.body.style.overflow = '';
}

function collectBuyerInput(modal) {
  const profile = getBuyerProfile();
  if (profile.role === 'company') return {};
  const addressFields = {
    street: modal.querySelector('#bazar-buyer-street')?.value?.trim() || '',
    buildingNumber: modal.querySelector('#bazar-buyer-building-number')?.value?.trim() || '',
    postalCode: modal.querySelector('#bazar-buyer-postal-code')?.value?.trim() || '',
    city: modal.querySelector('#bazar-buyer-city')?.value?.trim() || '',
  };
  return {
    name: modal.querySelector('#bazar-buyer-name')?.value?.trim() || '',
    email: modal.querySelector('#bazar-buyer-email')?.value?.trim() || '',
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

function getPromoState() {
  return window.__bazarPromoState || {
    code: '',
    appliedCode: null,
    packagePreviews: null,
    selectedPackageId: null,
  };
}

function setPromoState(nextState) {
  window.__bazarPromoState = {
    ...getPromoState(),
    ...(nextState || {}),
  };
}

function buildPackageCardsMarkup(packages, promoState) {
  const previews = Array.isArray(promoState.packagePreviews) && promoState.packagePreviews.length
    ? promoState.packagePreviews
    : packages.map((pkg) => ({
        ...pkg,
        effectivePriceCents: Number(pkg.priceCents || 0),
        pricePerTokenCents: Math.round(Number(pkg.priceCents || 0) / Math.max(1, Number(pkg.tokens || 1))),
      }));
  return previews.map((pkg) => {
    const isSelected = promoState.selectedPackageId === pkg.id;
    const basePrice = Number(pkg.priceCents || 0);
    const effectivePrice = Number(pkg.effectivePriceCents ?? basePrice);
    const pricePerJeton = Number(pkg.pricePerTokenCents ?? Math.round(effectivePrice / Math.max(1, Number(pkg.tokens || 1))));
    const hasDiscount = effectivePrice < basePrice;
    return `
      <button
        type="button"
        class="text-left rounded-[26px] border ${isSelected ? 'border-[#C19A6B] bg-[#C19A6B]/10' : 'border-zinc-700 bg-zinc-900/50'} p-5 hover:border-[#C19A6B] transition"
        data-package-id="${escapeHtml(pkg.id)}"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-2xl font-black text-white">${escapeHtml(buildPackageDisplayLabel(pkg))}</div>
            <div class="text-sm text-zinc-500 mt-2">${formatMoneyCents(pricePerJeton)} zł / żeton</div>
          </div>
          ${hasDiscount ? `<span class="px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">-${escapeHtml(pkg.discountPercent || 0)}%</span>` : ''}
        </div>
        <div class="mt-5">
          ${hasDiscount ? `<div class="text-xs text-zinc-500 line-through">${formatMoneyCents(basePrice)} zł</div>` : ''}
          <div class="text-3xl font-black text-[#C19A6B]">${formatMoneyCents(effectivePrice)} zł</div>
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
      <div class="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-zinc-100">
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
    <div class="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-zinc-100">
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

function renderJetonModal(modal, packages) {
  const state = getPromoState();
  const selectedPackageId = state.selectedPackageId || packages[0]?.id || '';
  setPromoState({ selectedPackageId });
  modal.innerHTML = `
    <div class="modal-panel max-w-5xl overflow-hidden" onclick="event.stopPropagation()">
      <div class="relative overflow-hidden">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(193,154,107,0.18),transparent_28%),radial-gradient(circle_at_left_center,rgba(59,130,246,0.12),transparent_32%),linear-gradient(180deg,rgba(18,18,18,0.98),rgba(10,10,10,0.96))]"></div>
        <div class="relative p-5 md:p-7 border-b border-zinc-800">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-xs uppercase tracking-[0.24em] text-zinc-500 mb-2">Zakup żetonów</div>
              <h3 class="text-3xl font-black text-white">Pakiety żetonów Bazaru</h3>
              <p class="text-sm text-zinc-400 mt-3 max-w-2xl">Kupujesz wyłącznie żetony. Potem wykorzystujesz je na publikację ponad limit, wyróżnienie, przypięcie i odświeżenie ofert.</p>
            </div>
            <button type="button" class="text-zinc-400 hover:text-white text-2xl" id="bazar-jeton-close"><i class="fa-solid fa-times"></i></button>
          </div>
        </div>
      </div>
      <div class="p-5 md:p-7 space-y-5 bg-[#0d0d0f]">
        ${buildPromoResultMarkup(state)}
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr),minmax(360px,0.88fr)] gap-5 items-start">
          <section class="space-y-5 min-w-0">
            <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5">
              <div class="flex flex-col md:flex-row md:items-end gap-4">
                <div class="flex-1">
                  <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Kod promocyjny</div>
                  <input id="bazar-promo-code-input" type="text" class="filter-input w-full" maxlength="64" value="${escapeHtml(state.code || '')}" placeholder="Wpisz kod rabatowy lub gratisowy">
                </div>
                <div class="flex gap-3">
                  <button type="button" id="bazar-promo-apply" class="px-4 py-3 rounded-2xl border border-[#C19A6B]/40 text-[#C19A6B] text-sm font-black uppercase tracking-[0.12em] hover:bg-[#C19A6B]/10 transition">
                    Zastosuj
                  </button>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${buildPackageCardsMarkup(packages, getPromoState())}
            </div>
          </section>
          <section class="space-y-5 xl:sticky xl:top-4">
            ${buildBuyerFieldsMarkup()}
            <label class="flex items-start gap-3 rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5 cursor-pointer">
              <input id="bazar-jeton-truth-confirm" type="checkbox" class="mt-1 accent-[#C19A6B]" />
              <span class="text-sm text-zinc-300">
                Potwierdzam, że dane do dokumentu sprzedaży są prawdziwe. Dokument zostanie wystawiony jako <strong>faktura zwolniona z VAT</strong>.
              </span>
            </label>
            <div class="rounded-3xl border border-zinc-700 bg-zinc-900/55 p-5">
              <div class="text-xs uppercase tracking-[0.18em] text-zinc-500 mb-2">Wybrany pakiet</div>
              <div id="bazar-selected-package" class="text-white"></div>
              <button type="button" id="bazar-jeton-checkout" class="mt-5 w-full bg-[#C19A6B] text-black px-5 py-3.5 rounded-2xl text-sm font-black uppercase tracking-[0.14em] hover:bg-white transition">
                Przejdź do płatności
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('#bazar-jeton-close')?.addEventListener('click', closeJetonPackagesModal);
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPromoState({ selectedPackageId: btn.getAttribute('data-package-id') || '' });
      renderJetonModal(modal, packages);
    });
  });
  modal.querySelector('#bazar-promo-apply')?.addEventListener('click', async () => {
    const code = modal.querySelector('#bazar-promo-code-input')?.value?.trim() || '';
    if (!code) {
      alert('Wpisz kod promocyjny.');
      return;
    }
    try {
      const selected = getPromoState().selectedPackageId || packages[0]?.id || '';
      const data = await apiGet(`/promo-code-preview?code=${encodeURIComponent(code)}&packageId=${encodeURIComponent(selected)}`);
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
    const selectedPackage = getPromoState().selectedPackageId || packages[0]?.id || '';
    if (!selectedPackage) {
      alert('Wybierz pakiet żetonów.');
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
        packageId: selectedPackage,
        truthConfirmed,
        buyerInput: collectBuyerInput(modal),
        promoCode: applied?.code || '',
      });
      if (data.url) window.location.href = data.url;
    } catch (error) {
      alert(error.message || 'Nie udało się rozpocząć zakupu.');
      button?.removeAttribute('disabled');
    }
  });

  const previewPkg = (Array.isArray(getPromoState().packagePreviews) && getPromoState().packagePreviews.length
    ? getPromoState().packagePreviews
    : packages).find((pkg) => pkg.id === (getPromoState().selectedPackageId || selectedPackageId)) || packages[0];
  const effectivePrice = Number(previewPkg?.effectivePriceCents ?? previewPkg?.priceCents ?? 0);
  const selectedTarget = modal.querySelector('#bazar-selected-package');
  if (selectedTarget) {
    selectedTarget.innerHTML = `
      <div class="text-lg font-bold">${escapeHtml(buildPackageDisplayLabel(previewPkg || {}))}</div>
      <div class="text-sm text-zinc-500 mt-1">${formatMoneyCents(Math.round(effectivePrice / Math.max(1, Number(previewPkg?.tokens || 1))))} zł / żeton</div>
      <div class="text-2xl font-black text-[#C19A6B] mt-3">${formatMoneyCents(effectivePrice)} zł</div>
    `;
  }
}

function openJetonPackagesModal(packages) {
  closeJetonPackagesModal();
  const modal = document.createElement('div');
  modal.id = 'bazar-jeton-modal';
  modal.className = 'modal-overlay';
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

  const filterBar = document.querySelector('.filter-bar');
  if (!filterBar) return;
  const actionsRow = filterBar.querySelector('.toolbar-actions') || filterBar;
  const btn = document.createElement('button');
  btn.id = 'bazar-rules-shortcut';
  btn.type = 'button';
  btn.className = 'toolbar-btn toolbar-btn--ghost';
  btn.innerHTML = '<i class="fa-solid fa-scale-balanced"></i><span>Zasady</span>';
  btn.addEventListener('click', openBazarRulesModal);
  actionsRow.appendChild(btn);
  window.openRegulationModal = openBazarRulesModal;
}

function installHookOverrides() {
  window.showMyOffers = showMyOffersEnhanced;
}

window.addEventListener('load', () => {
  installHookOverrides();
  installTopControls();
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
