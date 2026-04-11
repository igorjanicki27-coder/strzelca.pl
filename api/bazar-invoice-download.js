const {
  initAdmin,
  admin,
  setCors,
  getSessionUser,
} = require('./_sso-utils');
const { getUserRoleProfile, canAccessBackofficeScope, isAdminRoleProfile } = require('./_moderation');
const { buildBazarInvoicePdfBuffer } = require('./_bazar-sales-invoice');

async function canManage(uid) {
  if (!uid) return false;
  const profile = await getUserRoleProfile(admin.firestore(), uid);
  return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, 'bazaar');
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    initAdmin();
    const db = admin.firestore();
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const invoiceId = String(req.query?.invoiceId || '').trim();
    if (!invoiceId) {
      return res.status(400).json({ success: false, error: 'invoiceId is required' });
    }
    const invoiceSnap = await db.collection('adminInvoices').doc(invoiceId).get();
    if (!invoiceSnap.exists) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
    const invoice = { id: invoiceSnap.id, ...(invoiceSnap.data() || {}) };
    const isManager = await canManage(sessionUser.uid);
    if (!isManager) {
      const purchaseId = String(invoice.linkedPurchase?.purchaseId || '').trim();
      if (!purchaseId) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const purchaseSnap = await db.collection('bazarTokenPurchases').doc(purchaseId).get();
      if (!purchaseSnap.exists || purchaseSnap.data()?.userId !== sessionUser.uid) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }
    const pdf = await buildBazarInvoicePdfBuffer(invoice);
    const fileName = `${String(invoice.invoiceNumber || invoice.id || 'faktura').replace(/[^\w.-]+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('bazar-invoice-download error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to download invoice',
    });
  }
};
