const PDFDocument = require('pdfkit');
const { admin } = require('./_sso-utils');

const COLLECTION_NAME = 'adminInvoices';
const FIXED_SELLER = {
  name: 'Igor Janicki',
  taxId: '8993047085',
  email: 'kontakt@strzelca.pl',
  addressLines: ['ul. Pultuska 20/9', '53-116 Wroclaw'],
};

function normalizeText(value, maxLen = 1000) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeTaxId(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeMoneyCents(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function formatCurrencyFromCents(cents) {
  const value = Math.max(0, Number(cents) || 0) / 100;
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseInvoiceSequence(invoiceNumber, year) {
  const match = String(invoiceNumber || '').match(/^(\d+)\/STRZELCA\.PL\/(\d{4})$/);
  if (!match) return 0;
  if (String(year) !== match[2]) return 0;
  return parseInt(match[1], 10) || 0;
}

async function findExistingMaxInvoiceSequence(tx, db, year) {
  const snapshot = await tx.get(db.collection(COLLECTION_NAME).select('invoiceNumber', 'kind'));
  let max = 0;
  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if ((data.kind || 'invoice') !== 'invoice') return;
    const current = parseInvoiceSequence(data.invoiceNumber, year);
    if (current > max) max = current;
  });
  return max;
}

async function generateInvoiceNumber(db, year) {
  const counterRef = db.collection('systemCounters').doc(`invoices-${year}`);
  const nextNumber = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let current = counterSnap.exists ? Number(counterSnap.data()?.value || 0) : 0;
    if (!Number.isInteger(current) || current < 0) current = 0;
    if (!counterSnap.exists) {
      current = await findExistingMaxInvoiceSequence(tx, db, year);
    }
    const next = current + 1;
    tx.set(
      counterRef,
      { value: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return next;
  });
  return `${nextNumber}/STRZELCA.PL/${year}`;
}

function buildInvoiceItemsForPurchase(purchase) {
  return [
    {
      lp: 1,
      name: normalizeText(
        `Pakiet tokenow Bazaru: ${purchase.packageLabel || `${purchase.tokens || 0} tokenow`}`,
        240,
      ),
      unit: 'szt.',
      quantity: 1,
      unitNetCents: normalizeMoneyCents(purchase.amountCents),
      totalNetCents: normalizeMoneyCents(purchase.amountCents),
      vatRate: 'ZW',
      vatAmountLabel: '-',
    },
  ];
}

function buildInvoiceTotals(items) {
  const netTotalCents = items.reduce((sum, item) => sum + normalizeMoneyCents(item.totalNetCents), 0);
  return {
    netTotalCents,
    grossTotalCents: netTotalCents,
    vatLabel: 'ZWOLNIONY',
  };
}

async function createBazarInvoiceDocument(db, purchase, buyer) {
  const now = new Date();
  const year = now.getFullYear();
  const invoiceNumber = await generateInvoiceNumber(db, year);
  const invoiceRef = db.collection(COLLECTION_NAME).doc();
  const items = buildInvoiceItemsForPurchase(purchase);
  const totals = buildInvoiceTotals(items);
  const issueDate = formatDateInput(now);
  const invoiceDoc = {
    invoiceNumber,
    kind: 'invoice',
    status: 'wyslana',
    seller: FIXED_SELLER,
    buyer: {
      name: normalizeText(buyer?.name || '', 240),
      taxId: normalizeTaxId(buyer?.taxId),
      address: normalizeText(buyer?.address || '', 600),
      email: normalizeText(buyer?.email || '', 160),
    },
    items,
    totals,
    issueDate,
    saleDate: issueDate,
    notes:
      'Sprzedaz tokenow do uslug premium Bazaru STRZELCA.PL. Sprzedawca korzysta ze zwolnienia z VAT. Dokument nie jest faktura VAT.',
    sellerSignatureDataUrl: '',
    linkedOrder: null,
    linkedPurchase: {
      purchaseId: normalizeText(purchase.id || '', 120),
      packageId: normalizeText(purchase.packageId || '', 80),
      packageLabel: normalizeText(purchase.packageLabel || '', 160),
      tokens: Math.max(1, parseInt(purchase.tokens, 10) || 1),
    },
    source: 'bazar_tokens',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await invoiceRef.set(invoiceDoc);
  const createdSnap = await invoiceRef.get();
  return { id: invoiceRef.id, ...(createdSnap.data() || {}) };
}

function renderPdfText(doc, text, x, y, opts = {}) {
  doc.font(opts.font || 'Helvetica').fontSize(opts.size || 10).fillColor(opts.color || '#111111');
  doc.text(String(text || ''), x, y, opts);
}

async function buildBazarInvoicePdfBuffer(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderPdfText(doc, 'FAKTURA ZWOLNIONA Z VAT', 48, 42, { font: 'Helvetica-Bold', size: 18 });
    renderPdfText(doc, `nr ${invoice.invoiceNumber || '—'}`, 48, 68, { font: 'Helvetica-Bold', size: 12 });
    renderPdfText(doc, `Data wystawienia: ${invoice.issueDate || '—'}`, 370, 48, { size: 10, align: 'right', width: 160 });
    renderPdfText(doc, `Data sprzedazy: ${invoice.saleDate || '—'}`, 370, 64, { size: 10, align: 'right', width: 160 });

    doc.moveTo(48, 92).lineTo(547, 92).strokeColor('#d4d4d8').stroke();

    renderPdfText(doc, 'Sprzedawca', 48, 108, { font: 'Helvetica-Bold', size: 11 });
    renderPdfText(
      doc,
      `${FIXED_SELLER.name}\nNIP: ${FIXED_SELLER.taxId}\n${FIXED_SELLER.email}\n${FIXED_SELLER.addressLines.join('\n')}`,
      48,
      126,
      { size: 10, width: 220 },
    );

    renderPdfText(doc, 'Nabywca', 315, 108, { font: 'Helvetica-Bold', size: 11 });
    renderPdfText(
      doc,
      `${invoice.buyer?.name || '—'}\n${invoice.buyer?.taxId ? `NIP: ${invoice.buyer.taxId}\n` : ''}${invoice.buyer?.address || '—'}`,
      315,
      126,
      { size: 10, width: 220 },
    );

    let top = 220;
    const tableCols = [48, 82, 330, 372, 430, 492];
    renderPdfText(doc, 'Lp.', tableCols[0], top, { font: 'Helvetica-Bold', size: 10 });
    renderPdfText(doc, 'Pozycja', tableCols[1], top, { font: 'Helvetica-Bold', size: 10, width: 240 });
    renderPdfText(doc, 'Ilosc', tableCols[2], top, { font: 'Helvetica-Bold', size: 10 });
    renderPdfText(doc, 'Cena', tableCols[3], top, { font: 'Helvetica-Bold', size: 10 });
    renderPdfText(doc, 'VAT', tableCols[4], top, { font: 'Helvetica-Bold', size: 10 });
    renderPdfText(doc, 'Wartosc', tableCols[5], top, { font: 'Helvetica-Bold', size: 10, width: 55, align: 'right' });
    top += 16;
    doc.moveTo(48, top).lineTo(547, top).strokeColor('#d4d4d8').stroke();
    top += 10;

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    items.forEach((item, idx) => {
      renderPdfText(doc, idx + 1, tableCols[0], top, { size: 10 });
      renderPdfText(doc, item.name || '—', tableCols[1], top, { size: 10, width: 235 });
      renderPdfText(doc, item.quantity || 1, tableCols[2], top, { size: 10 });
      renderPdfText(doc, `${formatCurrencyFromCents(item.unitNetCents || 0)} zl`, tableCols[3], top, { size: 10 });
      renderPdfText(doc, 'ZW', tableCols[4], top, { size: 10 });
      renderPdfText(doc, `${formatCurrencyFromCents(item.totalNetCents || 0)} zl`, tableCols[5], top, {
        size: 10,
        width: 55,
        align: 'right',
      });
      top += 22;
    });

    top += 8;
    doc.moveTo(48, top).lineTo(547, top).strokeColor('#d4d4d8').stroke();
    top += 20;
    renderPdfText(doc, 'Wartosc netto:', 350, top, { size: 10 });
    renderPdfText(doc, `${formatCurrencyFromCents(invoice.totals?.netTotalCents || 0)} zl`, 472, top, {
      font: 'Helvetica-Bold',
      size: 10,
      width: 75,
      align: 'right',
    });
    top += 16;
    renderPdfText(doc, 'VAT:', 350, top, { size: 10 });
    renderPdfText(doc, 'ZWOLNIONY', 472, top, { font: 'Helvetica-Bold', size: 10, width: 75, align: 'right' });
    top += 16;
    renderPdfText(doc, 'Do zaplaty:', 350, top, { font: 'Helvetica-Bold', size: 12 });
    renderPdfText(doc, `${formatCurrencyFromCents(invoice.totals?.grossTotalCents || 0)} zl`, 440, top, {
      font: 'Helvetica-Bold',
      size: 12,
      width: 107,
      align: 'right',
    });

    top += 34;
    renderPdfText(
      doc,
      'Sprzedawca korzysta ze zwolnienia z VAT. Dokument nie jest faktura VAT.',
      48,
      top,
      { size: 9, width: 500 },
    );
    top += 52;
    renderPdfText(doc, 'Sprzedawca', 48, top, { size: 10, color: '#52525b' });
    renderPdfText(doc, 'Nabywca', 315, top, { size: 10, color: '#52525b' });
    top += 28;
    doc.moveTo(48, top).lineTo(235, top).strokeColor('#18181b').stroke();
    doc.moveTo(315, top).lineTo(502, top).strokeColor('#18181b').stroke();
    top += 8;
    renderPdfText(doc, FIXED_SELLER.name, 48, top, { size: 10 });
    renderPdfText(doc, invoice.buyer?.name || '—', 315, top, { size: 10 });

    doc.end();
  });
}

module.exports = {
  FIXED_SELLER,
  createBazarInvoiceDocument,
  buildBazarInvoicePdfBuffer,
};
