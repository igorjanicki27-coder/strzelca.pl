const {
  initAdmin,
  admin,
  setCors,
  getSessionUser,
  readJsonBody,
} = require('./_sso-utils');
const { firestoreValueToJsonable } = require('./_serialize-firestore');
const { getUserRoleProfile, canAccessBackofficeScope } = require('./_moderation');

const COLLECTION_NAME = 'adminInvoices';
const ALLOWED_STATUSES = new Set(['utworzona', 'wyslana', 'anulowana']);
const ALLOWED_UNITS = new Set(['szt.', 'kpl.', 'h', 'rbh']);
const ALLOWED_KINDS = new Set(['invoice', 'correction']);
const FIXED_SELLER = {
  name: 'Igor Janicki',
  taxId: '8993047085',
  email: 'kontakt@strzelca.pl',
  addressLines: ['ul. Pułtuska 20/9', '53-116 Wrocław'],
};

function readInvoiceQueryParam(req, name) {
  const rq =
    req.query && typeof req.query === 'object' && !Array.isArray(req.query)
      ? req.query
      : {};
  const raw = rq[name];
  if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
    return Array.isArray(raw) ? raw[0] : raw;
  }
  try {
    const host = req.headers?.host || 'localhost';
    const urlObj = new URL(req.url || '/', `http://${host}`);
    const value = urlObj.searchParams.get(name);
    return value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

async function canManageInvoices(uid) {
  if (!uid) return false;
  initAdmin();
  const db = admin.firestore();
  const profile = await getUserRoleProfile(db, uid);
  return canAccessBackofficeScope(profile, 'shop');
}

function normalizeText(value, maxLen = 1000) {
  return String(value || '')
    .trim()
    .slice(0, maxLen);
}

function normalizeMultilineText(value, maxLen = 4000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLen);
}

function normalizeTaxId(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 10);
}

function normalizeDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeQuantity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.floor(num));
}

function normalizeMoneyCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function buildSafeBuyer(rawBuyer) {
  const buyer = rawBuyer && typeof rawBuyer === 'object' ? rawBuyer : {};
  return {
    name: normalizeText(buyer.name, 240),
    taxId: normalizeTaxId(buyer.taxId),
    address: normalizeMultilineText(buyer.address, 600),
  };
}

function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Dodaj co najmniej jedną pozycję faktury.');
  }

  const items = rawItems.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {};
    const name = normalizeText(row.name, 240);
    const unit = normalizeText(row.unit, 10);
    const quantity = normalizeQuantity(row.quantity);
    const unitNetCents = normalizeMoneyCents(row.unitNetCents);

    if (!name) {
      throw new Error(`Pozycja ${index + 1}: podaj nazwę towaru lub usługi.`);
    }
    if (!ALLOWED_UNITS.has(unit)) {
      throw new Error(`Pozycja ${index + 1}: wybierz poprawną jednostkę.`);
    }

    return {
      lp: index + 1,
      name,
      unit,
      quantity,
      unitNetCents,
      totalNetCents: quantity * unitNetCents,
      vatRate: 'ZW',
      vatAmountLabel: '-',
    };
  });

  return items;
}

function computeTotals(items) {
  const netTotalCents = items.reduce((sum, item) => sum + normalizeMoneyCents(item.totalNetCents), 0);
  return {
    netTotalCents,
    grossTotalCents: netTotalCents,
    vatLabel: 'ZWOLNIONY',
  };
}

function parseInvoiceSequence(invoiceNumber, year, kind) {
  const safeYear = String(year || '');
  const value = String(invoiceNumber || '');
  const regexp =
    kind === 'correction'
      ? /^KOR\/(\d+)\/STRZELCA\.PL\/(\d{4})$/
      : /^(\d+)\/STRZELCA\.PL\/(\d{4})$/;
  const match = value.match(regexp);
  if (!match) return 0;
  if (match[2] !== safeYear) return 0;
  return parseInt(match[1], 10) || 0;
}

async function findExistingMaxInvoiceSequence(tx, db, year, kind) {
  const snapshot = await tx.get(db.collection(COLLECTION_NAME).select('invoiceNumber', 'kind'));
  let max = 0;
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if ((data.kind || 'invoice') !== kind) return;
    const current = parseInvoiceSequence(data.invoiceNumber, year, kind);
    if (current > max) max = current;
  });
  return max;
}

async function generateInvoiceNumber(db, year, kind) {
  const counterDocId = kind === 'correction' ? `invoice-corrections-${year}` : `invoices-${year}`;
  const counterRef = db.collection('systemCounters').doc(counterDocId);

  const nextNumber = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let current = counterSnap.exists ? Number(counterSnap.data()?.value || 0) : 0;

    if (!Number.isInteger(current) || current < 0) {
      current = 0;
    }

    if (!counterSnap.exists) {
      current = await findExistingMaxInvoiceSequence(tx, db, year, kind);
    }

    const next = current + 1;
    tx.set(
      counterRef,
      {
        value: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return next;
  });

  return kind === 'correction'
    ? `KOR/${nextNumber}/STRZELCA.PL/${year}`
    : `${nextNumber}/STRZELCA.PL/${year}`;
}

function getInvoiceSortTimestamp(invoice) {
  const candidates = [
    invoice?.createdAt,
    invoice?.issueDate,
    invoice?.updatedAt,
  ];
  for (const value of candidates) {
    if (typeof value?.toMillis === 'function') {
      try {
        return value.toMillis();
      } catch (_) {}
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const asDate = new Date(value);
      if (Number.isFinite(asDate.getTime())) return asDate.getTime();
    }
  }
  return 0;
}

function buildLinkedOrderSummary(orderData, orderId) {
  const parts = [
    normalizeText(orderData?.orderNumber, 80),
    normalizeText(orderData?.companyName, 120),
    normalizeText(
      [orderData?.firstName, orderData?.lastName].filter(Boolean).join(' '),
      160
    ),
    normalizeText(orderData?.email, 160),
    normalizeText(orderId, 80),
  ].filter(Boolean);

  return {
    orderId,
    orderNumber: normalizeText(orderData?.orderNumber, 80),
    label: parts.join(' • ').slice(0, 320),
  };
}

async function syncLinkedOrderReference(db, previousOrderId, nextOrderSummary, invoiceMeta) {
  const FieldValue = admin.firestore.FieldValue;
  const previousId = normalizeText(previousOrderId, 120);
  const nextId = normalizeText(nextOrderSummary?.orderId, 120);
  const groupId = normalizeText(invoiceMeta?.groupId, 120);

  if (previousId && previousId !== nextId) {
    const previousRef = db.collection('orders').doc(previousId);
    const previousSnap = await previousRef.get();
    if (previousSnap.exists) {
      const previousData = previousSnap.data() || {};
      if (!groupId || previousData.generatedInvoiceGroupId === groupId) {
        await previousRef.update({
          generatedInvoiceGroupId: FieldValue.delete(),
          generatedInvoiceId: FieldValue.delete(),
          generatedInvoiceNumber: FieldValue.delete(),
          generatedInvoiceStatus: FieldValue.delete(),
          generatedInvoiceKind: FieldValue.delete(),
          generatedInvoiceLinkedAt: FieldValue.delete(),
        }).catch(() => {});
      }
    }
  }

  if (!nextId) return;

  const nextRef = db.collection('orders').doc(nextId);
  await nextRef.set(
    {
      generatedInvoiceGroupId: groupId || '',
      generatedInvoiceId: normalizeText(invoiceMeta?.invoiceId, 120),
      generatedInvoiceNumber: normalizeText(invoiceMeta?.invoiceNumber, 120),
      generatedInvoiceStatus: normalizeText(invoiceMeta?.status, 32),
      generatedInvoiceKind: normalizeText(invoiceMeta?.kind, 32),
      generatedInvoiceLinkedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function serializeInvoice(docSnap) {
  const raw = {
    id: docSnap.id,
    ...(docSnap.data() || {}),
  };
  return firestoreValueToJsonable(raw);
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,POST,PUT,OPTIONS' });

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!['GET', 'POST', 'PUT'].includes(req.method)) {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  try {
    initAdmin();
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const canManage = await canManageInvoices(sessionUser.uid);
    if (!canManage) {
      res.status(403).json({ success: false, error: 'Forbidden - invoices admin only' });
      return;
    }

    const db = admin.firestore();

    if (req.method === 'GET') {
      const invoiceId = normalizeText(readInvoiceQueryParam(req, 'id'), 120);
      const linkedOrderId = normalizeText(readInvoiceQueryParam(req, 'orderId'), 120);
      const groupId = normalizeText(readInvoiceQueryParam(req, 'groupId'), 120);
      const status = normalizeText(readInvoiceQueryParam(req, 'status'), 32);
      const maxRows = Math.min(
        Math.max(parseInt(readInvoiceQueryParam(req, 'limit'), 10) || 500, 1),
        2000
      );

      if (invoiceId) {
        const singleDoc = await db.collection(COLLECTION_NAME).doc(invoiceId).get();
        if (!singleDoc.exists) {
          res.status(404).json({ success: false, error: 'Invoice not found' });
          return;
        }

        res.status(200).json({ success: true, data: serializeInvoice(singleDoc) });
        return;
      }

      let query = db.collection(COLLECTION_NAME).limit(maxRows);
      if (groupId) query = query.where('groupId', '==', groupId);
      if (linkedOrderId) query = query.where('linkedOrder.orderId', '==', linkedOrderId);
      if (status && ALLOWED_STATUSES.has(status)) query = query.where('status', '==', status);

      const snapshot = await query.get();
      const rows = snapshot.docs.map((docSnap) => serializeInvoice(docSnap));
      rows.sort((a, b) => getInvoiceSortTimestamp(b) - getInvoiceSortTimestamp(a));

      res.status(200).json({ success: true, data: rows });
      return;
    }

    if (req.method === 'POST') {
      const body = readJsonBody(req) || {};
      const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'invoice';
      const buyer = buildSafeBuyer(body.buyer);
      const items = sanitizeItems(body.items);
      const totals = computeTotals(items);
      const issueDate = normalizeDateInput(body.issueDate) || normalizeDateInput(Date.now());
      const saleDate = normalizeDateInput(body.saleDate) || issueDate;
      const status = ALLOWED_STATUSES.has(body.status) ? body.status : 'utworzona';
      const notes = normalizeMultilineText(body.notes, 3000);
      const linkedOrderId = normalizeText(body.linkedOrderId, 120);

      if (!buyer.name) {
        res.status(400).json({ success: false, error: 'Podaj nazwę lub imię i nazwisko nabywcy.' });
        return;
      }

      if (!buyer.address) {
        res.status(400).json({ success: false, error: 'Podaj adres nabywcy.' });
        return;
      }

      let linkedOrder = null;
      if (linkedOrderId) {
        const linkedOrderSnap = await db.collection('orders').doc(linkedOrderId).get();
        if (!linkedOrderSnap.exists) {
          res.status(400).json({ success: false, error: 'Wybrane zamówienie nie istnieje.' });
          return;
        }
        linkedOrder = buildLinkedOrderSummary(linkedOrderSnap.data(), linkedOrderSnap.id);
      }

      let originalInvoiceDoc = null;
      let originalInvoiceData = null;
      let correctionReason = '';
      let groupId = '';
      let originalInvoiceId = '';
      let originalInvoiceNumber = '';
      let sourceInvoiceId = '';
      let sourceInvoiceNumber = '';

      if (kind === 'correction') {
        sourceInvoiceId = normalizeText(body.sourceInvoiceId, 120);
        if (!sourceInvoiceId) {
          res.status(400).json({ success: false, error: 'Wybierz fakturę, do której tworzysz korektę.' });
          return;
        }

        originalInvoiceDoc = await db.collection(COLLECTION_NAME).doc(sourceInvoiceId).get();
        if (!originalInvoiceDoc.exists) {
          res.status(404).json({ success: false, error: 'Faktura źródłowa nie istnieje.' });
          return;
        }

        originalInvoiceData = originalInvoiceDoc.data() || {};
        groupId = normalizeText(originalInvoiceData.groupId || originalInvoiceDoc.id, 120);
        originalInvoiceId = normalizeText(
          originalInvoiceData.originalInvoiceId || originalInvoiceDoc.id,
          120
        );
        originalInvoiceNumber = normalizeText(
          originalInvoiceData.originalInvoiceNumber || originalInvoiceData.invoiceNumber,
          120
        );
        sourceInvoiceNumber = normalizeText(originalInvoiceData.invoiceNumber, 120);
        correctionReason = normalizeMultilineText(body.correctionReason, 1200);

        if (!correctionReason) {
          res.status(400).json({ success: false, error: 'Podaj przyczynę korekty.' });
          return;
        }
      }

      const currentYear = Number(String(issueDate).slice(0, 4)) || new Date().getFullYear();
      const invoiceNumber = await generateInvoiceNumber(db, currentYear, kind);
      const invoiceRef = db.collection(COLLECTION_NAME).doc();
      const createdAt = admin.firestore.FieldValue.serverTimestamp();

      const invoiceDoc = {
        kind,
        invoiceNumber,
        sequenceYear: currentYear,
        issueDate,
        saleDate,
        status,
        buyer,
        seller: FIXED_SELLER,
        items,
        totals,
        notes,
        linkedOrder,
        groupId: kind === 'correction' ? groupId : invoiceRef.id,
        originalInvoiceId: kind === 'correction' ? originalInvoiceId : invoiceRef.id,
        originalInvoiceNumber: kind === 'correction' ? originalInvoiceNumber : invoiceNumber,
        sourceInvoiceId: kind === 'correction' ? sourceInvoiceId : '',
        sourceInvoiceNumber: kind === 'correction' ? sourceInvoiceNumber : '',
        correctionReason: kind === 'correction' ? correctionReason : '',
        correctionCount: 0,
        createdBy: sessionUser.uid,
        updatedBy: sessionUser.uid,
        createdAt,
        updatedAt: createdAt,
        sentAt: status === 'wyslana' ? createdAt : null,
        cancelledAt: status === 'anulowana' ? createdAt : null,
      };

      await invoiceRef.set(invoiceDoc);

      if (kind === 'correction' && originalInvoiceDoc) {
        await originalInvoiceDoc.ref.set(
          {
            correctionCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (linkedOrder) {
        await syncLinkedOrderReference(db, '', linkedOrder, {
          groupId: invoiceDoc.groupId,
          invoiceId: invoiceRef.id,
          invoiceNumber,
          status,
          kind,
        });
      }

      const createdSnap = await invoiceRef.get();
      res.status(201).json({ success: true, data: serializeInvoice(createdSnap) });
      return;
    }

    if (req.method === 'PUT') {
      const body = readJsonBody(req) || {};
      const invoiceId = normalizeText(body.id, 120);
      if (!invoiceId) {
        res.status(400).json({ success: false, error: 'Invoice id is required.' });
        return;
      }

      const invoiceRef = db.collection(COLLECTION_NAME).doc(invoiceId);
      const invoiceSnap = await invoiceRef.get();
      if (!invoiceSnap.exists) {
        res.status(404).json({ success: false, error: 'Invoice not found' });
        return;
      }

      const current = invoiceSnap.data() || {};
      const currentStatus = normalizeText(current.status, 32) || 'utworzona';
      const nextStatus = ALLOWED_STATUSES.has(body.status) ? body.status : currentStatus;
      const isStatusOnlyUpdate = body.statusOnly === true;

      if (currentStatus !== 'utworzona' && !isStatusOnlyUpdate) {
        res.status(400).json({
          success: false,
          error: 'Tę fakturę można już tylko przełączać między statusami.',
        });
        return;
      }

      const updateData = {
        status: nextStatus,
        updatedBy: sessionUser.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (nextStatus === 'wyslana') {
        updateData.sentAt = admin.firestore.FieldValue.serverTimestamp();
      }
      if (nextStatus === 'anulowana') {
        updateData.cancelledAt = admin.firestore.FieldValue.serverTimestamp();
      }

      let nextLinkedOrder = current.linkedOrder || null;

      if (!isStatusOnlyUpdate) {
        const buyer = buildSafeBuyer(body.buyer);
        const items = sanitizeItems(body.items);
        const totals = computeTotals(items);
        const issueDate = normalizeDateInput(body.issueDate) || current.issueDate || normalizeDateInput(Date.now());
        const saleDate = normalizeDateInput(body.saleDate) || current.saleDate || issueDate;
        const notes = normalizeMultilineText(body.notes, 3000);

        if (!buyer.name || !buyer.address) {
          res.status(400).json({ success: false, error: 'Uzupełnij dane nabywcy.' });
          return;
        }

        let linkedOrder = null;
        const linkedOrderId = normalizeText(body.linkedOrderId, 120);
        if (linkedOrderId) {
          const linkedOrderSnap = await db.collection('orders').doc(linkedOrderId).get();
          if (!linkedOrderSnap.exists) {
            res.status(400).json({ success: false, error: 'Wybrane zamówienie nie istnieje.' });
            return;
          }
          linkedOrder = buildLinkedOrderSummary(linkedOrderSnap.data(), linkedOrderSnap.id);
        }

        updateData.issueDate = issueDate;
        updateData.saleDate = saleDate;
        updateData.buyer = buyer;
        updateData.items = items;
        updateData.totals = totals;
        updateData.notes = notes;
        updateData.linkedOrder = linkedOrder;
        nextLinkedOrder = linkedOrder;

        if ((current.kind || 'invoice') === 'correction') {
          const correctionReason = normalizeMultilineText(body.correctionReason, 1200);
          if (!correctionReason) {
            res.status(400).json({ success: false, error: 'Podaj przyczynę korekty.' });
            return;
          }
          updateData.correctionReason = correctionReason;
        }
      }

      await invoiceRef.set(updateData, { merge: true });

      await syncLinkedOrderReference(
        db,
        current.linkedOrder?.orderId || '',
        nextLinkedOrder,
        {
          groupId: normalizeText(current.groupId || invoiceId, 120),
          invoiceId,
          invoiceNumber: normalizeText(current.invoiceNumber, 120),
          status: nextStatus,
          kind: normalizeText(current.kind || 'invoice', 32),
        }
      );

      const updatedSnap = await invoiceRef.get();
      res.status(200).json({ success: true, data: serializeInvoice(updatedSnap) });
    }
  } catch (error) {
    console.error('admin-invoices error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to manage invoices',
    });
  }
};
