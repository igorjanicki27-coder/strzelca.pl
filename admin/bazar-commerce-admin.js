(function () {
  if (typeof window === 'undefined') return;

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
    const tab = document.getElementById('tab-bazar');
    if (!tab || document.getElementById('bazar-commerce-admin-root')) return;
    const root = document.createElement('div');
    root.id = 'bazar-commerce-admin-root';
    root.className = 'space-y-8 mt-8';
    root.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Cennik i tokeny</h2>
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
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Zgloszenia ogloszen</h2>
          </div>
          <div id="bazar-reports-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
        <section class="admin-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold coyote-text">Platnosci i kolejka bledow</h2>
          </div>
          <div id="bazar-purchases-queue" class="space-y-3 text-sm text-zinc-300"></div>
        </section>
      </div>
    `;
    tab.appendChild(root);
  }

  function renderConfig(config) {
    const el = document.getElementById('bazar-commerce-config');
    if (!el) return;
    const packages = Array.isArray(config.packages) ? config.packages : [];
    const actions = config.actions || {};
    el.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Darmowe aktywne oferty prywatne</span>
          <input type="number" id="bazar-cfg-free-limit" class="w-full" value="${esc(config.privateFreeActiveOffers || 5)}" />
        </label>
        <label>
          <span class="block text-xs uppercase tracking-widest text-zinc-500 mb-2">Darmowe odswiezenie prywatne po dniach</span>
          <input type="number" id="bazar-cfg-free-refresh" class="w-full" value="${esc(config.privateFreeRefreshDays || 25)}" />
        </label>
      </div>
      <div class="border border-zinc-700 rounded-2xl p-4">
        <div class="text-xs uppercase tracking-widest text-zinc-500 mb-3">Pakiety tokenow</div>
        <div class="space-y-3">
          ${packages.map((pkg, idx) => `
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3" data-package-row="${idx}">
              <input class="w-full" data-field="label" value="${esc(pkg.label)}" />
              <input class="w-full" type="number" data-field="tokens" value="${esc(pkg.tokens)}" />
              <input class="w-full" type="number" data-field="priceCents" value="${esc(pkg.priceCents)}" />
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-field="active" ${pkg.active !== false ? 'checked' : ''} /> aktywny</label>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="border border-zinc-700 rounded-2xl p-4">
        <div class="text-xs uppercase tracking-widest text-zinc-500 mb-3">Akcje zuzywajace tokeny</div>
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
    const packages = Array.from(document.querySelectorAll('[data-package-row]')).map((row, idx) => ({
      id: `tokens_${idx === 0 ? 1 : idx === 1 ? 10 : idx === 2 ? 50 : 100}`,
      label: row.querySelector('[data-field="label"]')?.value || '',
      tokens: Number(row.querySelector('[data-field="tokens"]')?.value || 0),
      priceCents: Number(row.querySelector('[data-field="priceCents"]')?.value || 0),
      active: row.querySelector('[data-field="active"]')?.checked === true,
    }));
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
        packages,
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
            <button type="button" class="text-xs bg-red-800 text-white px-3 py-1 rounded hover:bg-red-700 transition" data-company-action="rejected" data-company-id="${esc(item.id)}">Odrzuc</button>
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
            note: 'Zamkniete w panelu Bazaru',
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
            <div class="font-semibold text-white">${esc(item.packageLabel || 'Pakiet tokenow')}</div>
            <div class="text-xs text-zinc-500 mt-1">${esc(fmtDateTime(item.createdAt))} • ${fmtMoneyCents(item.amountCents)} zl • ${esc(item.tokens || 0)} tokenow</div>
            <div class="text-xs text-zinc-500 mt-1">Status: ${esc(item.processingStatus || item.status || 'pending')}</div>
            ${item.lastError ? `<div class="text-xs text-red-300 mt-2">${esc(item.lastError)}</div>` : ''}
          </div>
          <div class="flex flex-wrap gap-2">
            ${item.processingStatus === 'error' ? `<button type="button" class="text-xs bg-amber-700 text-white px-3 py-1 rounded hover:bg-amber-600 transition" data-retry-purchase="${esc(item.id)}">Ponow przetworzenie</button>` : ''}
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

  async function loadBazarCommerceAdmin() {
    ensureBazarBackofficeUi();
    try {
      const [configData, companiesData, reportsData, purchasesData] = await Promise.all([
        apiGet('/admin/config'),
        apiGet('/admin/companies'),
        apiGet('/admin/reports'),
        apiGet('/admin/purchases'),
      ]);
      renderConfig(configData.config || {});
      renderCompanies(companiesData.companies || []);
      renderReports((reportsData.reports || []).filter((item) => item.status !== 'closed'));
      renderPurchases(purchasesData.purchases || []);
    } catch (error) {
      console.error('loadBazarCommerceAdmin:', error);
    }
  }

  const originalLoadBazar = window.loadBazar;
  window.loadBazar = async function patchedLoadBazar() {
    if (typeof originalLoadBazar === 'function') {
      await originalLoadBazar();
    }
    await loadBazarCommerceAdmin();
  };
})();
