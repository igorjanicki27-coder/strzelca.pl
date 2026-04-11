const API_BASE = 'https://strzelca.pl/api/bazar';

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

async function apiPost(path, body) {
  const headers = await getAuthHeaders();
  headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body || {}),
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

function ensureBazarProfileCard() {
  let section = document.getElementById('bazar-premium-section');
  if (section) return section;
  const commerce = document.getElementById('commerce-sections');
  const host = commerce?.parentElement || document.querySelector('main.container');
  if (!host) return null;
  section = document.createElement('section');
  section.id = 'bazar-premium-section';
  section.className = 'bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800 shadow-2xl mt-8';
  section.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-2xl font-bold coyote-text">Bazar Premium</h2>
        <p class="text-sm text-zinc-400 mt-1">Tokeny do publikacji ogloszen, wyroznien, przypiec i odswiezen.</p>
      </div>
      <button id="bazar-buy-tokens-btn" type="button" class="btn-save w-full lg:w-auto">
        <i class="fa-solid fa-coins mr-2"></i>Kup tokeny
      </button>
    </div>
    <div id="bazar-premium-summary" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"></div>
    <div id="bazar-premium-company" class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4 mb-6"></div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold text-white">Historia tokenow</h3>
        </div>
        <div id="bazar-token-history" class="space-y-3 text-sm text-zinc-300"></div>
      </div>
      <div class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold text-white">Zakupy tokenow</h3>
        </div>
        <div id="bazar-token-purchases" class="space-y-3 text-sm text-zinc-300"></div>
      </div>
    </div>
    <div id="bazar-token-packages-modal" class="modal"></div>
  `;
  host.appendChild(section);
  return section;
}

function renderSummary(summary, config) {
  const target = document.getElementById('bazar-premium-summary');
  if (!target) return;
  target.innerHTML = `
    <div class="rounded-2xl border border-[#C19A6B]/40 bg-[#C19A6B]/10 p-4">
      <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-400 mb-2">Saldo tokenow</div>
      <div class="text-3xl font-black text-white">${summary.balance || 0}</div>
      <div class="text-xs text-zinc-500 mt-2">Dostepne do wykorzystania w Bazarze.</div>
    </div>
    <div class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4">
      <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-400 mb-2">Zuzyte tokeny</div>
      <div class="text-3xl font-black text-white">${summary.usedTokens || 0}</div>
      <div class="text-xs text-zinc-500 mt-2">Akcje premium i publikacje ponad limity.</div>
    </div>
    <div class="rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4">
      <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-400 mb-2">Wygasanie</div>
      <div class="text-lg font-bold text-white">${summary.nextExpiryAt ? formatDateTime(summary.nextExpiryAt) : 'Brak wygasajacych'}</div>
      <div class="text-xs text-zinc-500 mt-2">Pakiety sa aktywne przez 1 rok od zakupu.</div>
    </div>
  `;

  const btn = document.getElementById('bazar-buy-tokens-btn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => openTokenPackagesModal(config.packages || []));
  }
}

function renderCompanyStatus(profile) {
  const target = document.getElementById('bazar-premium-company');
  if (!target) return;
  const isCompany = profile.role === 'company';
  const statusColor =
    profile.companyVerificationStatus === 'verified'
      ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
      : profile.companyVerificationStatus === 'rejected'
        ? 'text-red-300 border-red-500/40 bg-red-500/10'
        : 'text-amber-300 border-amber-500/40 bg-amber-500/10';
  target.innerHTML = isCompany
    ? `
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mb-2">Status firmy</div>
          <div class="inline-flex items-center gap-2 px-3 py-2 rounded-xl border ${statusColor}">
            <i class="fa-solid fa-building-shield"></i>
            <span class="font-semibold">${escapeHtml(profile.companyVerificationLabel || 'Konto firmowe')}</span>
          </div>
        </div>
        <div class="text-sm text-zinc-400 max-w-2xl">
          ${escapeHtml(profile.companyVerificationReason || 'Po weryfikacji konto firmowe publikuje oferty automatycznie, korzysta z tokenow i dostaje automatyczne dokumenty sprzedazy.')}
        </div>
      </div>
    `
    : `
      <div class="text-sm text-zinc-400">
        Konto prywatne ma <strong class="text-zinc-200">${escapeHtml(String(profile.privateFreeActiveOffers ?? 5))}</strong> darmowych aktywnych ofert.
        Kolejne publikacje i uslugi premium korzystaja z tokenow.
      </div>
    `;
}

function renderHistory(history) {
  const target = document.getElementById('bazar-token-history');
  if (!target) return;
  if (!Array.isArray(history) || history.length === 0) {
    target.innerHTML = '<div class="text-zinc-500">Brak historii tokenow.</div>';
    return;
  }
  target.innerHTML = history.slice(0, 12).map((entry) => {
    const positive = Number(entry.tokensDelta || 0) > 0;
    const color = positive ? 'text-emerald-300' : 'text-red-300';
    const sign = positive ? '+' : '';
    return `
      <article class="rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${escapeHtml(entry.reasonLabel || entry.reasonKey || 'Tokeny')}</div>
            <div class="text-xs text-zinc-500 mt-1">${escapeHtml(formatDateTime(entry.createdAt))}</div>
          </div>
          <div class="text-lg font-black ${color}">${sign}${escapeHtml(entry.tokensDelta)}</div>
        </div>
        ${entry.note ? `<div class="text-xs text-zinc-500 mt-2">${escapeHtml(entry.note)}</div>` : ''}
      </article>
    `;
  }).join('');
}

function renderPurchases(purchases) {
  const target = document.getElementById('bazar-token-purchases');
  if (!target) return;
  if (!Array.isArray(purchases) || purchases.length === 0) {
    target.innerHTML = '<div class="text-zinc-500">Brak zakupionych pakietow tokenow.</div>';
    return;
  }
  target.innerHTML = purchases.slice(0, 12).map((purchase) => {
    const invoiceLink = purchase.invoiceId
      ? `<a href="https://strzelca.pl/api/bazar-invoice-download?invoiceId=${encodeURIComponent(purchase.invoiceId)}" class="text-[#C19A6B] hover:underline" target="_blank" rel="noopener noreferrer">Pobierz dokument</a>`
      : '<span class="text-zinc-500">Dokument w przygotowaniu</span>';
    return `
      <article class="rounded-xl border border-zinc-700 bg-zinc-900/40 p-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${escapeHtml(purchase.packageLabel || 'Pakiet tokenow')}</div>
            <div class="text-xs text-zinc-500 mt-1">${escapeHtml(formatDateTime(purchase.createdAt))}</div>
          </div>
          <div class="text-right">
            <div class="font-black text-white">${escapeHtml(purchase.tokens || 0)} tokenow</div>
            <div class="text-xs text-zinc-500">${formatMoneyCents(purchase.amountCents)} zl</div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-3 mt-3 text-xs">
          <span class="px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">${escapeHtml(purchase.processingStatus || purchase.status || 'pending')}</span>
          ${invoiceLink}
        </div>
      </article>
    `;
  }).join('');
}

function openTokenPackagesModal(packages) {
  const modal = document.getElementById('bazar-token-packages-modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-content modal-content--wide" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 class="text-xl font-bold coyote-text">Kup tokeny do Bazaru</h3>
        <button type="button" class="modal-close" id="bazar-token-packages-close">&times;</button>
      </div>
      <div class="space-y-4">
        <div class="bg-zinc-800/60 border border-zinc-700 rounded-2xl p-4 text-sm text-zinc-300">
          Kupujesz <strong>tylko tokeny</strong>. Usługi Bazaru, takie jak publikacja ponad limit, przypiecie, wyroznienie i odswiezenie, zuzywaja tokeny z Twojego salda.
        </div>
        <label class="flex items-start gap-3 bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 cursor-pointer">
          <input type="checkbox" id="bazar-token-truth-confirm" class="mt-1" />
          <span class="text-sm text-zinc-300">
            Potwierdzam, ze dane nabywcy w moim profilu sa prawdziwe i moga zostac uzyte do wystawienia dokumentu sprzedazy jako <strong>faktura zwolniona z VAT</strong>.
          </span>
        </label>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${packages.map((pkg) => `
            <button type="button" class="text-left rounded-2xl border border-zinc-700 bg-zinc-800/50 p-4 hover:border-[#C19A6B] transition" data-package-id="${escapeHtml(pkg.id)}">
              <div class="text-lg font-bold text-white">${escapeHtml(pkg.label)}</div>
              <div class="text-sm text-zinc-400 mt-1">${escapeHtml(pkg.tokens)} tokenow</div>
              <div class="text-2xl font-black text-[#C19A6B] mt-3">${formatMoneyCents(pkg.priceCents)} zl</div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', onModalBackdropClose);
  modal.querySelector('#bazar-token-packages-close')?.addEventListener('click', closeTokenPackagesModal);
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const truthConfirmed = modal.querySelector('#bazar-token-truth-confirm')?.checked === true;
      if (!truthConfirmed) {
        alert('Potwierdz prawdziwosc danych nabywcy przed zakupem tokenow.');
        return;
      }
      btn.setAttribute('disabled', 'disabled');
      try {
        const data = await apiPost('/tokens/checkout-session', {
          packageId: btn.getAttribute('data-package-id'),
          truthConfirmed,
        });
        if (data.url) window.location.href = data.url;
      } catch (error) {
        alert(error.message || 'Nie udalo sie rozpocząć zakupu tokenow.');
        btn.removeAttribute('disabled');
      }
    });
  });
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

async function loadBazarProfileUi() {
  if (!isOwnProfile()) return;
  const section = ensureBazarProfileCard();
  if (!section) return;
  try {
    const [summaryData, historyData, purchasesData] = await Promise.all([
      apiGet('/token-summary'),
      apiGet('/token-history'),
      apiGet('/purchases'),
    ]);
    renderSummary(summaryData.summary || {}, summaryData.config || {});
    renderCompanyStatus({
      ...(summaryData.profile || {}),
      privateFreeActiveOffers: summaryData.config?.privateFreeActiveOffers,
    });
    renderHistory(historyData.history || []);
    renderPurchases(purchasesData.purchases || []);
  } catch (error) {
    section.innerHTML = `
      <div class="text-red-300">
        Nie udalo sie zaladowac sekcji Bazar Premium: ${escapeHtml(error.message || 'nieznany blad')}
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
