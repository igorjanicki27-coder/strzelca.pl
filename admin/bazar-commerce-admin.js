(function () {
  if (typeof window === 'undefined') return;

  const adminVoucherState = {
    promoCodes: [],
    promoClaims: [],
  };

  function countVoucherRedemptions(claims) {
    return (Array.isArray(claims) ? claims : []).reduce((sum, claim) => {
      if (Array.isArray(claim?.redemptions) && claim.redemptions.length) return sum + claim.redemptions.length;
      return sum + Number(claim?.count || 0);
    }, 0);
  }

  function updateVoucherSummary() {
    const codes = Array.isArray(adminVoucherState.promoCodes) ? adminVoucherState.promoCodes : [];
    const claims = Array.isArray(adminVoucherState.promoClaims) ? adminVoucherState.promoClaims : [];
    const activeCount = codes.filter((item) => item?.active !== false).length;
    const inactiveCount = codes.filter((item) => item?.active === false).length;
    const claimCount = countVoucherRedemptions(claims);
    const uniqueUsers = new Set(
      claims
        .map((claim) => String(claim?.userId || '').trim())
        .filter(Boolean)
    ).size;
    const activeEl = document.getElementById('bazar-promo-count-active');
    const inactiveEl = document.getElementById('bazar-promo-count-inactive');
    const claimsEl = document.getElementById('bazar-promo-count-claims');
    const usersEl = document.getElementById('bazar-promo-count-users');
    if (activeEl) activeEl.textContent = String(activeCount);
    if (inactiveEl) inactiveEl.textContent = String(inactiveCount);
    if (claimsEl) claimsEl.textContent = String(claimCount);
    if (usersEl) usersEl.textContent = String(uniqueUsers);
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const sec = value?._seconds ?? value?.seconds;
    const date = sec != null ? new Date(sec * 1000) : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('pl-PL');
  }

  function fmtMoneyCents(cents) {
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

  async function authHeaders(json = false) {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    const token = await window.auth?.currentUser?.getIdToken?.(true);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function apiGet(path) {
    const headers = await authHeaders(false);
    const res = await fetch(`${window.BAZAR_API}${path}`, { headers, credentials: 'include' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
    return data;
  }

  async function apiJson(path, method, body) {
    const headers = await authHeaders(true);
    const res = await fetch(`${window.BAZAR_API}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Błąd API (${res.status})`);
    return data;
  }

  function ensureBazarBackofficeUi() {
    const tab = document.getElementById('tab-promo-codes');
    if (!tab || document.getElementById('bazar-commerce-admin-root')) return;
    const root = document.createElement('div');
    root.id = 'bazar-commerce-admin-root';
    root.className = 'space-y-8 mt-8';
    root.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Cennik i żetony</h2>
            <button type="button" id="bazar-commerce-config-save" class="btn-admin">Zapisz</button>
          </div>
          <div id="bazar-commerce-config" class="space-y-4 text-sm text-zinc-300"></div>
        </section>
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Firmy do weryfikacji</h2>
          </div>
          <div id="bazar-company-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Zgłoszenia ogłoszeń</h2>
          </div>
          <div id="bazar-reports-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Płatności i kolejka błędów</h2>
          </div>
          <div id="bazar-purchases-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Webhooki Stripe</h2>
          </div>
          <div id="bazar-webhooks-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Ręczne akcje</h2>
          </div>
          <div class="space-y-4 text-sm text-zinc-300">
            <div class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4 space-y-3">
              <div class="text-xs uppercase tracking-widest text-zinc-500">Manualne przyznanie żetonów</div>
              <input id="bazar-manual-user-id" class="w-full" placeholder="UID użytkownika" />
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input id="bazar-manual-tokens" class="w-full" type="number" min="1" value="1" placeholder="Liczba żetonów" />
                <input id="bazar-manual-validity" class="w-full" type="number" min="1" value="365" placeholder="Ważność (dni)" />
              </div>
              <input id="bazar-manual-package-label" class="w-full" placeholder="Etykieta, np. Rekompensata supportowa" />
              <textarea id="bazar-manual-note" class="w-full" rows="4" placeholder="Notatka do historii żetonów"></textarea>
              <button type="button" id="bazar-manual-grant-btn" class="btn-admin">Przyznaj żetony</button>
            </div>
          </div>
        </section>
      </div>
      <section class="admin-card">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold coyote-text">Żetony / Vouchery / Kody</h2>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div class="rounded-2xl border border-zinc-700 bg-zinc-950/35 px-4 py-3">
            <div class="text-[11px] uppercase tracking-widest text-zinc-500">Aktywne vouchery</div>
            <div id="bazar-promo-count-active" class="text-2xl font-semibold text-white mt-1">0</div>
          </div>
          <div class="rounded-2xl border border-zinc-700 bg-zinc-950/35 px-4 py-3">
            <div class="text-[11px] uppercase tracking-widest text-zinc-500">Wyłączone</div>
            <div id="bazar-promo-count-inactive" class="text-2xl font-semibold text-white mt-1">0</div>
          </div>
          <div class="rounded-2xl border border-zinc-700 bg-zinc-950/35 px-4 py-3">
            <div class="text-[11px] uppercase tracking-widest text-zinc-500">Łączne użycia</div>
            <div id="bazar-promo-count-claims" class="text-2xl font-semibold text-white mt-1">0</div>
          </div>
          <div class="rounded-2xl border border-zinc-700 bg-zinc-950/35 px-4 py-3">
            <div class="text-[11px] uppercase tracking-widest text-zinc-500">Użytkownicy</div>
            <div id="bazar-promo-count-users" class="text-2xl font-semibold text-white mt-1">0</div>
          </div>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-[0.84fr,1.16fr] gap-5">
          <section class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4 lg:p-5 space-y-4">
            <div>
              <div class="text-xs uppercase tracking-widest text-zinc-500 mb-2">Nowy voucher żetonów</div>
              <p class="text-sm text-zinc-500">Tutaj tworzysz wyłącznie kody na darmowe żetony. Zniżki do sklepu zostają w standardowej sekcji kodów powyżej.</p>
            </div>
            <label class="block">
              <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Kod</span>
              <input id="bazar-promo-code" class="w-full" maxlength="64" placeholder="BAZAR-START" />
            </label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Żetony gratis</span>
                <input id="bazar-promo-grant" class="w-full" type="number" min="1" value="1" />
              </label>
              <label class="block">
                <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Łączny limit użyć</span>
                <input id="bazar-promo-max-total" class="w-full" type="number" min="0" value="0" placeholder="0 = bez limitu" />
              </label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Max na użytkownika</span>
                <input id="bazar-promo-max-user" class="w-full" type="number" min="1" value="1" />
              </label>
              <label class="block">
                <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Aktywny od</span>
                <input id="bazar-promo-starts-at" class="w-full" type="datetime-local" />
              </label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Wygasa</span>
                <input id="bazar-promo-expires-at" class="w-full" type="datetime-local" />
              </label>
              <label class="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/40 px-4 py-3 mt-6">
                <input id="bazar-promo-active" type="checkbox" checked />
                <span class="text-sm text-zinc-300">Kod aktywny od razu</span>
              </label>
            </div>
            <label class="block">
              <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Notatka</span>
              <textarea id="bazar-promo-note" class="w-full" rows="3" placeholder="Opis kampanii, źródło lub uwagi dla zespołu."></textarea>
            </label>
            <button type="button" id="bazar-promo-save-btn" class="btn-admin">Zapisz kod</button>
          </section>
          <section class="space-y-4 min-w-0">
            <section class="rounded-2xl border border-zinc-700 bg-zinc-900/30 p-4 space-y-3">
              <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <div class="text-xs uppercase tracking-widest text-zinc-500">Lista voucherów</div>
                  <div class="text-sm text-zinc-400 mt-1">Kody dodające żetony do konta po wpisaniu przez użytkownika.</div>
                </div>
                <div class="flex flex-col sm:flex-row gap-3 lg:items-center">
                  <input id="bazar-promo-filter" class="w-full sm:w-72" placeholder="Filtruj vouchery po kodzie lub notatce" />
                  <button type="button" id="bazar-promo-refresh-btn" class="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-200 hover:border-[#C19A6B] hover:text-white transition">Odśwież</button>
                </div>
              </div>
              <div id="bazar-promo-list" class="grid grid-cols-1 2xl:grid-cols-2 gap-3 text-sm text-zinc-300"></div>
            </section>
            <section class="rounded-2xl border border-zinc-700 bg-zinc-900/30 p-4 space-y-3">
              <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <div class="text-xs uppercase tracking-widest text-zinc-500">Historia użycia voucherów</div>
                  <div class="text-sm text-zinc-400 mt-1">Filtruj po kodzie, użytkowniku, e-mailu albo UID.</div>
                </div>
                <input id="bazar-promo-claims-filter" class="w-full lg:w-80" placeholder="Filtruj po kodzie, użytkowniku lub e-mailu" />
              </div>
              <div id="bazar-promo-claims-list" class="grid grid-cols-1 2xl:grid-cols-2 gap-3 text-sm text-zinc-300"></div>
            </section>
          </section>
        </div>
      </section>
    `;
    tab.appendChild(root);
  }

  function renderConfig(config) {
    const el = document.getElementById('bazar-commerce-config');
    if (!el) return;
    const tokenPricing = config.tokenPricing || {};
    const actions = config.actions || {};
    el.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Cena 1 żetonu (gr)</span>
          <input type="number" id="bazar-cfg-token-price" class="w-full" min="0" value="${esc(tokenPricing.tokenPriceCents || 0)}" />
        </label>
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Max liczba żetonów na raz</span>
          <input type="number" id="bazar-cfg-max-quantity" class="w-full" min="1" max="10000" value="${esc(tokenPricing.maxPurchaseQuantity || 10000)}" />
        </label>
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Darmowe aktywne oferty prywatne</span>
          <input type="number" id="bazar-cfg-free-limit" class="w-full" value="${esc(config.privateFreeActiveOffers || 5)}" />
        </label>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Darmowe odświeżenie prywatne po dniach</span>
          <input type="number" id="bazar-cfg-free-refresh" class="w-full" value="${esc(config.privateFreeRefreshDays || 25)}" />
        </label>
        <div class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4 text-xs text-zinc-400">
          <div class="uppercase tracking-widest text-zinc-500 mb-2">Automatyczne pakiety</div>
          <div>Presety zakupu: <strong class="text-zinc-100">10, 50, 100, 1000</strong></div>
          <div class="mt-2">Zniżki: <strong class="text-zinc-100">50-99: 2%</strong>, <strong class="text-zinc-100">100-999: 5%</strong>, <strong class="text-zinc-100">1000-9999: 10%</strong>, <strong class="text-zinc-100">10000: 15%</strong>.</div>
        </div>
      </div>
      <div class="border border-zinc-700 rounded-2xl p-4">
        <div class="text-xs uppercase tracking-widest text-zinc-500 mb-3">Akcje zużywające żetony</div>
        <div class="space-y-3">
          ${Object.entries(actions).map(([key, action]) => `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3" data-action-row="${esc(key)}">
              <input class="w-full md:col-span-2" data-field="label" value="${esc(action.label)}" />
              <input class="w-full" type="number" data-field="tokenCost" value="${esc(action.tokenCost)}" />
              <input class="w-full" type="number" data-field="durationDays" value="${esc(action.durationDays || 7)}" />
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.getElementById('bazar-commerce-config-save')?.addEventListener('click', saveConfig, { once: true });
  }

  async function saveConfig() {
    const actions = {};
    document.querySelectorAll('[data-action-row]').forEach((row) => {
      const key = row.getAttribute('data-action-row');
      actions[key] = {
        label: row.querySelector('[data-field="label"]')?.value || '',
        tokenCost: Number(row.querySelector('[data-field="tokenCost"]')?.value || 1),
        durationDays: Number(row.querySelector('[data-field="durationDays"]')?.value || 7),
        active: true,
      };
    });
    try {
      await apiJson('/admin/config', 'PUT', {
        privateFreeActiveOffers: Number(document.getElementById('bazar-cfg-free-limit')?.value || 5),
        privateFreeRefreshDays: Number(document.getElementById('bazar-cfg-free-refresh')?.value || 25),
        tokenPricing: {
          tokenPriceCents: Number(document.getElementById('bazar-cfg-token-price')?.value || 0),
          presetQuantities: [10, 50, 100, 1000],
          maxPurchaseQuantity: Number(document.getElementById('bazar-cfg-max-quantity')?.value || 10000),
        },
        actions,
      });
      window.showNotification?.('Konfiguracja Bazaru została zapisana.', 'success');
      await loadBazarCommerceAdmin();
    } catch (error) {
      window.showNotification?.(error.message || 'Nie udało się zapisać konfiguracji.', 'error');
    }
  }

  function renderCompanies(companies) {
    const el = document.getElementById('bazar-company-queue');
    if (!el) return;
    if (!companies.length) {
      el.innerHTML = '<div class="text-zinc-500">Brak kont firmowych do obsługi.</div>';
      return;
    }
    el.innerHTML = companies.map((item) => `
      <article class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${esc(item.companyName || item.displayName || 'Firma')}</div>
            <div class="text-xs text-zinc-500 mt-1">${esc(item.email || '—')} • NIP: ${esc(item.nip || '—')}</div>
            <div class="text-xs text-zinc-500 mt-1">Status: ${esc(item.companyVerificationStatus || 'pending')}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="text-xs bg-green-700 text-white px-3 py-1 rounded hover:bg-green-600 transition" data-company-action="verified" data-company-id="${esc(item.id)}">Zweryfikuj</button>
            <button type="button" class="text-xs bg-red-800 text-white px-3 py-1 rounded hover:bg-red-700 transition" data-company-action="rejected" data-company-id="${esc(item.id)}">Odrzuć</button>
          </div>
        </div>
      </article>
    `).join('');
    el.querySelectorAll('[data-company-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const status = btn.getAttribute('data-company-action');
        const userId = btn.getAttribute('data-company-id');
        const reason = status === 'rejected' ? window.prompt('Podaj powód odrzucenia weryfikacji firmy:', '') || '' : '';
        try {
          await apiJson(`/admin/company-status/${encodeURIComponent(userId)}`, 'POST', { status, reason });
          window.showNotification?.('Status firmy został zaktualizowany.', 'success');
          await loadBazarCommerceAdmin();
        } catch (error) {
          window.showNotification?.(error.message || 'Nie udało się zaktualizować statusu firmy.', 'error');
        }
      });
    });
  }

  function renderReports(reports) {
    const el = document.getElementById('bazar-reports-queue');
    if (!el) return;
    if (!reports.length) {
      el.innerHTML = '<div class="text-zinc-500">Brak otwartych zgłoszeń.</div>';
      return;
    }
    el.innerHTML = reports.map((item) => `
      <article class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${esc(item.offerTitle || item.offerId || 'Zgłoszenie')}</div>
            <div class="text-xs text-zinc-500 mt-1">${esc(item.reason || '—')} • ${esc(fmtDateTime(item.createdAt))}</div>
            ${item.details ? `<div class="text-sm text-zinc-300 mt-2">${esc(item.details)}</div>` : ''}
          </div>
          <button type="button" class="text-xs border border-zinc-600 text-zinc-200 px-3 py-1 rounded hover:bg-zinc-800" data-report-id="${esc(item.id)}">Zamknij</button>
        </div>
      </article>
    `).join('');
    el.querySelectorAll('[data-report-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiJson(`/admin/report-status/${encodeURIComponent(btn.getAttribute('data-report-id'))}`, 'POST', {
            status: 'closed',
            note: 'Zamknięte w panelu Bazaru',
          });
          window.showNotification?.('Zgłoszenie zostało zamknięte.', 'success');
          await loadBazarCommerceAdmin();
        } catch (error) {
          window.showNotification?.(error.message || 'Nie udało się zamknąć zgłoszenia.', 'error');
        }
      });
    });
  }

  function renderPurchases(purchases) {
    const el = document.getElementById('bazar-purchases-queue');
    if (!el) return;
    if (!purchases.length) {
      el.innerHTML = '<div class="text-zinc-500">Brak płatności do wyświetlenia.</div>';
      return;
    }
    el.innerHTML = purchases.map((item) => `
      <article class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${esc(item.packageLabel || 'Pakiet żetonów')}</div>
            <div class="text-xs text-zinc-500 mt-1">${esc(fmtDateTime(item.createdAt))} • ${fmtMoneyCents(item.amountCents)} zł • ${esc(item.tokens || 0)} ${pluralizeŻetony(item.tokens || 0)}</div>
            <div class="text-xs text-zinc-500 mt-1">Status: ${esc(item.processingStatus || item.status || 'pending')}</div>
            ${item.lastError ? `<div class="text-xs text-red-300 mt-2">${esc(item.lastError)}</div>` : ''}
          </div>
          <div class="flex flex-wrap gap-2">
            ${item.processingStatus === 'error' ? `<button type="button" class="text-xs bg-amber-700 text-white px-3 py-1 rounded hover:bg-amber-600 transition" data-retry-purchase="${esc(item.id)}">Ponów przetworzenie</button>` : ''}
            ${item.invoiceId ? `<a href="/api/bazar-invoice-download?invoiceId=${encodeURIComponent(item.invoiceId)}" target="_blank" class="text-xs border border-zinc-600 text-zinc-200 px-3 py-1 rounded hover:bg-zinc-800">Dokument</a>` : ''}
          </div>
        </div>
      </article>
    `).join('');
    el.querySelectorAll('[data-retry-purchase]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiJson(`/admin/retry-purchase/${encodeURIComponent(btn.getAttribute('data-retry-purchase'))}`, 'POST', {});
          window.showNotification?.('Zakup został ponownie przetworzony.', 'success');
          await loadBazarCommerceAdmin();
        } catch (error) {
          window.showNotification?.(error.message || 'Nie udało się ponowić przetwarzania.', 'error');
        }
      });
    });
  }

  function renderWebhooks(webhooks) {
    const el = document.getElementById('bazar-webhooks-queue');
    if (!el) return;
    if (!webhooks.length) {
      el.innerHTML = '<div class="text-zinc-500">Brak zarejestrowanych webhooków.</div>';
      return;
    }
    el.innerHTML = webhooks.map((item) => `
      <article class="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="font-semibold text-white">${esc(item.type || item.eventId || 'Webhook Stripe')}</div>
            <div class="text-xs text-zinc-500 mt-1">${esc(fmtDateTime(item.createdAt))} • purchaseId: ${esc(item.purchaseId || '—')}</div>
            <div class="text-xs text-zinc-500 mt-1">Status: ${esc(item.status || 'received')}</div>
            ${item.message ? `<div class="text-xs text-zinc-300 mt-2">${esc(item.message)}</div>` : ''}
          </div>
          <div class="text-[11px] text-zinc-500 uppercase tracking-widest">${esc(item.eventId || item.id)}</div>
        </div>
      </article>
    `).join('');
  }

  function renderPromoCodes(promoCodes) {
    adminVoucherState.promoCodes = Array.isArray(promoCodes) ? promoCodes.slice() : [];
    updateVoucherSummary();
    const el = document.getElementById('bazar-promo-list');
    if (!el) return;
    const filterValue = String(document.getElementById('bazar-promo-filter')?.value || '').trim().toLowerCase();
    const rows = adminVoucherState.promoCodes.filter((item) => {
      if (!filterValue) return true;
      return [item.code, item.note]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(filterValue));
    });
    if (!rows.length) {
      el.innerHTML = '<div class="text-zinc-500 rounded-2xl border border-dashed border-zinc-700 px-4 py-6">Brak zapisanych kodów promocyjnych.</div>';
      return;
    }
    el.innerHTML = rows.map((item) => {
      const detail = `${esc(item.grantTokens || 0)} ${pluralizeŻetony(item.grantTokens || 0)}`;
      const usage = item.maxTotalUses > 0
        ? `${esc(item.usageCount || 0)} / ${esc(item.maxTotalUses)} użyć`
        : `${esc(item.usageCount || 0)} użyć`;
      return `
        <article class="rounded-2xl border border-zinc-700 bg-zinc-950/35 p-4">
          <div class="flex flex-col gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <div class="font-semibold text-white">${esc(item.code || 'KOD')}</div>
                <span class="px-2 py-1 rounded-full text-[11px] font-bold ${item.active !== false ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'bg-zinc-500/10 border border-zinc-500/30 text-zinc-400'}">
                  ${item.active !== false ? 'Aktywny' : 'Wyłączony'}
                </span>
                <span class="px-2 py-1 rounded-full text-[11px] font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300">
                  Voucher żetonów
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                  <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Wartość</div>
                  <div class="text-sm text-zinc-200">${detail}</div>
                </div>
                <div class="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                  <div class="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Użycia</div>
                  <div class="text-sm text-zinc-200">${usage}</div>
                </div>
              </div>
              <div class="text-xs text-zinc-500 mt-2">Max na użytkownika: ${esc(item.maxUsesPerUser || 1)} • Od: ${esc(fmtDateTime(item.startsAt))} • Do: ${esc(fmtDateTime(item.expiresAt))}</div>
              ${item.note ? `<div class="text-xs text-zinc-400 mt-2">${esc(item.note)}</div>` : ''}
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="px-3 py-2 rounded-lg border text-xs ${item.active !== false ? 'border-red-500/30 text-red-300 hover:bg-red-500/10' : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'} transition" data-promo-code="${esc(item.code)}" data-promo-next="${item.active !== false ? 'false' : 'true'}">
                ${item.active !== false ? 'Wyłącz' : 'Włącz'}
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
    el.querySelectorAll('[data-promo-code]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await apiJson(`/admin/promo-code-status/${encodeURIComponent(btn.getAttribute('data-promo-code'))}`, 'POST', {
            active: btn.getAttribute('data-promo-next') === 'true',
          });
          window.showNotification?.('Status kodu został zaktualizowany.', 'success');
          await loadBazarCommerceAdmin();
        } catch (error) {
          window.showNotification?.(error.message || 'Nie udało się zaktualizować kodu.', 'error');
        }
      });
    });
  }

  function renderPromoClaims(claims) {
    adminVoucherState.promoClaims = Array.isArray(claims) ? claims.slice() : [];
    updateVoucherSummary();
    const el = document.getElementById('bazar-promo-claims-list');
    if (!el) return;
    const filterValue = String(document.getElementById('bazar-promo-claims-filter')?.value || '').trim().toLowerCase();
    const rows = adminVoucherState.promoClaims.filter((claim) => {
      if (!filterValue) return true;
      return [claim.code, claim.userDisplayName, claim.userEmail, claim.userId]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(filterValue));
    });
    if (!rows.length) {
      el.innerHTML = '<div class="text-zinc-500 rounded-2xl border border-dashed border-zinc-700 px-4 py-6">Brak użytych voucherów.</div>';
      return;
    }
    el.innerHTML = rows.map((claim) => `
      <article class="rounded-2xl border border-zinc-700 bg-zinc-950/35 p-4">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <div class="font-semibold text-white">${esc(claim.code || 'KOD')}</div>
            <span class="text-xs text-zinc-500">${esc(claim.count || 0)} użyć</span>
          </div>
          <div class="text-sm text-zinc-300">${esc(claim.userDisplayName || 'Użytkownik')} ${claim.userEmail ? `• ${esc(claim.userEmail)}` : ''}</div>
          ${claim.userId ? `<div class="text-[11px] uppercase tracking-widest text-zinc-600">UID: ${esc(claim.userId)}</div>` : ''}
          ${Array.isArray(claim.redemptions) && claim.redemptions.length ? claim.redemptions.map((row) => `
            <div class="text-xs text-zinc-500 border-t border-zinc-800 pt-2">
              ${esc(fmtDateTime(row.usedAt || row.redeemedAt || claim.updatedAt))} • ${row.grantTokens ? `${esc(row.grantTokens)} ${pluralizeŻetony(row.grantTokens)}` : esc(row.kind || 'użycie')}
              ${row.purchaseId ? ` • purchaseId: ${esc(row.purchaseId)}` : ''}
            </div>
          `).join('') : `<div class="text-xs text-zinc-500">Ostatnia aktywność: ${esc(fmtDateTime(claim.updatedAt))}</div>`}
        </div>
      </article>
    `).join('');
  }

  function bindManualGrant() {
    const btn = document.getElementById('bazar-manual-grant-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const userId = document.getElementById('bazar-manual-user-id')?.value?.trim() || '';
      const tokens = Number(document.getElementById('bazar-manual-tokens')?.value || 0);
      const validityDays = Number(document.getElementById('bazar-manual-validity')?.value || 365);
      const packageLabel = document.getElementById('bazar-manual-package-label')?.value?.trim() || '';
      const note = document.getElementById('bazar-manual-note')?.value?.trim() || '';
      if (!userId || tokens <= 0) {
        window.showNotification?.('Podaj UID i liczbę żetonów.', 'error');
        return;
      }
      try {
        await apiJson('/admin/grant-tokens', 'POST', {
          userId,
          tokens,
          validityDays,
          packageLabel,
          note,
        });
        window.showNotification?.('Żetony zostały przyznane.', 'success');
        document.getElementById('bazar-manual-note').value = '';
        await loadBazarCommerceAdmin();
      } catch (error) {
        window.showNotification?.(error.message || 'Nie udało się przyznać żetonów.', 'error');
      }
    });
  }

  function bindPromoCodes() {
    const saveBtn = document.getElementById('bazar-promo-save-btn');
    const refreshBtn = document.getElementById('bazar-promo-refresh-btn');
    const filterInput = document.getElementById('bazar-promo-filter');
    const claimsFilterInput = document.getElementById('bazar-promo-claims-filter');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => loadBazarCommerceAdmin());
    }
    if (filterInput && !filterInput.dataset.bound) {
      filterInput.dataset.bound = '1';
      filterInput.addEventListener('input', () => renderPromoCodes(adminVoucherState.promoCodes));
    }
    if (claimsFilterInput && !claimsFilterInput.dataset.bound) {
      claimsFilterInput.dataset.bound = '1';
      claimsFilterInput.addEventListener('input', () => renderPromoClaims(adminVoucherState.promoClaims));
    }
    if (!saveBtn || saveBtn.dataset.bound) return;
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', async () => {
      const payload = {
        code: (document.getElementById('bazar-promo-code')?.value || '').trim().toUpperCase(),
        kind: 'grant',
        discountPercent: 0,
        grantTokens: Number(document.getElementById('bazar-promo-grant')?.value || 0),
        maxTotalUses: Number(document.getElementById('bazar-promo-max-total')?.value || 0),
        maxUsesPerUser: Number(document.getElementById('bazar-promo-max-user')?.value || 1),
        startsAt: document.getElementById('bazar-promo-starts-at')?.value || '',
        expiresAt: document.getElementById('bazar-promo-expires-at')?.value || '',
        note: document.getElementById('bazar-promo-note')?.value || '',
        active: document.getElementById('bazar-promo-active')?.checked === true,
      };
      if (!payload.code) {
        window.showNotification?.('Podaj kod promocyjny.', 'error');
        return;
      }
      try {
        await apiJson('/admin/promo-codes', 'POST', payload);
        window.showNotification?.('Kod promocyjny został zapisany.', 'success');
        document.getElementById('bazar-promo-code').value = '';
        document.getElementById('bazar-promo-note').value = '';
        document.getElementById('bazar-promo-starts-at').value = '';
        document.getElementById('bazar-promo-expires-at').value = '';
        await loadBazarCommerceAdmin();
      } catch (error) {
        window.showNotification?.(error.message || 'Nie udało się zapisać kodu.', 'error');
      }
    });
  }

  async function loadBazarCommerceAdmin() {
    ensureBazarBackofficeUi();
    try {
      const [configData, companiesData, reportsData, purchasesData, webhooksData, promoCodesData, promoClaimsData] = await Promise.all([
        apiGet('/admin/config'),
        apiGet('/admin/companies'),
        apiGet('/admin/reports'),
        apiGet('/admin/purchases'),
        apiGet('/admin/webhooks'),
        apiGet('/admin/promo-codes'),
        apiGet('/admin/promo-code-claims'),
      ]);
      renderConfig(configData.config || {});
      renderCompanies(companiesData.companies || []);
      renderReports((reportsData.reports || []).filter((item) => item.status !== 'closed'));
      renderPurchases(purchasesData.purchases || []);
      renderWebhooks(webhooksData.webhooks || []);
      renderPromoCodes(promoCodesData.promoCodes || []);
      renderPromoClaims(promoClaimsData.claims || []);
      bindManualGrant();
      bindPromoCodes();
    } catch (error) {
      console.error('loadBazarCommerceAdmin:', error);
    }
  }

  const originalLoadPromoCodes = window.loadPromoCodes;
  window.loadPromoCodes = async function patchedLoadPromoCodes() {
    if (typeof originalLoadPromoCodes === 'function') {
      await originalLoadPromoCodes();
    }
    await loadBazarCommerceAdmin();
  };
})();
