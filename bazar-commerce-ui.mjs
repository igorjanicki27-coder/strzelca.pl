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

async function apiPost(path, body) {
  const headers = await getAuthHeaders();
  headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
  return data;
}

function ensureTokenChip() {
  let chip = document.getElementById('bazar-token-chip');
  if (chip) return chip;
  const nav = document.querySelector('nav .container')?.parentElement;
  if (!nav) return null;
  chip = document.createElement('button');
  chip.id = 'bazar-token-chip';
  chip.type = 'button';
  chip.className = 'absolute left-14 md:left-20 top-1/2 -translate-y-1/2 border border-[#C19A6B]/40 bg-black/70 text-[#C19A6B] px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide hidden';
  chip.innerHTML = '<i class="fa-solid fa-coins mr-1"></i><span>Ladowanie...</span>';
  chip.addEventListener('click', () => openTokenPackagesModal(window.__bazarTokenPackages || []));
  nav.appendChild(chip);
  return chip;
}

function renderTokenChip(summary) {
  const chip = ensureTokenChip();
  if (!chip) return;
  chip.classList.remove('hidden');
  chip.innerHTML = `<i class="fa-solid fa-coins mr-1"></i><span>${escapeHtml(summary.balance || 0)} tokenow</span>`;
}

function closeTokenPackagesModal() {
  document.getElementById('bazar-token-modal')?.remove();
  document.body.style.overflow = '';
}

function openTokenPackagesModal(packages) {
  closeTokenPackagesModal();
  const modal = document.createElement('div');
  modal.id = 'bazar-token-modal';
  modal.className = 'modal-overlay';
  modal.onclick = (event) => {
    if (event.target === modal) closeTokenPackagesModal();
  };
  modal.innerHTML = `
    <div class="modal-panel max-w-3xl" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between p-4 border-b border-zinc-800">
        <span class="text-sm font-bold text-[#C19A6B] uppercase tracking-widest">Kup tokeny</span>
        <button type="button" class="text-zinc-400 hover:text-white text-xl" id="bazar-token-close"><i class="fa-solid fa-times"></i></button>
      </div>
      <div class="p-4 md:p-6 space-y-4">
        <div class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4 text-sm text-zinc-300">
          Kupujesz <strong>tylko tokeny</strong>. W Bazarze nie kupuje sie bezposrednio uslug premium. Tokeny zuzywasz potem na publikacje ponad limit, przypiecia, wyroznienia i odswiezenia.
        </div>
        <label class="flex items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4 cursor-pointer">
          <input id="bazar-token-truth-confirm" type="checkbox" class="mt-1 accent-[#C19A6B]" />
          <span class="text-sm text-zinc-300">
            Potwierdzam, ze moje dane do dokumentu sprzedazy sa prawdziwe. Dokument zostanie wystawiony jako <strong>faktura zwolniona z VAT</strong>.
          </span>
        </label>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${packages.map((pkg) => `
            <button type="button" class="text-left rounded-2xl border border-zinc-700 bg-zinc-900/50 p-4 hover:border-[#C19A6B] transition" data-package-id="${escapeHtml(pkg.id)}">
              <div class="text-lg font-bold text-white">${escapeHtml(pkg.label)}</div>
              <div class="text-sm text-zinc-500 mt-1">${escapeHtml(pkg.tokens)} tokenow</div>
              <div class="text-2xl font-black text-[#C19A6B] mt-3">${formatMoneyCents(pkg.priceCents)} zl</div>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  modal.querySelector('#bazar-token-close')?.addEventListener('click', closeTokenPackagesModal);
  modal.querySelectorAll('[data-package-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const truthConfirmed = modal.querySelector('#bazar-token-truth-confirm')?.checked === true;
      if (!truthConfirmed) {
        alert('Potwierdz prawdziwosc danych przed zakupem tokenow.');
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
        alert(error.message || 'Nie udalo sie rozpocząć zakupu.');
        btn.removeAttribute('disabled');
      }
    });
  });
}

async function openPremiumAction(offerId, action, question) {
  if (!confirm(question)) return;
  try {
    await apiPost(`/promote/${encodeURIComponent(offerId)}`, { action });
    alert('Akcja wykonana pomyslnie.');
    await loadTokenSummary();
    await window.showMyOffers();
    if (typeof window.loadAllOffers === 'function' && typeof window.renderCarousels === 'function') {
      window.loadAllOffers().then(() => window.renderCarousels()).catch(() => null);
    }
  } catch (error) {
    alert(error.message || 'Nie udalo sie wykonac akcji premium.');
  }
}

async function showMyOffersEnhanced() {
  const auth = window.strzelcaFirebaseAuth;
  if (!auth?.currentUser) return;
  const modal = document.getElementById('my-offers-modal');
  modal.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)window.closeMyOffers()">
    <div class="modal-panel">
      <div class="flex items-center justify-between p-4 border-b border-zinc-800">
        <span class="text-sm font-bold text-[#C19A6B] uppercase tracking-widest">Moje oferty i tokeny</span>
        <button onclick="window.closeMyOffers()" class="text-zinc-400 hover:text-white text-xl"><i class="fa-solid fa-times"></i></button>
      </div>
      <div class="p-4" id="my-offers-content"><div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-2xl text-zinc-400"></i></div></div>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const [offersData, tokenSummary] = await Promise.all([apiGet('/my'), apiGet('/token-summary')]);
    const container = document.getElementById('my-offers-content');
    const offers = Array.isArray(offersData.offers) ? offersData.offers : [];
    const summary = tokenSummary.summary || {};
    if (!offers.length) {
      container.innerHTML = `
        <div class="rounded-2xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-4 mb-4">
          <div class="text-sm text-zinc-300">Saldo tokenow: <strong class="text-white">${summary.balance || 0}</strong></div>
        </div>
        <div class="text-center py-8 text-zinc-500"><i class="fa-solid fa-box-open text-3xl mb-3"></i><p>Nie masz jeszcze zadnych ofert.</p></div>
      `;
      return;
    }
    const statusLabels = { PENDING: 'Oczekujaca', ACTIVE: 'Aktywna', REJECTED: 'Odrzucona', EXPIRED: 'Wygasla', SOLD: 'Sprzedana' };
    const statusColors = { PENDING: 'text-yellow-400', ACTIVE: 'text-green-400', REJECTED: 'text-red-400', EXPIRED: 'text-zinc-500', SOLD: 'text-blue-400' };
    container.innerHTML = `
      <div class="rounded-2xl border border-[#C19A6B]/30 bg-[#C19A6B]/10 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div class="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Saldo tokenow</div>
          <div class="text-2xl font-black text-white">${summary.balance || 0}</div>
        </div>
        <button type="button" id="my-offers-buy-tokens" class="bg-[#C19A6B] text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-white transition">
          <i class="fa-solid fa-coins mr-1"></i>Dokup tokeny
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
                  ${o.is_pinned ? '<span class="text-[10px] px-2 py-0.5 rounded bg-[#C19A6B] text-black font-bold">Przypieta</span>' : ''}
                  ${o.is_highlighted ? '<span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">Wyrozniona</span>' : ''}
                </div>
                ${o.rejection_reason ? `<p class="text-xs text-red-400 mt-1">Powod: ${escapeHtml(o.rejection_reason)}</p>` : ''}
                <p class="text-xs text-zinc-500 mt-1">Ostatnie odswiezenie: ${escapeHtml(formatTs(o.last_refreshed_at))}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              ${(o.status === 'ACTIVE' || o.status === 'EXPIRED') ? `<button type="button" class="text-xs bg-green-700 text-white px-3 py-1 rounded hover:bg-green-600 transition" data-action="refresh" data-id="${escapeHtml(o.id)}">Odswiez</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button type="button" class="text-xs border border-[#C19A6B]/40 text-[#C19A6B] px-3 py-1 rounded hover:bg-[#C19A6B]/10 transition" data-action="highlight" data-id="${escapeHtml(o.id)}">Wyroznij</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button type="button" class="text-xs border border-sky-500/40 text-sky-300 px-3 py-1 rounded hover:bg-sky-500/10 transition" data-action="pin" data-id="${escapeHtml(o.id)}">Przypnij</button>` : ''}
              ${o.status === 'ACTIVE' ? `<button onclick="window.markSold('${escapeHtml(o.id)}')" class="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-500 transition">Sprzedane</button>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    `;
    container.querySelector('#my-offers-buy-tokens')?.addEventListener('click', () => openTokenPackagesModal(window.__bazarTokenPackages || []));
    container.querySelectorAll('[data-action]').forEach((btn) => {
      const offerId = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const label =
        action === 'refresh'
          ? 'Zuzyc 1 token na odswiezenie oferty?'
          : action === 'highlight'
            ? 'Zuzyc 1 token na wyroznienie oferty?'
            : 'Zuzyc 1 token na przypiecie oferty?';
      btn.addEventListener('click', () => openPremiumAction(offerId, action, label));
    });
  } catch (error) {
    document.getElementById('my-offers-content').innerHTML = `<p class="text-red-400 text-center py-4">${escapeHtml(error.message || 'Blad ladowania ofert')}</p>`;
  }
}

async function loadTokenSummary() {
  try {
    const data = await apiGet('/token-summary');
    window.__bazarTokenPackages = data.config?.packages || [];
    renderTokenChip(data.summary || {});
    return data;
  } catch (error) {
    console.warn('Bazar token summary load failed:', error);
    return null;
  }
}

function installUserMenuShortcut() {
  const menu = document.getElementById('user-menu')?.querySelector('.space-y-2');
  if (!menu || document.getElementById('bazar-user-menu-tokens')) return;
  const btn = document.createElement('button');
  btn.id = 'bazar-user-menu-tokens';
  btn.type = 'button';
  btn.className = 'block w-full text-left text-zinc-300 hover:text-[#C19A6B] transition text-sm';
  btn.innerHTML = '<i class="fa-solid fa-coins mr-2"></i>Tokeny Bazaru';
  btn.addEventListener('click', () => openTokenPackagesModal(window.__bazarTokenPackages || []));
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
        const mod = await import('https://strzelca.pl/regulamin-txt-render.mjs?v=2026-03-22-4');
        html = mod.renderRegulaminTxtToHtml(raw, { includeFooter: true });
      } catch (_) {
        html = `<pre class="whitespace-pre-wrap text-sm text-zinc-300">${escapeHtml(raw)}</pre>`;
      }
    } else {
      html = `<p class="text-zinc-400">Nie udalo sie zaladowac Regulaminu Bazaru.</p>`;
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
            <strong class="text-zinc-100">Najwazniejsze zasady:</strong><br>
            Bazar jest platforma ogloszeniowa, nie posredniczy w platnosciach za bron i amunicje. Kupujesz tylko tokeny do uslug premium operatora. Operator moze moderowac, ukrywac i usuwac ogloszenia naruszajace regulamin lub prawo.
          </div>
          ${html}
          <div class="mt-6">
            <a href="${txtUrl}" target="_blank" rel="noopener noreferrer" class="text-[#C19A6B] hover:underline text-sm">Otworz pelny Regulamin Bazaru w osobnej karcie</a>
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
    alert(error.message || 'Nie udalo sie otworzyc zasad Bazaru.');
  }
}

function installRulesShortcut() {
  if (document.getElementById('bazar-rules-shortcut')) return;
  const filterBar = document.querySelector('.filter-bar .flex.flex-wrap.items-center.gap-3.mb-3');
  if (!filterBar) return;
  const btn = document.createElement('button');
  btn.id = 'bazar-rules-shortcut';
  btn.type = 'button';
  btn.className = 'text-zinc-400 hover:text-[#C19A6B] transition text-sm px-3 py-2 border border-zinc-700 rounded-lg';
  btn.innerHTML = '<i class="fa-solid fa-scale-balanced mr-1"></i>Zasady Bazaru';
  btn.addEventListener('click', openBazarRulesModal);
  filterBar.appendChild(btn);
  window.openRegulationModal = openBazarRulesModal;
}

function installHookOverrides() {
  window.showMyOffers = showMyOffersEnhanced;
}

window.addEventListener('load', () => {
  installHookOverrides();
  const tryInit = async () => {
    if (!window.strzelcaFirebaseAuth?.currentUser) return false;
    await loadTokenSummary();
    installUserMenuShortcut();
    return true;
  };
  tryInit().catch(() => null);
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (window.strzelcaFirebaseAuth?.currentUser) {
      clearInterval(timer);
      loadTokenSummary().then(installUserMenuShortcut).catch(() => null);
      installRulesShortcut();
    } else if (attempts > 15) {
      clearInterval(timer);
    }
  }, 700);
  installRulesShortcut();
});
