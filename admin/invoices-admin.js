(function () {
  const API_URL = '/api/admin-invoices';
  const ORDERS_API_URL = '/api/orders?limit=2500';
  const STATUS_LABELS = {
    utworzona: 'Utworzona',
    wyslana: 'Wysłana',
    anulowana: 'Anulowana',
  };
  const KIND_LABELS = {
    invoice: 'Faktura',
    correction: 'Korekta',
  };
  const DEFAULT_ITEMS = [
    {
      name: '',
      unit: 'szt.',
      quantity: 1,
      unitNetCents: 0,
    },
  ];
  const BRAND_LOGO_URL = '/ikona.svg';
  const SELLER = {
    name: 'Igor Janicki',
    taxId: '8993047085',
    email: 'kontakt@strzelca.pl',
    address: 'ul. Pułtuska 20/9\n53-116 Wrocław',
  };

  const state = {
    initialized: false,
    loading: false,
    invoices: [],
    groups: [],
    selectedInvoiceId: '',
    orders: [],
    ordersLoaded: false,
    currentModal: null,
    signatureDataUrl: '',
    filters: {
      status: 'all',
      query: '',
    },
    pendingSelection: null,
    exportLibPromise: null,
  };

  function esc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(value ?? ''));
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(value) {
    return esc(String(value ?? '')).replace(/\n/g, '<br />');
  }

  function formatCurrencyFromCents(cents) {
    const value = Math.max(0, Number(cents) || 0) / 100;
    return new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleDateString('pl-PL');
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('pl-PL');
  }

  function toDateInputValue(value) {
    if (!value) {
      const now = new Date();
      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return toDateInputValue();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function getInvoiceSortValue(invoice) {
    const candidates = [invoice.createdAt, invoice.issueDate, invoice.updatedAt];
    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00`)
          : new Date(value);
        if (Number.isFinite(date.getTime())) return date.getTime();
      }
    }
    return 0;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getSelectedInvoice() {
    return state.invoices.find((invoice) => invoice.id === state.selectedInvoiceId) || null;
  }

  function getGroupById(groupId) {
    return state.groups.find((group) => group.groupId === groupId) || null;
  }

  function groupInvoices(rows) {
    const map = new Map();
    rows.forEach((invoice) => {
      const groupId = invoice.groupId || invoice.originalInvoiceId || invoice.id;
      if (!map.has(groupId)) {
        map.set(groupId, {
          groupId,
          invoices: [],
        });
      }
      map.get(groupId).invoices.push(invoice);
    });

    const groups = Array.from(map.values()).map((group) => {
      group.invoices.sort((a, b) => getInvoiceSortValue(b) - getInvoiceSortValue(a));
      group.latest = group.invoices[0] || null;
      group.root =
        group.invoices.find((invoice) => invoice.kind === 'invoice') ||
        group.invoices[group.invoices.length - 1] ||
        null;
      group.searchText = [
        group.root?.invoiceNumber,
        group.latest?.invoiceNumber,
        group.latest?.buyer?.name,
        group.latest?.buyer?.taxId,
        group.latest?.linkedOrder?.label,
        group.invoices.map((invoice) => invoice.correctionReason || '').join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return group;
    });

    groups.sort((a, b) => getInvoiceSortValue(b.latest) - getInvoiceSortValue(a.latest));
    return groups;
  }

  async function getAuthHeaders(asJson = false) {
    const headers = {
      'X-Admin-Panel': 'true',
    };
    if (asJson) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      if (typeof auth !== 'undefined' && auth?.currentUser?.getIdToken) {
        const token = await auth.currentUser.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('Admin invoices auth token error:', error);
    }
    return headers;
  }

  async function apiRequest(url, options = {}) {
    const method = options.method || 'GET';
    const headers = await getAuthHeaders(method !== 'GET' || options.body);
    const response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success !== true) {
      throw new Error(data?.error || `Błąd API (${response.status})`);
    }
    return data.data;
  }

  function buildOrderLabel(order) {
    const buyerName =
      normalizeText(order.companyName) ||
      normalizeText([order.firstName, order.lastName].filter(Boolean).join(' ')) ||
      normalizeText(order.email);
    return [order.orderNumber || order.id, buyerName].filter(Boolean).join(' • ');
  }

  async function loadOrdersLookup() {
    if (state.ordersLoaded) return state.orders;
    const data = await apiRequest(ORDERS_API_URL, { method: 'GET' });
    state.orders = Array.isArray(data) ? data.slice() : [];
    state.orders.sort((a, b) => getInvoiceSortValue(b) - getInvoiceSortValue(a));
    state.ordersLoaded = true;
    return state.orders;
  }

  async function loadInvoices(options = {}) {
    const preserveSelection = options.preserveSelection !== false;
    const keepId = preserveSelection ? state.selectedInvoiceId : '';
    state.loading = true;
    renderInvoicesTab();
    try {
      const rows = await apiRequest(`${API_URL}?limit=1500`, { method: 'GET' });
      state.invoices = Array.isArray(rows) ? rows : [];
      state.groups = groupInvoices(state.invoices);

      if (state.pendingSelection) {
        const pending = state.pendingSelection;
        state.pendingSelection = null;
        if (pending.invoiceId && state.invoices.some((invoice) => invoice.id === pending.invoiceId)) {
          state.selectedInvoiceId = pending.invoiceId;
        } else if (pending.groupId) {
          const group = getGroupById(pending.groupId);
          state.selectedInvoiceId = group?.latest?.id || state.selectedInvoiceId;
        }
      } else if (keepId && state.invoices.some((invoice) => invoice.id === keepId)) {
        state.selectedInvoiceId = keepId;
      } else {
        state.selectedInvoiceId = state.groups[0]?.latest?.id || '';
      }
    } catch (error) {
      console.error('loadInvoices error:', error);
      if (typeof showNotification === 'function') {
        showNotification(`Błąd ładowania faktur: ${error.message}`, 'error');
      }
    } finally {
      state.loading = false;
      renderInvoicesTab();
    }
  }

  function getFilteredGroups() {
    const query = normalizeText(state.filters.query).toLowerCase();
    const status = state.filters.status;
    return state.groups.filter((group) => {
      if (status !== 'all' && group.latest?.status !== status) return false;
      if (!query) return true;
      return group.searchText.includes(query);
    });
  }

  function ensureSelectionVisible(groups) {
    if (!state.selectedInvoiceId) {
      state.selectedInvoiceId = groups[0]?.latest?.id || '';
      return;
    }
    const exists = groups.some((group) =>
      group.invoices.some((invoice) => invoice.id === state.selectedInvoiceId)
    );
    if (!exists) state.selectedInvoiceId = groups[0]?.latest?.id || '';
  }

  function renderInvoiceStats(groups) {
    const rootCount = groups.length;
    const correctionCount = groups.reduce(
      (sum, group) => sum + group.invoices.filter((invoice) => invoice.kind === 'correction').length,
      0
    );
    const draftCount = state.invoices.filter((invoice) => invoice.status === 'utworzona').length;
    const linkedCount = state.invoices.filter((invoice) => normalizeText(invoice.linkedOrder?.orderId)).length;

    const statsEl = document.getElementById('invoice-stats-grid');
    if (!statsEl) return;
    statsEl.innerHTML = `
      <div class="invoice-kpi-card">
        <div class="invoice-kpi-value">${rootCount}</div>
        <div class="invoice-kpi-label">Grupy faktur</div>
      </div>
      <div class="invoice-kpi-card">
        <div class="invoice-kpi-value">${correctionCount}</div>
        <div class="invoice-kpi-label">Korekty</div>
      </div>
      <div class="invoice-kpi-card">
        <div class="invoice-kpi-value">${draftCount}</div>
        <div class="invoice-kpi-label">W statusie utworzona</div>
      </div>
      <div class="invoice-kpi-card">
        <div class="invoice-kpi-value">${linkedCount}</div>
        <div class="invoice-kpi-label">Powiązane z zamówieniami</div>
      </div>
    `;
  }

  function renderInvoiceList(groups) {
    const listEl = document.getElementById('invoice-groups-list');
    if (!listEl) return;

    if (state.loading) {
      listEl.innerHTML = `
        <div class="invoice-empty-state">
          <i class="fa-solid fa-spinner fa-spin text-3xl mb-3"></i>
          <div>Ładowanie faktur...</div>
        </div>
      `;
      return;
    }

    if (groups.length === 0) {
      listEl.innerHTML = `
        <div class="invoice-empty-state">
          <i class="fa-solid fa-file-invoice text-3xl mb-3"></i>
          <div>Brak faktur spełniających kryteria.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = groups
      .map((group) => {
        const latest = group.latest;
        const root = group.root;
        const correctionCount = group.invoices.filter((invoice) => invoice.kind === 'correction').length;
        return `
          <article class="invoice-group-card">
            <div class="invoice-group-head">
              <div>
                <div class="invoice-group-title">${esc(root?.invoiceNumber || latest?.invoiceNumber || 'Bez numeru')}</div>
                <div class="invoice-group-subtitle">
                  ${esc(latest?.buyer?.name || 'Brak nabywcy')}<br />
                  ${latest?.linkedOrder?.label ? `Zamówienie: ${esc(latest.linkedOrder.label)}<br />` : ''}
                  ${correctionCount > 0 ? `Korekty w grupie: ${correctionCount}` : 'Bez korekt'}
                </div>
              </div>
              <span class="invoice-status-pill status-${esc(latest?.status || 'utworzona')}">${esc(
                STATUS_LABELS[latest?.status] || latest?.status || 'Utworzona'
              )}</span>
            </div>
            <div class="invoice-doc-list">
              ${group.invoices
                .map((invoice) => {
                  const activeClass = invoice.id === state.selectedInvoiceId ? 'active' : '';
                  return `
                    <div class="invoice-doc-row ${activeClass}" onclick="selectAdminInvoice('${esc(invoice.id)}')">
                      <div class="invoice-doc-row-top">
                        <div class="invoice-doc-row-title">${esc(
                          invoice.kind === 'correction' ? 'Faktura korygująca' : 'Faktura'
                        )} • ${esc(invoice.invoiceNumber || '—')}</div>
                        <span class="invoice-status-pill status-${esc(invoice.status || 'utworzona')}">${esc(
                          STATUS_LABELS[invoice.status] || invoice.status || 'Utworzona'
                        )}</span>
                      </div>
                      <div class="invoice-doc-row-meta">
                        Data wystawienia: ${esc(formatDate(invoice.issueDate))}<br />
                        Wartość brutto: ${esc(formatCurrencyFromCents(invoice.totals?.grossTotalCents || 0))} zł
                        ${
                          invoice.kind === 'correction' && invoice.correctionReason
                            ? `<br />Powód korekty: ${esc(invoice.correctionReason)}`
                            : ''
                        }
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </article>
        `;
      })
      .join('');
  }

  function buildInvoiceDocumentHtml(invoice, options = {}) {
    const includeSignature = options.includeSignature === true && !!state.signatureDataUrl;
    const title =
      invoice.kind === 'correction' ? 'FAKTURA KORYGUJĄCA' : 'FAKTURA ZWOLNIONA Z VAT';
    const buyerTaxIdHtml = invoice.buyer?.taxId
      ? `NIP: ${esc(invoice.buyer.taxId)}`
      : `<span class="line-through">NIP: —</span>`;
    const invoiceRows = (Array.isArray(invoice.items) ? invoice.items : []).map((item, index) => {
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${esc(item.name || '—')}</td>
          <td>${esc(item.unit || 'szt.')}</td>
          <td class="numeric">${esc(item.quantity || 1)}</td>
          <td class="numeric">${esc(formatCurrencyFromCents(item.unitNetCents || 0))} zł</td>
          <td class="numeric">${esc(formatCurrencyFromCents(item.totalNetCents || 0))} zł</td>
          <td class="numeric">ZW</td>
          <td class="numeric">-</td>
        </tr>
      `;
    });

    const correctionBanner =
      invoice.kind === 'correction'
        ? `
          <div class="invoice-correction-banner">
            <strong>FAKTURA KORYGUJĄCA</strong><br />
            Faktura pierwotna: ${esc(invoice.originalInvoiceNumber || invoice.sourceInvoiceNumber || '—')}<br />
            Korekta do dokumentu: ${esc(invoice.sourceInvoiceNumber || invoice.invoiceNumber || '—')}<br />
            Przyczyna korekty: ${esc(invoice.correctionReason || '—')}
          </div>
        `
        : '';

    const notesBlock = normalizeText(invoice.notes)
      ? `
        <div class="invoice-correction-banner">
          <strong>Uwagi</strong><br />
          ${nl2br(invoice.notes)}
        </div>
      `
      : '';

    const signatureImg = includeSignature
      ? `<img src="${state.signatureDataUrl}" alt="Parafka sprzedawcy" class="invoice-signature-image" />`
      : '';

    return `
      <section class="invoice-a4">
        <img class="invoice-watermark" src="${BRAND_LOGO_URL}" alt="" />
        <header class="invoice-brand-row">
          <div class="invoice-brand-main">
            <div class="invoice-brand-badge">
              <img src="${BRAND_LOGO_URL}" alt="STRZELCA.PL" class="invoice-brand-logo" />
              STRZELCA.PL
            </div>
            <div class="invoice-title">${esc(title)}</div>
            <div class="invoice-number">nr. ${esc(invoice.invoiceNumber || '—')}</div>
          </div>
          <div class="invoice-meta-side">
            <div>
              <div class="invoice-meta-kicker">Data wystawienia</div>
              <div class="invoice-meta-value">${esc(formatDate(invoice.issueDate))}</div>
            </div>
            <div>
              <div class="invoice-meta-kicker">Data sprzedaży</div>
              <div class="invoice-meta-value">${esc(formatDate(invoice.saleDate || invoice.issueDate))}</div>
            </div>
            ${
              invoice.linkedOrder?.orderNumber
                ? `
                  <div>
                    <div class="invoice-meta-kicker">Powiązane zamówienie</div>
                    <div class="invoice-meta-value">${esc(invoice.linkedOrder.orderNumber)}</div>
                  </div>
                `
                : ''
            }
          </div>
        </header>

        <section class="invoice-parties">
          <div class="invoice-party">
            <div class="invoice-party-label">Sprzedawca</div>
            <div class="invoice-party-content">
              ${nl2br(`${SELLER.name}\nNIP: ${SELLER.taxId}\n${SELLER.email}\n${SELLER.address}`)}
            </div>
          </div>
          <div class="invoice-party">
            <div class="invoice-party-label">Nabywca</div>
            <div class="invoice-party-content">
              ${nl2br(invoice.buyer?.name || '—')}<br />
              ${buyerTaxIdHtml}<br />
              ${nl2br(invoice.buyer?.address || '—')}
            </div>
          </div>
        </section>

        ${correctionBanner}

        <div class="invoice-table-wrap">
          <table class="invoice-table">
            <thead>
              <tr>
                <th>Lp.</th>
                <th>Nazwa towaru/usługi</th>
                <th>Jm</th>
                <th class="numeric">Ilość</th>
                <th class="numeric">Cena netto</th>
                <th class="numeric">Wartość netto</th>
                <th class="numeric">Stawka VAT</th>
                <th class="numeric">Kwota VAT</th>
              </tr>
            </thead>
            <tbody>
              ${invoiceRows.join('')}
            </tbody>
          </table>
        </div>

        <div class="invoice-summary">
          <div class="invoice-summary-card">
            <div class="invoice-summary-row">
              <span>Wartość netto</span>
              <strong>${esc(formatCurrencyFromCents(invoice.totals?.netTotalCents || 0))} zł</strong>
            </div>
            <div class="invoice-summary-row">
              <span>Kwota VAT</span>
              <strong>ZWOLNIONY</strong>
            </div>
            <div class="invoice-summary-row total">
              <span>Wartość brutto</span>
              <strong>${esc(formatCurrencyFromCents(invoice.totals?.grossTotalCents || 0))} zł</strong>
            </div>
          </div>
        </div>

        ${notesBlock}

        <section class="invoice-signature-grid">
          <div class="invoice-signature-box">
            <div class="invoice-signature-label">Sprzedawca</div>
            <div class="invoice-signature-line">
              ${signatureImg}
              Igor Janicki
            </div>
          </div>
          <div class="invoice-signature-box">
            <div class="invoice-signature-label">Nabywca</div>
            <div class="invoice-signature-line">${esc(invoice.buyer?.name || '—')}</div>
          </div>
        </section>

        <div class="invoice-legal-note">
          Faktura dokumentuje sprzedaż zwolnioną z VAT na podstawie art. 113 ustawy o podatku od towarów i usług.
          Zgodnie z przepisami podatnik nie jest zobowiązany do naliczania podatku VAT.
        </div>
      </section>
    `;
  }

  function renderPreview(invoice) {
    const metaEl = document.getElementById('invoice-preview-meta');
    const previewEl = document.getElementById('invoice-preview-document');
    if (!metaEl || !previewEl) return;

    if (!invoice) {
      metaEl.innerHTML = `
        <div class="invoice-empty-state">
          <i class="fa-solid fa-file-circle-plus text-3xl mb-3"></i>
          <div>Wybierz fakturę z listy albo utwórz nową.</div>
        </div>
      `;
      previewEl.innerHTML = '';
      return;
    }

    const canEdit = invoice.status === 'utworzona';
    metaEl.innerHTML = `
      <div class="admin-card">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-2xl font-bold coyote-text">${esc(
              invoice.kind === 'correction' ? 'Faktura korygująca' : 'Faktura'
            )}</h2>
            <p class="text-sm text-zinc-400 mt-2">
              ${esc(invoice.invoiceNumber || '—')} • ${esc(invoice.buyer?.name || 'Brak nabywcy')}
              ${
                invoice.linkedOrder?.label
                  ? `<br />Powiązane zamówienie: <span class="text-zinc-200">${esc(invoice.linkedOrder.label)}</span>`
                  : ''
              }
            </p>
          </div>
          <span class="invoice-status-pill status-${esc(invoice.status || 'utworzona')}">${esc(
            STATUS_LABELS[invoice.status] || invoice.status || 'Utworzona'
          )}</span>
        </div>

        <div class="invoice-preview-actions mt-6">
          <button class="btn-admin text-sm" onclick="openAdminInvoiceModal('${esc(invoice.id)}')"
            ${canEdit ? '' : 'disabled'}>
            <i class="fa-solid fa-pen-to-square"></i> Edytuj
          </button>
          <button class="invoice-secondary-button" onclick="openAdminInvoiceCorrectionModal('${esc(invoice.id)}')">
            <i class="fa-solid fa-file-circle-plus"></i> Utwórz korektę
          </button>
          <button class="invoice-secondary-button" onclick="printAdminInvoice()">
            <i class="fa-solid fa-print"></i> Drukuj
          </button>
          <button class="invoice-secondary-button" onclick="exportAdminInvoicePDF()">
            <i class="fa-solid fa-file-pdf"></i> PDF
          </button>
          <button class="invoice-secondary-button" onclick="exportAdminInvoicePNG()">
            <i class="fa-solid fa-image"></i> PNG
          </button>
        </div>

        <div class="invoice-form-grid mt-6">
          <div>
            <label class="block text-sm font-medium mb-2">Status</label>
            <select id="invoice-status-select" class="w-full">
              ${Object.entries(STATUS_LABELS)
                .map(
                  ([value, label]) =>
                    `<option value="${esc(value)}" ${invoice.status === value ? 'selected' : ''}>${esc(label)}</option>`
                )
                .join('')}
            </select>
            <p class="text-xs text-zinc-500 mt-2">
              Treść można edytować tylko w statusie „utworzona”. Później zostaje już tylko ręczna zmiana statusu.
            </p>
          </div>
          <div class="flex items-end">
            <button class="btn-admin w-full" onclick="saveAdminInvoiceStatus()">
              <i class="fa-solid fa-floppy-disk mr-2"></i>Zapisz status
            </button>
          </div>
        </div>

        <div class="mt-6 text-xs text-zinc-500 leading-relaxed">
          Utworzono: ${esc(formatDateTime(invoice.createdAt))}<br />
          Ostatnia aktualizacja: ${esc(formatDateTime(invoice.updatedAt))}<br />
          ${invoice.sentAt ? `Wysłano: ${esc(formatDateTime(invoice.sentAt))}<br />` : ''}
          ${invoice.cancelledAt ? `Anulowano: ${esc(formatDateTime(invoice.cancelledAt))}` : ''}
        </div>
      </div>
    `;

    previewEl.innerHTML = `
      <div class="invoice-a4-frame">
        ${buildInvoiceDocumentHtml(invoice, { includeSignature: false })}
      </div>
    `;
  }

  function renderSignatureSession() {
    const signatureEl = document.getElementById('invoice-signature-session');
    if (!signatureEl) return;
    if (!state.signatureDataUrl) {
      signatureEl.innerHTML = `
        <div class="text-sm text-zinc-400 leading-relaxed">
          Parafka nie jest zapisana w projekcie ani w bazie. Dodajesz ją lokalnie tylko do bieżącej sesji eksportu.
        </div>
      `;
      return;
    }
    signatureEl.innerHTML = `
      <div class="invoice-signature-session-preview">
        <img src="${state.signatureDataUrl}" alt="Parafka w sesji" />
        <div class="text-sm text-zinc-300 leading-relaxed">
          Parafka jest aktywna tylko w tej sesji przeglądarki.<br />
          Zostanie dodana do eksportu PDF/PNG i wydruku, ale nie zapisze się w Firestore.
        </div>
      </div>
    `;
  }

  function renderInvoicesTab() {
    const tab = document.getElementById('tab-invoices');
    if (!tab) return;
    const groups = getFilteredGroups();
    ensureSelectionVisible(groups);
    renderInvoiceStats(groups);
    renderInvoiceList(groups);
    renderPreview(getSelectedInvoice());
    renderSignatureSession();
  }

  function getOrderById(orderId) {
    return state.orders.find((order) => order.id === orderId) || null;
  }

  function makeBlankDraft() {
    return {
      buyer: {
        name: '',
        taxId: '',
        address: '',
      },
      issueDate: toDateInputValue(),
      saleDate: toDateInputValue(),
      status: 'utworzona',
      linkedOrderId: '',
      items: deepClone(DEFAULT_ITEMS),
      notes: '',
      kind: 'invoice',
      correctionReason: '',
    };
  }

  function centsToFormParts(cents) {
    const safeCents = Math.max(0, Number(cents) || 0);
    return {
      zl: Math.floor(safeCents / 100),
      gr: String(safeCents % 100).padStart(2, '0'),
    };
  }

  function buildInvoiceItemRowHtml(item, index) {
    const money = centsToFormParts(item.unitNetCents || 0);
    const totalCents = (Number(item.quantity) || 1) * (Number(item.unitNetCents) || 0);
    return `
      <div class="invoice-item-editor-row" data-row-index="${index}">
        <div>
          <div class="invoice-item-editor-label">Lp.</div>
          <div class="invoice-static-chip">${index + 1}</div>
        </div>
        <div>
          <div class="invoice-item-editor-label">Nazwa towaru/usługi</div>
          <input type="text" class="invoice-item-name" value="${esc(item.name || '')}" placeholder="Np. obsługa szkoleniowa" />
        </div>
        <div>
          <div class="invoice-item-editor-label">Jm</div>
          <select class="invoice-item-unit">
            ${['szt.', 'kpl.', 'h', 'rbh']
              .map((unit) => `<option value="${unit}" ${item.unit === unit ? 'selected' : ''}>${unit}</option>`)
              .join('')}
          </select>
        </div>
        <div>
          <div class="invoice-item-editor-label">Ilość</div>
          <input type="number" min="1" step="1" class="invoice-item-quantity" value="${esc(item.quantity || 1)}" />
        </div>
        <div>
          <div class="invoice-item-editor-label">Cena netto</div>
          <div class="invoice-price-pair">
            <input type="number" min="0" step="1" class="invoice-item-price-zl" value="${esc(money.zl)}" placeholder="zł" />
            <input type="number" min="0" max="99" step="1" class="invoice-item-price-gr" value="${esc(money.gr)}" placeholder="gr" />
          </div>
        </div>
        <div>
          <div class="invoice-item-editor-label">VAT</div>
          <div class="invoice-static-chip">ZW</div>
        </div>
        <div>
          <div class="invoice-item-editor-label">Wartość netto</div>
          <div class="invoice-item-editor-total">${esc(formatCurrencyFromCents(totalCents))} zł</div>
        </div>
        <div>
          <div class="invoice-item-editor-label">Akcja</div>
          <button type="button" class="invoice-secondary-button w-full" onclick="removeInvoiceItemRow(${index})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  function renderInvoiceItemRows(items) {
    const container = document.getElementById('invoice-form-items');
    if (!container) return;
    container.innerHTML = items.map((item, index) => buildInvoiceItemRowHtml(item, index)).join('');
  }

  function readInvoiceItemsFromForm() {
    const rows = Array.from(document.querySelectorAll('#invoice-form-items .invoice-item-editor-row'));
    return rows.map((row) => {
      const name = normalizeText(row.querySelector('.invoice-item-name')?.value);
      const unit = normalizeText(row.querySelector('.invoice-item-unit')?.value) || 'szt.';
      const quantity = Math.max(1, parseInt(row.querySelector('.invoice-item-quantity')?.value, 10) || 1);
      const zl = Math.max(0, parseInt(row.querySelector('.invoice-item-price-zl')?.value, 10) || 0);
      const gr = Math.max(0, Math.min(99, parseInt(row.querySelector('.invoice-item-price-gr')?.value, 10) || 0));
      return {
        name,
        unit,
        quantity,
        unitNetCents: zl * 100 + gr,
      };
    });
  }

  function recalculateInvoiceFormTotals() {
    const items = readInvoiceItemsFromForm();
    let netCents = 0;
    document.querySelectorAll('#invoice-form-items .invoice-item-editor-row').forEach((row, index) => {
      const item = items[index];
      const total = (item.quantity || 1) * (item.unitNetCents || 0);
      netCents += total;
      const totalEl = row.querySelector('.invoice-item-editor-total');
      if (totalEl) totalEl.textContent = `${formatCurrencyFromCents(total)} zł`;
      const lpEl = row.querySelector('.invoice-static-chip');
      if (lpEl) lpEl.textContent = String(index + 1);
    });
    const netEl = document.getElementById('invoice-form-total-net');
    const grossEl = document.getElementById('invoice-form-total-gross');
    if (netEl) netEl.textContent = `${formatCurrencyFromCents(netCents)} zł`;
    if (grossEl) grossEl.textContent = `${formatCurrencyFromCents(netCents)} zł`;
  }

  function getModalDraftFromInvoice(invoice) {
    return {
      id: invoice.id,
      buyer: deepClone(invoice.buyer || { name: '', taxId: '', address: '' }),
      issueDate: toDateInputValue(invoice.issueDate),
      saleDate: toDateInputValue(invoice.saleDate || invoice.issueDate),
      status: invoice.status || 'utworzona',
      linkedOrderId: invoice.linkedOrder?.orderId || '',
      items: deepClone(invoice.items || DEFAULT_ITEMS),
      notes: invoice.notes || '',
      kind: invoice.kind || 'invoice',
      correctionReason: invoice.correctionReason || '',
      originalInvoiceNumber: invoice.originalInvoiceNumber || '',
    };
  }

  function getCorrectionDraft(sourceInvoice) {
    const latest = sourceInvoice;
    return {
      buyer: deepClone(latest.buyer || { name: '', taxId: '', address: '' }),
      issueDate: toDateInputValue(),
      saleDate: toDateInputValue(latest.saleDate || latest.issueDate),
      status: 'utworzona',
      linkedOrderId: latest.linkedOrder?.orderId || '',
      items: deepClone(latest.items || DEFAULT_ITEMS),
      notes: latest.notes || '',
      kind: 'correction',
      sourceInvoiceId: latest.id,
      sourceInvoiceNumber: latest.invoiceNumber || '',
      originalInvoiceNumber: latest.originalInvoiceNumber || latest.invoiceNumber || '',
      correctionReason: '',
    };
  }

  function renderInvoiceModal(draft, mode) {
    const modal = document.getElementById('invoice-modal');
    const ordersOptions = state.orders
      .map((order) => {
        const label = buildOrderLabel(order);
        return `<option value="${esc(order.id)}" ${draft.linkedOrderId === order.id ? 'selected' : ''}>${esc(label)}</option>`;
      })
      .join('');

    modal.innerHTML = `
      <div class="admin-card invoice-modal-card" onclick="event.stopPropagation()">
        <div class="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 class="text-2xl font-bold coyote-text">
              ${
                mode === 'edit'
                  ? 'Edytuj fakturę'
                  : mode === 'correction'
                    ? 'Nowa korekta'
                    : 'Nowa faktura'
              }
            </h2>
            <p class="text-sm text-zinc-400 mt-2">
              ${
                draft.kind === 'correction'
                  ? `Korekta do faktury pierwotnej ${esc(draft.originalInvoiceNumber || draft.sourceInvoiceNumber || '—')}`
                  : 'Dokument zapisze się jako rekord w bazie, a podpis dodasz dopiero przy eksporcie.'
              }
            </p>
          </div>
          <button type="button" class="text-zinc-400 hover:text-white" onclick="closeAdminInvoiceModal()">
            <i class="fa-solid fa-times text-xl"></i>
          </button>
        </div>

        <form id="invoice-admin-form" onsubmit="saveAdminInvoice(event)">
          <div class="invoice-form-grid">
            <div>
              <label class="block text-sm font-medium mb-2">Data wystawienia</label>
              <input type="date" id="invoice-issue-date" value="${esc(draft.issueDate)}" required />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Data sprzedaży</label>
              <input type="date" id="invoice-sale-date" value="${esc(draft.saleDate)}" required />
            </div>
          </div>

          <div class="invoice-form-grid mt-4">
            <div>
              <label class="block text-sm font-medium mb-2">Status początkowy</label>
              <select id="invoice-form-status">
                ${Object.entries(STATUS_LABELS)
                  .map(
                    ([value, label]) =>
                      `<option value="${esc(value)}" ${draft.status === value ? 'selected' : ''}>${esc(label)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">Powiązane zamówienie</label>
              <div class="invoice-order-assist">
                <select id="invoice-linked-order-id" class="flex-1">
                  <option value="">Brak powiązania</option>
                  ${ordersOptions}
                </select>
                <button type="button" class="invoice-secondary-button" onclick="fillInvoiceBuyerFromOrder()">
                  <i class="fa-solid fa-wand-magic-sparkles"></i> Uzupełnij z zamówienia
                </button>
              </div>
            </div>
          </div>

          <div class="invoice-form-grid mt-6">
            <div>
              <label class="block text-sm font-medium mb-2">Nabywca: nazwa / imię i nazwisko</label>
              <input type="text" id="invoice-buyer-name" value="${esc(draft.buyer?.name || '')}" required />
            </div>
            <div>
              <label class="block text-sm font-medium mb-2">NIP nabywcy</label>
              <input type="text" id="invoice-buyer-taxid" value="${esc(draft.buyer?.taxId || '')}" placeholder="Opcjonalnie" inputmode="numeric" />
            </div>
          </div>

          <div class="mt-4">
            <label class="block text-sm font-medium mb-2">Adres nabywcy</label>
            <textarea id="invoice-buyer-address" rows="3" required>${esc(draft.buyer?.address || '')}</textarea>
          </div>

          ${
            draft.kind === 'correction'
              ? `
                <div class="mt-6">
                  <label class="block text-sm font-medium mb-2">Przyczyna korekty</label>
                  <textarea id="invoice-correction-reason" rows="3" required>${esc(draft.correctionReason || '')}</textarea>
                </div>
              `
              : ''
          }

          <div class="mt-6">
            <div class="flex items-center justify-between gap-4 mb-3">
              <div>
                <h3 class="text-lg font-semibold text-white">Pozycje faktury</h3>
                <p class="text-xs text-zinc-500 mt-1">Numeracja uzupełnia się automatycznie. VAT pozostaje na stałe jako ZW.</p>
              </div>
              <button type="button" class="btn-admin text-sm px-4 py-2" onclick="addInvoiceItemRow()">
                <i class="fa-solid fa-plus mr-2"></i>Dodaj pozycję
              </button>
            </div>
            <div id="invoice-form-items" class="invoice-item-editor"></div>
          </div>

          <div class="invoice-form-grid mt-6">
            <div>
              <label class="block text-sm font-medium mb-2">Uwagi</label>
              <textarea id="invoice-form-notes" rows="4" placeholder="Opcjonalne dodatkowe informacje">${esc(
                draft.notes || ''
              )}</textarea>
            </div>
            <div>
              <div class="admin-card h-full">
                <h3 class="text-lg font-semibold text-white">Podsumowanie</h3>
                <div class="space-y-3 mt-4 text-sm">
                  <div class="flex justify-between gap-4"><span class="text-zinc-400">Wartość netto</span><strong id="invoice-form-total-net">0,00 zł</strong></div>
                  <div class="flex justify-between gap-4"><span class="text-zinc-400">Kwota VAT</span><strong>ZWOLNIONY</strong></div>
                  <div class="flex justify-between gap-4 text-base"><span class="text-zinc-400">Wartość brutto</span><strong id="invoice-form-total-gross">0,00 zł</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-8">
            <button type="button" class="invoice-secondary-button" onclick="closeAdminInvoiceModal()">Anuluj</button>
            <button type="submit" class="btn-admin">
              <i class="fa-solid fa-floppy-disk mr-2"></i>Zapisz fakturę
            </button>
          </div>
        </form>
      </div>
    `;

    state.currentModal = { draft: deepClone(draft), mode };
    modal.classList.add('open');
    renderInvoiceItemRows(draft.items?.length ? draft.items : deepClone(DEFAULT_ITEMS));
    recalculateInvoiceFormTotals();

    modal.querySelectorAll('#invoice-form-items input, #invoice-form-items select').forEach((element) => {
      element.addEventListener('input', recalculateInvoiceFormTotals);
      element.addEventListener('change', recalculateInvoiceFormTotals);
    });
  }

  async function openModalFor(mode, sourceId) {
    await loadOrdersLookup();
    let draft = makeBlankDraft();

    if (mode === 'edit') {
      const invoice = state.invoices.find((item) => item.id === sourceId);
      if (!invoice) throw new Error('Nie znaleziono faktury do edycji.');
      if (invoice.status !== 'utworzona') {
        throw new Error('Edytować można tylko faktury w statusie "utworzona".');
      }
      draft = getModalDraftFromInvoice(invoice);
    }

    if (mode === 'correction') {
      const invoice = state.invoices.find((item) => item.id === sourceId);
      if (!invoice) throw new Error('Nie znaleziono faktury źródłowej.');
      draft = getCorrectionDraft(invoice);
    }

    renderInvoiceModal(draft, mode);
  }

  async function loadScriptOnce(src) {
    if (document.querySelector(`script[data-admin-invoice-lib="${src}"]`)) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.adminInvoiceLib = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Nie udało się załadować ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureExportLibs() {
    if (window.html2canvas && window.jspdf?.jsPDF) return;
    if (!state.exportLibPromise) {
      state.exportLibPromise = (async () => {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
      })();
    }
    await state.exportLibPromise;
  }

  function createExportNode(invoice, options = {}) {
    const host = document.createElement('div');
    host.className = 'invoice-print-clone-host';
    host.innerHTML = buildInvoiceDocumentHtml(invoice, options);
    document.body.appendChild(host);
    const node = host.firstElementChild;
    return {
      host,
      node,
      dispose() {
        host.remove();
      },
    };
  }

  async function exportAsCanvas(invoice) {
    await ensureExportLibs();
    const clone = createExportNode(invoice, { includeSignature: true });
    try {
      return await window.html2canvas(clone.node, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#faf8f3',
      });
    } finally {
      clone.dispose();
    }
  }

  function downloadDataUrl(dataUrl, fileName) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function exportPdf(invoice) {
    const canvas = await exportAsCanvas(invoice);
    const imageData = canvas.toDataURL('image/png');
    const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight);
    pdf.save(`${invoice.invoiceNumber || 'faktura'}.pdf`);
  }

  async function exportPng(invoice) {
    const canvas = await exportAsCanvas(invoice);
    downloadDataUrl(canvas.toDataURL('image/png'), `${invoice.invoiceNumber || 'faktura'}.png`);
  }

  function printInvoice(invoice) {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
    if (!popup) {
      throw new Error('Przeglądarka zablokowała okno wydruku.');
    }

    const html = buildInvoiceDocumentHtml(invoice, { includeSignature: true });
    popup.document.open();
    popup.document.write(`
      <!doctype html>
      <html lang="pl">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${esc(invoice.invoiceNumber || 'Faktura')}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Inter:wght@400;500;700&display=swap" rel="stylesheet" />
          <link rel="stylesheet" href="/admin/invoices-admin.css?v=2026-03-25-1" />
          <style>
            body { margin: 0; background: #fff; }
            .invoice-a4-frame { padding: 0; background: #fff; border: 0; }
            .invoice-a4 { box-shadow: none; border-radius: 0; margin: 0 auto; }
            @page { size: A4; margin: 0; }
          </style>
        </head>
        <body>
          <div class="invoice-a4-frame">${html}</div>
        </body>
      </html>
    `);
    popup.document.close();
    popup.onload = () => {
      popup.focus();
      popup.print();
    };
  }

  window.selectAdminInvoice = function selectAdminInvoice(invoiceId) {
    state.selectedInvoiceId = invoiceId;
    renderInvoicesTab();
  };

  window.refreshAdminInvoices = async function refreshAdminInvoices() {
    await loadInvoices({ preserveSelection: true });
  };

  window.openAdminInvoiceModal = async function openAdminInvoiceModal(invoiceId) {
    try {
      await openModalFor(invoiceId ? 'edit' : 'create', invoiceId || '');
    } catch (error) {
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.openAdminInvoiceCorrectionModal = async function openAdminInvoiceCorrectionModal(invoiceId) {
    try {
      await openModalFor('correction', invoiceId);
    } catch (error) {
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.closeAdminInvoiceModal = function closeAdminInvoiceModal() {
    const modal = document.getElementById('invoice-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.innerHTML = '';
    }
    state.currentModal = null;
  };

  window.addInvoiceItemRow = function addInvoiceItemRow() {
    const current = readInvoiceItemsFromForm();
    current.push({
      name: '',
      unit: 'szt.',
      quantity: 1,
      unitNetCents: 0,
    });
    renderInvoiceItemRows(current);
    document.querySelectorAll('#invoice-form-items input, #invoice-form-items select').forEach((element) => {
      element.addEventListener('input', recalculateInvoiceFormTotals);
      element.addEventListener('change', recalculateInvoiceFormTotals);
    });
    recalculateInvoiceFormTotals();
  };

  window.removeInvoiceItemRow = function removeInvoiceItemRow(index) {
    const current = readInvoiceItemsFromForm();
    current.splice(index, 1);
    renderInvoiceItemRows(current.length ? current : deepClone(DEFAULT_ITEMS));
    document.querySelectorAll('#invoice-form-items input, #invoice-form-items select').forEach((element) => {
      element.addEventListener('input', recalculateInvoiceFormTotals);
      element.addEventListener('change', recalculateInvoiceFormTotals);
    });
    recalculateInvoiceFormTotals();
  };

  window.recalculateInvoiceFormTotals = recalculateInvoiceFormTotals;

  window.fillInvoiceBuyerFromOrder = function fillInvoiceBuyerFromOrder() {
    const select = document.getElementById('invoice-linked-order-id');
    const orderId = normalizeText(select?.value);
    const order = getOrderById(orderId);
    if (!order) {
      if (typeof showNotification === 'function') showNotification('Najpierw wybierz zamówienie.', 'error');
      return;
    }

    const buyerName =
      normalizeText(order.companyName) ||
      normalizeText([order.firstName, order.lastName].filter(Boolean).join(' ')) ||
      normalizeText(order.email) ||
      normalizeText(order.userId) ||
      'Nabywca';
    const taxId = normalizeText(order.taxId || '');
    const address = [
      order.address?.street,
      order.address?.buildingNumber,
      order.address?.postalCode,
      order.address?.city,
    ]
      .filter(Boolean)
      .join(', ');

    const nameInput = document.getElementById('invoice-buyer-name');
    const taxIdInput = document.getElementById('invoice-buyer-taxid');
    const addressInput = document.getElementById('invoice-buyer-address');
    if (nameInput) nameInput.value = buyerName;
    if (taxIdInput) taxIdInput.value = taxId;
    if (addressInput) addressInput.value = address;
    if (typeof showNotification === 'function') {
      showNotification('Dane nabywcy uzupełnione z zamówienia.', 'success');
    }
  };

  window.saveAdminInvoice = async function saveAdminInvoice(event) {
    event.preventDefault();
    if (!state.currentModal) return;
    const modalMode = state.currentModal.mode;

    const items = readInvoiceItemsFromForm();
    const payload = {
      issueDate: document.getElementById('invoice-issue-date')?.value,
      saleDate: document.getElementById('invoice-sale-date')?.value,
      status: document.getElementById('invoice-form-status')?.value || 'utworzona',
      linkedOrderId: document.getElementById('invoice-linked-order-id')?.value || '',
      buyer: {
        name: document.getElementById('invoice-buyer-name')?.value || '',
        taxId: document.getElementById('invoice-buyer-taxid')?.value || '',
        address: document.getElementById('invoice-buyer-address')?.value || '',
      },
      items,
      notes: document.getElementById('invoice-form-notes')?.value || '',
      kind: state.currentModal.draft.kind || 'invoice',
    };

    if (payload.kind === 'correction') {
      payload.sourceInvoiceId = state.currentModal.draft.sourceInvoiceId;
      payload.correctionReason = document.getElementById('invoice-correction-reason')?.value || '';
    }

    try {
      let saved;
      if (state.currentModal.mode === 'edit') {
        payload.id = state.currentModal.draft.id;
        saved = await apiRequest(API_URL, { method: 'PUT', body: payload });
      } else {
        saved = await apiRequest(API_URL, { method: 'POST', body: payload });
      }
      closeAdminInvoiceModal();
      state.pendingSelection = { invoiceId: saved.id, groupId: saved.groupId };
      await loadInvoices({ preserveSelection: false });
      if (typeof showNotification === 'function') {
        showNotification(
          modalMode === 'edit' ? 'Faktura zaktualizowana.' : 'Faktura zapisana.',
          'success'
        );
      }
    } catch (error) {
      console.error('saveAdminInvoice error:', error);
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.saveAdminInvoiceStatus = async function saveAdminInvoiceStatus() {
    const invoice = getSelectedInvoice();
    if (!invoice) return;
    const select = document.getElementById('invoice-status-select');
    const status = normalizeText(select?.value) || invoice.status;
    try {
      const saved = await apiRequest(API_URL, {
        method: 'PUT',
        body: {
          id: invoice.id,
          status,
          statusOnly: true,
        },
      });
      state.pendingSelection = { invoiceId: saved.id, groupId: saved.groupId };
      await loadInvoices({ preserveSelection: false });
      if (typeof showNotification === 'function') showNotification('Status faktury zapisany.', 'success');
    } catch (error) {
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.exportAdminInvoicePDF = async function exportAdminInvoicePDF() {
    const invoice = getSelectedInvoice();
    if (!invoice) return;
    try {
      await exportPdf(invoice);
      if (typeof showNotification === 'function') showNotification('PDF został wygenerowany.', 'success');
    } catch (error) {
      console.error('export pdf error:', error);
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.exportAdminInvoicePNG = async function exportAdminInvoicePNG() {
    const invoice = getSelectedInvoice();
    if (!invoice) return;
    try {
      await exportPng(invoice);
      if (typeof showNotification === 'function') showNotification('PNG został wygenerowany.', 'success');
    } catch (error) {
      console.error('export png error:', error);
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.printAdminInvoice = function printAdminInvoiceButton() {
    const invoice = getSelectedInvoice();
    if (!invoice) return;
    try {
      printInvoice(invoice);
    } catch (error) {
      if (typeof showNotification === 'function') showNotification(error.message, 'error');
    }
  };

  window.handleInvoiceSignatureUpload = function handleInvoiceSignatureUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.signatureDataUrl = String(reader.result || '');
      renderSignatureSession();
      if (typeof showNotification === 'function') {
        showNotification('Parafka aktywna dla bieżącej sesji eksportu.', 'success');
      }
    };
    reader.onerror = () => {
      if (typeof showNotification === 'function') {
        showNotification('Nie udało się wczytać parafki.', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  window.clearSessionInvoiceSignature = function clearSessionInvoiceSignature() {
    state.signatureDataUrl = '';
    const input = document.getElementById('invoice-signature-input');
    if (input) input.value = '';
    renderSignatureSession();
    if (typeof showNotification === 'function') {
      showNotification('Parafka została usunięta z bieżącej sesji.', 'success');
    }
  };

  window.openInvoiceGroupFromOrder = function openInvoiceGroupFromOrder(groupId, invoiceId) {
    state.pendingSelection = {
      groupId: normalizeText(groupId),
      invoiceId: normalizeText(invoiceId),
    };
    if (typeof switchTab === 'function') switchTab('invoices');
  };

  window.AdminInvoices = {
    async onTabSelected() {
      if (!state.initialized) state.initialized = true;
      renderInvoicesTab();
      await loadInvoices({ preserveSelection: true });
    },
  };

  function bindStaticEvents() {
    const queryInput = document.getElementById('invoice-search-input');
    if (queryInput && !queryInput.dataset.bound) {
      queryInput.dataset.bound = 'true';
      queryInput.addEventListener('input', () => {
        state.filters.query = queryInput.value || '';
        renderInvoicesTab();
      });
    }

    const statusInput = document.getElementById('invoice-status-filter');
    if (statusInput && !statusInput.dataset.bound) {
      statusInput.dataset.bound = 'true';
      statusInput.addEventListener('change', () => {
        state.filters.status = statusInput.value || 'all';
        renderInvoicesTab();
      });
    }

    const modal = document.getElementById('invoice-modal');
    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = 'true';
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          closeAdminInvoiceModal();
        }
      });
    }
  }

  function boot() {
    bindStaticEvents();
    renderInvoicesTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
