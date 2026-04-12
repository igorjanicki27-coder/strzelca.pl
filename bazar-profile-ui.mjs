const API_BASE = 'https://strzelca.pl/api/bazar';

const bazarProfileState = {
  summaryData: null,
  history: [],
  purchases: [],
  offers: [],
  modalView: null,
  tokenPurchaseState: {
    code: '',
    appliedCode: null,
    packagePreviews: null,
    selectedPackageId: null,
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';
  const sec = value?._seconds ?? value?.seconds;
  const date = sec != null ? new Date(sec * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('pl-PL');
}

function formatMoneyCents(cents) {
  const value = Math.max(0, Number(cents || 0)) / 100;
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatTokensExpiry(value) {
  if (!value) return 'Brak aktywnych żetonów';
  const sec = value?._seconds ?? value?.seconds;
  const expiresAt = sec != null ? new Date(sec * 1000) : new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) return 'Brak aktywnych żetonów';
  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return 'Wygasły';
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days >= 365) return `około ${Math.round(days / 30)} mies.`;
  if (days >= 30) return `około ${Math.round(days / 30)} mies.`;
  return `${days} dni`;
}

function pluralizeŻetony(count) {
  const value = Math.abs(Number(count) || 0);
  if (value === 1) return 'żeton';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'żetony';
  return 'żetonów';
}

function getOfferTimestamp(value) {
  const sec = value?._seconds ?? value?.seconds;
  const date = sec != null ? new Date(sec * 1000) : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

async function getAuthHeaders() {
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser?.getIdToken) return {};
  const token = await auth.currentUser.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

async function apiJson(path, method, body) {
  const headers = await getAuthHeaders();
  headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

function isOwnProfile() {
  const auth = window.strzelcaFirebaseAuth;
  const currentUid = auth?.currentUser?.uid || '';
  const params = new URLSearchParams(window.location.search || '');
  const targetUid = params.get('uid') || params.get('profile') || '';
  return !targetUid || targetUid === currentUid;
}

function getBuyerPrefill() {
  return window.__bazarBuyerPrefill || {};
}

function getBuyerProfile() {
  return window.__bazarBuyerProfile || {};
}

function getOfferStatusMeta(status) {
  const map = {
    ACTIVE: { label: 'Aktywna', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    PENDING: { label: 'Oczekuje', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    REJECTED: { label: 'Odrzucona', cls: 'text-red-300 border-red-500/30 bg-red-500/10' },
    EXPIRED: { label: 'Wygasla', cls: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10' },
    SOLD: { label: 'Sprzedana', cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  };
  return map[String(status || '').toUpperCase()] || { label: status || 'Nieznany', cls: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10' };
}

function computeOfferBuckets(offers) {
  const active = offers.filter((offer) => offer.status === 'ACTIVE');
  const pending = offers.filter((offer) => offer.status === 'PENDING');
  const rejected = offers.filter((offer) => offer.status === 'REJECTED');
  const inactive = offers.filter((offer) => offer.status === 'EXPIRED' || offer.status === 'SOLD');
  return { active, pending, rejected, inactive };
}

function ensureBazarProfileCard() {
  let section = document.getElementById('bazar-section');
  if (section) return section;
  const commerce = document.getElementById('commerce-sections');
  const host = commerce || document.querySelector('main.container');
  if (!host) return null;
  section = document.createElement('section');
  section.id = 'bazar-section';
  section.className = 'bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800 shadow-2xl xl:col-span-2';
  section.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-2xl font-bold coyote-text">Bazar</h2>
      </div>
      <button id="bazar-buy-tokens-btn" type="button" class="btn-save w-full lg:w-auto">
        <i class="fa-solid fa-coins mr-2"></i>Kup żetony
      </button>
    </div>
    <div id="bazar-company-bar" class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4 mb-6"></div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section class="rounded-3xl border border-zinc-700 bg-zinc-900/40 p-5">
        <div class="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 class="text-xl font-semibold text-white">Ogłoszenia</h3>
            <p class="text-sm text-zinc-500 mt-1">Zarządzanie wystawionymi ofertami i ich statusami.</p>
          </div>
        </div>
        <div id="bazar-offers-summary" class="grid grid-cols-1 sm:grid-cols-2 gap-4"></div>
      </section>
      <section class="rounded-3xl border border-zinc-700 bg-zinc-900/40 p-5">
        <div class="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 class="text-xl font-semibold text-white">Żetony</h3>
            <p class="text-sm text-zinc-500 mt-1">Saldo, historia, wygasanie i pozostały darmowy limit publikacji.</p>
          </div>
        </div>
        <div id="bazar-tokens-summary" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"></div>
      </section>
    </div>
    <div id="bazar-section-modal" class="modal modal--stack-top"></div>
    <div id="bazar-token-packages-modal" class="modal modal--stack-top"></div>
  `;
  if (commerce) {
    commerce.insertBefore(section, commerce.firstChild);
  } else {
    host.appendChild(section);
  }
  return section;
}

function renderCompanyBar(profile, config, offerBuckets) {
  const target = document.getElementById('bazar-company-bar');
  if (!target) return;
  const isCompany = profile.role === 'company';
  if (isCompany) {
    const statusColor =
      profile.companyVerificationStatus === 'verified'
        ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
        : profile.companyVerificationStatus === 'rejected'
          ? 'text-red-300 border-red-500/40 bg-red-500/10'
          : 'text-amber-300 border-amber-500/40 bg-amber-500/10';
    target.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mb-2">Status firmy</div>
          <div class="inline-flex items-center gap-2 px-3 py-2 rounded-xl border ${statusColor}">
            <i class="fa-solid fa-building-shield"></i>
            <span class="font-semibold">${escapeHtml(profile.companyVerificationLabel || 'Konto firmowe')}</span>
          </div>
        </div>
        <div class="text-sm text-zinc-400 max-w-2xl">
          ${escapeHtml(profile.companyVerificationReason || 'Po weryfikacji firma publikuje automatycznie, kupuje żetony i dostaje automatyczne dokumenty sprzedaży.')}
        </div>
      </div>
    `;
    return;
  }
  const remainingFree = Math.max(0, Number(config.privateFreeActiveOffers || 5) - offerBuckets.active.length);
  target.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div class="text-sm text-zinc-300">
        Konto prywatne ma <strong class="text-zinc-100">${escapeHtml(String(config.privateFreeActiveOffers || 5))}</strong> darmowych aktywnych publikacji.
        Obecnie masz wykorzystane <strong class="text-zinc-100">${escapeHtml(String(offerBuckets.active.length))}</strong>, więc zostało
        <strong class="text-zinc-100">${escapeHtml(String(remainingFree))}</strong>.
      </div>
      <button type="button" class="px-4 py-2 rounded-xl border border-zinc-700 text-sm text-zinc-200 hover:border-[#C19A6B] hover:text-white transition" data-bazar-modal="tokens-free">
        Szczegóły limitu
      </button>
    </div>
  `;
  target.querySelector('[data-bazar-modal="tokens-free"]')?.addEventListener('click', () => openBazarModal('tokens-free'));
}

function renderOffersSummary(offerBuckets) {
  const target = document.getElementById('bazar-offers-summary');
  if (!target) return;
  const tiles = [
    {
      key: 'offers-active',
      label: 'Aktywne',
      value: offerBuckets.active.length,
      note: 'Widoczne na Bazarze',
      cls: 'border-emerald-500/30 bg-emerald-500/10',
      icon: 'fa-bullseye',
    },
    {
      key: 'offers-inactive',
      label: 'Nieaktywne',
      value: offerBuckets.inactive.length,
      note: 'Wygasłe lub sprzedane',
      cls: 'border-zinc-500/30 bg-zinc-500/10',
      icon: 'fa-box-archive',
    },
    {
      key: 'offers-pending',
      label: 'Oczekujące',
      value: offerBuckets.pending.length,
      note: 'Czekają na akceptację',
      cls: 'border-amber-500/30 bg-amber-500/10',
      icon: 'fa-hourglass-half',
    },
    {
      key: 'offers-rejected',
      label: 'Odrzucone',
      value: offerBuckets.rejected.length,
      note: 'Wymagają poprawy lub usunięcia',
      cls: 'border-red-500/30 bg-red-500/10',
      icon: 'fa-circle-xmark',
    },
  ];
  target.innerHTML = tiles.map((tile) => `
    <button type="button" class="text-left rounded-2xl border ${tile.cls} p-4 hover:border-[#C19A6B] transition" data-bazar-modal="${tile.key}">
      <div class="flex items-center justify-between gap-3">
        <div class="text-[11px] uppercase tracking-[0.22em] text-zinc-500">${escapeHtml(tile.label)}</div>
        <i class="fa-solid ${tile.icon} text-zinc-400"></i>
      </div>
      <div class="text-3xl font-black text-white mt-3">${escapeHtml(tile.value)}</div>
      <div class="text-xs text-zinc-500 mt-2">${escapeHtml(tile.note)}</div>
    </button>
  `).join('');
  target.querySelectorAll('[data-bazar-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openBazarModal(btn.getAttribute('data-bazar-modal')));
  });
}

function renderTokensSummary(summaryData, history, purchases, offers) {
  const target = document.getElementById('bazar-tokens-summary');
  if (!target) return;
  const summary = summaryData.summary || {};
  const config = summaryData.config || {};
  const lastPurchase = purchases[0] || null;
  const lastConsume = history.find((entry) => Number(entry.tokensDelta || 0) < 0) || null;
  const remainingFree = getBuyerProfile().role === 'company'
    ? '—'
    : Math.max(0, Number(config.privateFreeActiveOffers || 5) - offers.filter((offer) => offer.status === 'ACTIVE').length);

  const tiles = [
    {
      key: 'tokens-balance',
      label: 'Ilość żetonów',
      value: summary.balance || 0,
      note: 'Dostępne do wykorzystania',
      cls: 'border-[#C19A6B]/40 bg-[#C19A6B]/10',
      icon: 'fa-coins',
    },
    {
      key: 'tokens-purchases',
      label: 'Ostatni zakup',
      value: lastPurchase ? (lastPurchase.packageLabel || `${lastPurchase.tokens || 0} ${pluralizeŻetony(lastPurchase.tokens || 0)}`) : 'Brak',
      note: lastPurchase ? formatDateTime(lastPurchase.createdAt) : 'Nie kupiono jeszcze żetonów',
      cls: 'border-zinc-700 bg-zinc-800/50',
      icon: 'fa-cart-shopping',
    },
    {
      key: 'tokens-consume',
      label: 'Ostatnie użycie',
      value: lastConsume ? (lastConsume.reasonLabel || 'Zużycie żetonów') : 'Brak',
      note: lastConsume ? formatDateTime(lastConsume.createdAt) : 'Nie zużyto jeszcze żetonów',
      cls: 'border-zinc-700 bg-zinc-800/50',
      icon: 'fa-bolt',
    },
    {
      key: 'tokens-expiry',
      label: 'Czas do wygaśnięcia',
      value: formatTokensExpiry(summary.nextExpiryAt),
      note: summary.nextExpiryAt ? formatDateTime(summary.nextExpiryAt) : 'Brak aktywnych pakietów',
      cls: 'border-zinc-700 bg-zinc-800/50',
      icon: 'fa-clock',
    },
    {
      key: 'tokens-free',
      label: 'Darmowe publikacje',
      value: remainingFree,
      note: getBuyerProfile().role === 'company' ? 'Nie dotyczy kont firmowych' : 'Pozostały darmowy limit',
      cls: 'border-zinc-700 bg-zinc-800/50',
      icon: 'fa-ticket',
    },
  ];
  target.innerHTML = tiles.map((tile) => `
    <button type="button" class="text-left rounded-2xl border ${tile.cls} p-4 hover:border-[#C19A6B] transition" data-bazar-modal="${tile.key}">
      <div class="flex items-center justify-between gap-3">
        <div class="text-[11px] uppercase tracking-[0.22em] text-zinc-500">${escapeHtml(tile.label)}</div>
        <i class="fa-solid ${tile.icon} text-zinc-400"></i>
      </div>
      <div class="text-xl font-black text-white mt-3">${escapeHtml(tile.value)}</div>
      <div class="text-xs text-zinc-500 mt-2">${escapeHtml(tile.note)}</div>
    </button>
  `).join('');
  target.querySelectorAll('[data-bazar-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openBazarModal(btn.getAttribute('data-bazar-modal')));
  });
}

function getBuyerFieldsMarkup() {
  const buyer = getBuyerPrefill();
  const profile = getBuyerProfile();
  if (profile.role === 'company') {
    return `
      <div class="bg-sky-500/10 border border-sky-500/20 rounded-2xl p-4 text-sm text-zinc-200">
        Dla konta firmowego dane do dokumentu są pobierane z profilu firmy i statusu weryfikacji.
      </div>
    `;
  }
  return `
    <div class="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 space-y-3">
      <div class="text-sm font-semibold text-white">Dane do dokumentu sprzedaży</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Imię i nazwisko</span>
          <input id="bazar-buyer-name" class="w-full" maxlength="240" value="${escapeHtml(buyer.name || '')}" placeholder="Jan Kowalski" />
        </label>
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">E-mail do dokumentu</span>
          <input id="bazar-buyer-email" class="w-full" type="email" maxlength="180" value="${escapeHtml(buyer.email || '')}" placeholder="mail@adres.pl" />
        </label>
      </div>
      <label>
        <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Adres</span>
        <textarea id="bazar-buyer-address" class="w-full" rows="3" maxlength="320" placeholder="ul. Przykładowa 1/2, 00-001 Warszawa">${escapeHtml(buyer.address || '')}</textarea>
      </label>
      <div class="text-xs text-zinc-500">
        Możesz wpisać dane ręcznie tylko do tego zakupu, nawet jeśli nie masz ich zapisanych w profilu.
      </div>
    </div>
  `;
}

function collectBuyerInput(modal) {
  const profile = getBuyerProfile();
  if (profile.role === 'company') return {};
  return {
    name: modal.querySelector('#bazar-buyer-name')?.value?.trim() || '',
    email: modal.querySelector('#bazar-buyer-email')?.value?.trim() || '',
    address: modal.querySelector('#bazar-buyer-address')?.value?.trim() || '',
  };
}

function getTokenPurchaseState() {
  return bazarProfileState.tokenPurchaseState || {
    code: '',
    appliedCode: null,
    packagePreviews: null,
    selectedPackageId: null,
  };
}

function setTokenPurchaseState(nextState) {
  bazarProfileState.tokenPurchaseState = {
    ...getTokenPurchaseState(),
    ...(nextState || {}),
  };
}

function buildProfilePackageCardsMarkup(packages) {
  const state = getTokenPurchaseState();
  const previews = Array.isArray(state.packagePreviews) && state.packagePreviews.length
    ? state.packagePreviews
    : packages.map((pkg) => ({
        ...pkg,
        effectivePriceCents: Number(pkg.priceCents || 0),
        pricePerTokenCents: Math.round(Number(pkg.priceCents || 0) / Math.max(1, Number(pkg.tokens || 1))),
      }));
  return previews.map((pkg) => {
    const selectedId = state.selectedPackageId || packages[0]?.id || '';
    const isSelected = pkg.id === selectedId;
    const effectivePrice = Number(pkg.effectivePriceCents ?? pkg.priceCents ?? 0);
    const perJeton = Number(pkg.pricePerTokenCents ?? Math.round(effectivePrice / Math.max(1, Number(pkg.tokens || 1))));
    const hasDiscount = effectivePrice < Number(pkg.priceCents || 0);
    return `
      <button type="button" class="text-left rounded-2xl border ${isSelected ? 'border-[#C19A6B] bg-[#C19A6B]/10' : 'border-zinc-700 bg-zinc-800/50'} p-4 hover:border-[#C19A6B] transition" data-package-id="${escapeHtml(pkg.id)}">
        <div class="text-lg font-bold text-white">${escapeHtml(pkg.tokens)} ${pluralizeŻetony(pkg.tokens)}</div>
        <div class="text-sm text-zinc-400 mt-1">${formatMoneyCents(perJeton)} zł / żeton</div>
        <div class="mt-3">
          ${hasDiscount ? `<div class="text-xs text-zinc-500 line-through">${formatMoneyCents(pkg.priceCents)} zł</div>` : ''}
          <div class="text-2xl font-black text-[#C19A6B]">${formatMoneyCents(effectivePrice)} zł</div>
        </div>
      </button>
    `;
  }).join('');
}

function renderProfilePromoBox() {
  const applied = getTokenPurchaseState().appliedCode;
  if (!applied) return '';
  if (applied.kind === 'grant') {
    return `
      <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-100">
        <div class="font-semibold text-white">Kod gratisowy: ${escapeHtml(applied.code)}</div>
        <div class="mt-1">Ten kod dopisze do konta <strong>${escapeHtml(applied.grantTokens || 0)} ${pluralizeŻetony(applied.grantTokens || 0)}</strong>.</div>
        <div class="mt-3 flex gap-3">
          <button type="button" id="bazar-profile-promo-redeem" class="px-4 py-2 rounded-xl bg-emerald-500 text-black font-bold hover:bg-emerald-400 transition">Odbierz żetony</button>
          <button type="button" id="bazar-profile-promo-remove" class="px-4 py-2 rounded-xl border border-zinc-600 text-zinc-200 hover:bg-zinc-800 transition">Usuń kod</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-100">
      <div class="font-semibold text-white">Kod rabatowy: ${escapeHtml(applied.code)}</div>
      <div class="mt-1">Rabat <strong>${escapeHtml(applied.discountPercent || 0)}%</strong> został doliczony do wszystkich pakietów.</div>
      <div class="mt-3">
        <button type="button" id="bazar-profile-promo-remove" class="px-4 py-2 rounded-xl border border-zinc-600 text-zinc-200 hover:bg-zinc-800 transition">Usuń kod</button>
      </div>
    </div>
  `;
}

function renderTokenPackagesModal(packages) {
  const modal = document.getElementById('bazar-token-packages-modal');
  if (!modal) return;
  const state = getTokenPurchaseState();
  const selectedPackageId = state.selectedPackageId || packages[0]?.id || '';
  setTokenPurchaseState({ selectedPackageId });
  const activePackages = (Array.isArray(state.packagePreviews) && state.packagePreviews.length ? state.packagePreviews : packages);
  const previewPkg = activePackages.find((pkg) => pkg.id === (getTokenPurchaseState().selectedPackageId || selectedPackageId)) || activePackages[0] || packages[0];
  const effectivePrice = Number(previewPkg?.effectivePriceCents ?? previewPkg?.priceCents ?? 0);

  modal.removeEventListener('click', onModalBackdropClose);
  modal.innerHTML = `
    <div class="modal-content modal-content--wide" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="text-xl font-bold coyote-text">Kup żetony do Bazaru</h3>
        <button type="button" class="modal-close" id="bazar-token-packages-close">&times;</button>
      </div>
      <div class="space-y-4">
        <div class="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4 text-sm text-zinc-300">
          Kupujesz <strong>tylko żetony</strong>. Publikacja ponad limit, przypięcie, wyróżnienie i odświeżenie zużywają żetony z Twojego salda.
        </div>
        ${renderProfilePromoBox()}
        <div class="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4">
          <div class="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3">
            <input id="bazar-profile-promo-code" class="w-full" maxlength="64" value="${escapeHtml(state.code || '')}" placeholder="Wpisz kod rabatowy lub gratisowy" />
            <button type="button" id="bazar-profile-promo-apply" class="px-4 py-2 rounded-xl border border-[#C19A6B]/40 text-[#C19A6B] font-bold hover:bg-[#C19A6B]/10 transition">Zastosuj</button>
          </div>
        </div>
        ${getBuyerFieldsMarkup()}
        <label class="flex items-start gap-3 bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 cursor-pointer">
          <input type="checkbox" id="bazar-token-truth-confirm" class="mt-1" />
          <span class="text-sm text-zinc-300">
            Potwierdzam, że dane nabywcy do tego zakupu są prawdziwe i mogą zostać użyte do wystawienia dokumentu sprzedaży jako <strong>faktura zwolniona z VAT</strong>.
          </span>
        </label>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${buildProfilePackageCardsMarkup(packages)}
        </div>
        <div class="rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4">
          <div class="text-xs uppercase tracking-widest text-zinc-500 mb-2">Wybrany pakiet</div>
          <div class="text-lg font-bold text-white">${escapeHtml(previewPkg?.tokens || 0)} ${pluralizeŻetony(previewPkg?.tokens || 0)}</div>
          <div class="text-sm text-zinc-500 mt-1">${formatMoneyCents(Math.round(effectivePrice / Math.max(1, Number(previewPkg?.tokens || 1))))} zł / żeton</div>
          <div class="text-2xl font-black text-[#C19A6B] mt-3">${formatMoneyCents(effectivePrice)} zł</div>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', onModalBackdropClose);
  modal.querySelector('#bazar-token-packages-close')?.addEventListener('click', closeTokenPackagesModal);
  modal.querySelector('#bazar-profile-promo-apply')?.addEventListener('click', async () => {
    const code = modal.querySelector('#bazar-profile-promo-code')?.value?.trim() || '';
    if (!code) {
      alert('Wpisz kod promocyjny.');
      return;
    }
    try {
      const selected = getTokenPurchaseState().selectedPackageId || packages[0]?.id || '';
      const data = await apiGet(`/promo-code-preview?code=${encodeURIComponent(code)}&packageId=${encodeURIComponent(selected)}`);
      setTokenPurchaseState({
        code,
        appliedCode: data.promoCode || null,
        packagePreviews: data.packages || null,
      });
      renderTokenPackagesModal(packages);
    } catch (error) {
      alert(error.message || 'Nie udało się zastosować kodu promocyjnego.');
    }
  });
  modal.querySelector('#bazar-profile-promo-remove')?.addEventListener('click', () => {
    setTokenPurchaseState({ code: '', appliedCode: null, packagePreviews: null });
    renderTokenPackagesModal(packages);
  });
  modal.querySelector('#bazar-profile-promo-redeem')?.addEventListener('click', async () => {
    const applied = getTokenPurchaseState().appliedCode;
    if (!applied?.code) return;
    try {
      await apiJson('/promo-code-redeem', 'POST', { code: applied.code });
      alert(`Kod został zrealizowany. ${applied.grantTokens || 0} ${pluralizeŻetony(applied.grantTokens || 0)} dodano do konta.`);
      setTokenPurchaseState({ code: '', appliedCode: null, packagePreviews: null });
      await loadBazarProfileUi();
      closeTokenPackagesModal();
    } catch (error) {
      alert(error.message || 'Nie udało się zrealizować kodu.');
    }
  });
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTokenPurchaseState({ selectedPackageId: btn.getAttribute('data-package-id') || '' });
      renderTokenPackagesModal(packages);
    });
  });
  const footer = modal.querySelector('.space-y-4');
  if (footer && !modal.querySelector('#bazar-token-checkout-btn')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'bazar-token-checkout-btn';
    button.className = 'w-full bg-[#C19A6B] text-black px-5 py-3 rounded-xl text-sm font-bold hover:bg-white transition';
    button.textContent = 'Przejdź do płatności';
    footer.appendChild(button);
  }
  modal.querySelector('#bazar-token-checkout-btn')?.addEventListener('click', async () => {
      const truthConfirmed = modal.querySelector('#bazar-token-truth-confirm')?.checked === true;
      if (!truthConfirmed) {
        alert('Potwierdź prawdziwość danych nabywcy przed zakupem żetonów.');
        return;
      }
      const applied = getTokenPurchaseState().appliedCode;
      if (applied?.kind === 'grant') {
        alert('Kod gratisowy nie wymaga płatności. Kliknij „Odbierz żetony”.');
        return;
      }
      const selectedPackage = getTokenPurchaseState().selectedPackageId || packages[0]?.id || '';
      const button = modal.querySelector('#bazar-token-checkout-btn');
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
        alert(error.message || 'Nie udało się rozpocząć zakupu żetonów.');
        button?.removeAttribute('disabled');
      }
    });
}

function openTokenPackagesModal(packages) {
  setTokenPurchaseState({ selectedPackageId: getTokenPurchaseState().selectedPackageId || packages[0]?.id || '' });
  renderTokenPackagesModal(packages);
}

function closeTokenPackagesModal() {
  const modal = document.getElementById('bazar-token-packages-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.innerHTML = '';
  modal.removeEventListener('click', onModalBackdropClose);
  document.body.style.overflow = '';
}

function onModalBackdropClose(event) {
  if (event.target?.id === 'bazar-token-packages-modal') closeTokenPackagesModal();
}

function closeBazarModal() {
  const modal = document.getElementById('bazar-section-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.innerHTML = '';
  modal.removeEventListener('click', onBazarModalBackdropClose);
  bazarProfileState.modalView = null;
  document.body.style.overflow = '';
}

function onBazarModalBackdropClose(event) {
  if (event.target?.id === 'bazar-section-modal') closeBazarModal();
}

function getOfferListForView(viewKey) {
  const offers = bazarProfileState.offers || [];
  switch (viewKey) {
    case 'offers-active':
      return offers.filter((offer) => offer.status === 'ACTIVE');
    case 'offers-pending':
      return offers.filter((offer) => offer.status === 'PENDING');
    case 'offers-rejected':
      return offers.filter((offer) => offer.status === 'REJECTED');
    case 'offers-inactive':
      return offers.filter((offer) => offer.status === 'EXPIRED' || offer.status === 'SOLD');
    default:
      return offers;
  }
}

function getOfferModalTitle(viewKey) {
  const map = {
    'offers-active': 'Aktywne ogłoszenia',
    'offers-pending': 'Ogłoszenia oczekujące',
    'offers-rejected': 'Odrzucone ogłoszenia',
    'offers-inactive': 'Nieaktywne ogłoszenia',
  };
  return map[viewKey] || 'Ogłoszenia Bazaru';
}

function getOfferActions(offer) {
  const actions = [];
  actions.push(`<a href="https://bazar.strzelca.pl/?offer=${encodeURIComponent(offer.id)}" target="_blank" rel="noopener noreferrer" class="px-3 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-200 hover:border-[#C19A6B] hover:text-white transition">Podgląd</a>`);
  if (offer.status === 'ACTIVE' || offer.status === 'EXPIRED') {
    actions.push(`<button type="button" data-bazar-offer-action="refresh" data-offer-id="${escapeHtml(offer.id)}" class="px-3 py-2 rounded-lg bg-green-700 text-white text-sm hover:bg-green-600 transition">${offer.status === 'EXPIRED' ? 'Aktywuj ponownie' : 'Odśwież'}</button>`);
  }
  if (offer.status === 'ACTIVE') {
    actions.push(`<button type="button" data-bazar-offer-action="highlight" data-offer-id="${escapeHtml(offer.id)}" class="px-3 py-2 rounded-lg border border-[#C19A6B]/40 text-[#C19A6B] text-sm hover:bg-[#C19A6B]/10 transition">Wyróżnij</button>`);
    actions.push(`<button type="button" data-bazar-offer-action="pin" data-offer-id="${escapeHtml(offer.id)}" class="px-3 py-2 rounded-lg border border-sky-500/40 text-sky-300 text-sm hover:bg-sky-500/10 transition">Przypnij</button>`);
    actions.push(`<button type="button" data-bazar-offer-action="sold" data-offer-id="${escapeHtml(offer.id)}" class="px-3 py-2 rounded-lg bg-blue-700 text-white text-sm hover:bg-blue-600 transition">Sprzedane</button>`);
  }
  actions.push(`<button type="button" data-bazar-offer-action="delete" data-offer-id="${escapeHtml(offer.id)}" class="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 text-sm hover:bg-red-500/10 transition">Usun</button>`);
  return actions.join('');
}

function renderOfferListModal(viewKey) {
  const offers = getOfferListForView(viewKey).sort((a, b) => getOfferTimestamp(b.created_at || b.last_refreshed_at) - getOfferTimestamp(a.created_at || a.last_refreshed_at));
  if (!offers.length) {
    return `
      <div class="text-sm text-zinc-500 text-center py-10">
        Brak ogłoszeń w tej sekcji.
      </div>
    `;
  }
  return `
    <div class="space-y-4">
      ${offers.map((offer) => {
        const status = getOfferStatusMeta(offer.status);
        const image = offer.mainImage
          ? `<img src="${escapeHtml(offer.mainImage)}" alt="" class="w-20 h-20 rounded-xl object-cover flex-shrink-0">`
          : `<div class="w-20 h-20 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-600 flex-shrink-0"><i class="fa-solid fa-image"></i></div>`;
        return `
          <article class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
            <div class="flex flex-col lg:flex-row gap-4">
              ${image}
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h4 class="text-lg font-semibold text-white truncate">${escapeHtml(offer.title || 'Oferta')}</h4>
                    <div class="text-sm text-[#C19A6B] font-bold mt-1">${offer.price ? `${Number(offer.price).toLocaleString('pl-PL')} PLN` : 'Cena do uzgodnienia'}</div>
                    <div class="text-xs text-zinc-500 mt-1">${escapeHtml(offer.miejscowosc || '')}</div>
                  </div>
                  <span class="px-3 py-1 rounded-full border text-xs font-semibold ${status.cls}">${escapeHtml(status.label)}</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs text-zinc-400">
                  <div>
                    <div class="uppercase tracking-widest text-zinc-500 mb-1">Ostatnie odświeżenie</div>
                    <div>${escapeHtml(formatDateTime(offer.last_refreshed_at || offer.created_at))}</div>
                  </div>
                  <div>
                    <div class="uppercase tracking-widest text-zinc-500 mb-1">Wygasa</div>
                    <div>${escapeHtml(formatDateTime(offer.expires_at))}</div>
                  </div>
                  <div>
                    <div class="uppercase tracking-widest text-zinc-500 mb-1">Promocja</div>
                    <div>${offer.is_pinned ? 'Przypięta' : offer.is_highlighted ? 'Wyróżniona' : 'Brak'}</div>
                  </div>
                </div>
                ${offer.rejection_reason ? `<div class="mt-3 text-sm text-red-300">Powód odrzucenia: ${escapeHtml(offer.rejection_reason)}</div>` : ''}
                <div class="flex flex-wrap gap-2 mt-4">
                  ${getOfferActions(offer)}
                </div>
              </div>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderTokenBalanceModal() {
  const summary = bazarProfileState.summaryData?.summary || {};
  const grants = Array.isArray(summary.activeGrants) ? summary.activeGrants : [];
  return `
    <div class="space-y-4">
      <div class="rounded-2xl border border-[#C19A6B]/40 bg-[#C19A6B]/10 p-4">
        <div class="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Saldo żetonów</div>
        <div class="text-3xl font-black text-white mt-2">${escapeHtml(summary.balance || 0)}</div>
      </div>
      ${grants.length ? grants.map((grant) => `
        <article class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold text-white">${escapeHtml(grant.packageLabel || 'Pakiet żetonów')}</div>
              <div class="text-xs text-zinc-500 mt-1">Pozostało ${escapeHtml(grant.remainingTokens)} z ${escapeHtml(grant.totalTokens)} ${pluralizeŻetony(grant.totalTokens)}</div>
            </div>
            <div class="text-right text-xs text-zinc-400">
              <div>Wygasa</div>
              <div class="text-zinc-200 mt-1">${escapeHtml(formatDateTime(grant.expiresAt))}</div>
            </div>
          </div>
        </article>
      `).join('') : '<div class="text-sm text-zinc-500">Brak aktywnych pakietów żetonów.</div>'}
    </div>
  `;
}

function renderTokenPurchasesModal() {
  const purchases = bazarProfileState.purchases || [];
  if (!purchases.length) {
    return '<div class="text-sm text-zinc-500 text-center py-10">Brak zakupów żetonów.</div>';
  }
  return `
    <div class="space-y-4">
      ${purchases.map((purchase) => {
        const invoiceLink = purchase.invoiceId
          ? `<a href="https://strzelca.pl/api/bazar-invoice-download?invoiceId=${encodeURIComponent(purchase.invoiceId)}" target="_blank" rel="noopener noreferrer" class="text-[#C19A6B] hover:underline">Dokument</a>`
          : '<span class="text-zinc-500">Dokument w przygotowaniu</span>';
        return `
          <article class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-white">${escapeHtml(purchase.packageLabel || 'Pakiet żetonów')}</div>
                <div class="text-xs text-zinc-500 mt-1">${escapeHtml(formatDateTime(purchase.createdAt))}</div>
              </div>
              <div class="text-right">
                <div class="font-black text-white">${escapeHtml(purchase.tokens || 0)} ${pluralizeŻetony(purchase.tokens || 0)}</div>
                <div class="text-xs text-zinc-500">${formatMoneyCents(purchase.amountCents)} zł</div>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3 mt-3 text-xs">
              <span class="px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">${escapeHtml(purchase.processingStatus || purchase.status || 'pending')}</span>
              ${invoiceLink}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderTokenConsumeModal() {
  const history = (bazarProfileState.history || []).filter((entry) => Number(entry.tokensDelta || 0) < 0);
  if (!history.length) {
    return '<div class="text-sm text-zinc-500 text-center py-10">Brak historii zużycia żetonów.</div>';
  }
  return `
    <div class="space-y-4">
      ${history.map((entry) => `
        <article class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold text-white">${escapeHtml(entry.reasonLabel || entry.reasonKey || 'Zużycie żetonów')}</div>
              <div class="text-xs text-zinc-500 mt-1">${escapeHtml(formatDateTime(entry.createdAt))}</div>
              ${entry.note ? `<div class="text-xs text-zinc-500 mt-2">${escapeHtml(entry.note)}</div>` : ''}
            </div>
            <div class="text-lg font-black text-red-300">${escapeHtml(entry.tokensDelta)}</div>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderTokenExpiryModal() {
  const summary = bazarProfileState.summaryData?.summary || {};
  const grants = Array.isArray(summary.activeGrants) ? summary.activeGrants : [];
  const intro = `
    <div class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4 text-sm text-zinc-300 mb-4">
      Dokupienie nowego pakietu wydłuża ważność aktywnych żetonów o kolejny rok od daty zakupu.
    </div>
  `;
  if (!grants.length) {
    return `${intro}<div class="text-sm text-zinc-500 text-center py-6">Brak aktywnych pakietów żetonów.</div>`;
  }
  return `
    ${intro}
    <div class="space-y-4">
      ${grants.map((grant) => `
        <article class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold text-white">${escapeHtml(grant.packageLabel || 'Pakiet żetonów')}</div>
              <div class="text-xs text-zinc-500 mt-1">${escapeHtml(grant.remainingTokens)} ${pluralizeŻetony(grant.remainingTokens)} pozostało</div>
            </div>
            <div class="text-right">
              <div class="text-sm font-semibold text-white">${escapeHtml(formatTokensExpiry(grant.expiresAt))}</div>
              <div class="text-xs text-zinc-500 mt-1">${escapeHtml(formatDateTime(grant.expiresAt))}</div>
            </div>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderFreePublicationsModal() {
  const summaryData = bazarProfileState.summaryData || {};
  const profile = summaryData.profile || {};
  const config = summaryData.config || {};
  if (profile.role === 'company') {
    return `
      <div class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4 text-sm text-zinc-300">
        Konto firmowe korzysta z żetonów i pakietów. Darmowy limit publikacji nie dotyczy firm.
      </div>
    `;
  }
  const activeCount = (bazarProfileState.offers || []).filter((offer) => offer.status === 'ACTIVE').length;
  const limit = Number(config.privateFreeActiveOffers || 5);
  const remaining = Math.max(0, limit - activeCount);
  return `
    <div class="space-y-4">
      <div class="rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4">
        <div class="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Pozostały darmowy limit</div>
        <div class="text-3xl font-black text-white mt-2">${escapeHtml(remaining)}</div>
        <div class="text-sm text-zinc-400 mt-2">
          Limit podstawowy: ${escapeHtml(limit)} aktywnych ogłoszeń. Aktualnie aktywnych: ${escapeHtml(activeCount)}.
        </div>
      </div>
      ${renderOfferListModal('offers-active')}
    </div>
  `;
}

function renderModalContent(viewKey) {
  if (String(viewKey || '').startsWith('offers-')) return renderOfferListModal(viewKey);
  switch (viewKey) {
    case 'tokens-balance':
      return renderTokenBalanceModal();
    case 'tokens-purchases':
      return renderTokenPurchasesModal();
    case 'tokens-consume':
      return renderTokenConsumeModal();
    case 'tokens-expiry':
      return renderTokenExpiryModal();
    case 'tokens-free':
      return renderFreePublicationsModal();
    default:
      return '<div class="text-sm text-zinc-500">Brak danych.</div>';
  }
}

function getModalTitle(viewKey) {
  if (String(viewKey || '').startsWith('offers-')) return getOfferModalTitle(viewKey);
  const map = {
    'tokens-balance': 'Saldo żetonów',
    'tokens-purchases': 'Historia zakupów żetonów',
    'tokens-consume': 'Historia zużycia żetonów',
    'tokens-expiry': 'Wygasanie żetonów',
    'tokens-free': 'Darmowe publikacje',
  };
  return map[viewKey] || 'Bazar';
}

function bindOfferModalActions(modal) {
  modal.querySelectorAll('[data-bazar-offer-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-bazar-offer-action');
      const offerId = btn.getAttribute('data-offer-id');
      const actionLabelMap = {
        refresh: 'odświeżyć lub aktywować ponownie i podbić na górę listy',
        highlight: 'wyróżnić na 30 dni i pokazać w karuzeli strony głównej przez 7 dni',
        pin: 'przypiąć na górze listy przez 7 dni',
        sold: 'oznaczyć jako sprzedane',
        delete: 'usunąć',
      };
      if (!offerId) return;
      if (!window.confirm(`Czy chcesz ${actionLabelMap[action] || 'wykonać akcję'} dla tego ogłoszenia?`)) return;
      btn.setAttribute('disabled', 'disabled');
      try {
        if (action === 'refresh') {
          await apiJson(`/refresh/${encodeURIComponent(offerId)}`, 'POST', {});
        } else if (action === 'highlight' || action === 'pin') {
          await apiJson(`/promote/${encodeURIComponent(offerId)}`, 'POST', { action });
        } else if (action === 'sold') {
          await apiJson(`/sold/${encodeURIComponent(offerId)}`, 'POST', {});
        } else if (action === 'delete') {
          await apiJson(`/offer/${encodeURIComponent(offerId)}`, 'DELETE');
        }
        await loadBazarProfileUi({ keepModal: true });
      } catch (error) {
        alert(error.message || 'Nie udało się wykonać akcji dla ogłoszenia.');
        btn.removeAttribute('disabled');
      }
    });
  });
}

function openBazarModal(viewKey) {
  const modal = document.getElementById('bazar-section-modal');
  if (!modal) return;
  bazarProfileState.modalView = viewKey;
  modal.removeEventListener('click', onBazarModalBackdropClose);
  modal.innerHTML = `
    <div class="modal-content modal-content--wide" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="text-xl font-bold coyote-text">${escapeHtml(getModalTitle(viewKey))}</h3>
        <button type="button" class="modal-close" id="bazar-section-close">&times;</button>
      </div>
      <div class="space-y-4">
        ${renderModalContent(viewKey)}
      </div>
    </div>
  `;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', onBazarModalBackdropClose);
  modal.querySelector('#bazar-section-close')?.addEventListener('click', closeBazarModal);
  bindOfferModalActions(modal);
}

async function loadBazarProfileUi(options = {}) {
  if (!isOwnProfile()) return;
  const section = ensureBazarProfileCard();
  if (!section) return;
  try {
    const [summaryData, historyData, purchasesData, offersData] = await Promise.all([
      apiGet('/token-summary'),
      apiGet('/token-history'),
      apiGet('/purchases'),
      apiGet('/my'),
    ]);
    bazarProfileState.summaryData = summaryData;
    bazarProfileState.history = historyData.history || [];
    bazarProfileState.purchases = purchasesData.purchases || [];
    bazarProfileState.offers = offersData.offers || [];
    window.__bazarBuyerPrefill = summaryData.buyerPrefill || {};
    window.__bazarBuyerProfile = summaryData.profile || {};

    const offerBuckets = computeOfferBuckets(bazarProfileState.offers);
    renderCompanyBar(summaryData.profile || {}, summaryData.config || {}, offerBuckets);
    renderOffersSummary(offerBuckets);
    renderTokensSummary(summaryData, bazarProfileState.history, bazarProfileState.purchases, bazarProfileState.offers);

    const btn = document.getElementById('bazar-buy-tokens-btn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => openTokenPackagesModal(summaryData.config?.packages || []));
    }

    if (options.keepModal && bazarProfileState.modalView) {
      openBazarModal(bazarProfileState.modalView);
    }
  } catch (error) {
    section.innerHTML = `
      <div class="text-red-300">
        Nie udało się załadować sekcji Bazar: ${escapeHtml(error.message || 'nieznany błąd')}
      </div>
    `;
  }
}

window.addEventListener('load', () => {
  const tryLoad = () => {
    if (window.strzelcaFirebaseAuth?.currentUser) {
      loadBazarProfileUi().catch(() => null);
      return true;
    }
    return false;
  };
  if (tryLoad()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (tryLoad() || attempts > 15) clearInterval(timer);
  }, 700);
});
