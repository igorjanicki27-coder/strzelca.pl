// =============================================================================
// API POBIERANIA FAKTUR - Firestore dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  getSessionUser,
} = require('./_sso-utils');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  
  try {
    initAdmin();
    const db = admin.firestore();
    const profileDoc = await db.collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    const profile = profileDoc.data();
    return profile?.role === 'admin';
  } catch (e) {
    console.error('Error checking admin status:', e);
    return false;
  }
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,OPTIONS' });
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
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

    const { orderId } = req.query;
    
    if (!orderId) {
      res.status(400).json({ success: false, error: 'orderId is required' });
      return;
    }

    const db = admin.firestore();
    
    // Pobierz zamówienie, aby sprawdzić uprawnienia
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const orderData = orderDoc.data();
    const isUserAdmin = await isAdmin(sessionUser.uid);
    
    // Użytkownik może pobrać fakturę tylko jeśli:
    // 1. Jest adminem, LUB
    // 2. To jego własne zamówienie
    if (!isUserAdmin && orderData.userId !== sessionUser.uid) {
      res.status(403).json({ success: false, error: 'Forbidden - you can only download invoices for your own orders' });
      return;
    }

    // Pobierz fakturę z Firestore
    const invoiceDoc = await db.collection('invoices').doc(orderId).get();
    if (!invoiceDoc.exists) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    const invoiceData = invoiceDoc.data();
    const fileData = invoiceData.fileData;
    const fileName = invoiceData.fileName || `invoice_${orderId}.pdf`;

    if (!fileData) {
      res.status(404).json({ success: false, error: 'Invoice file data not found' });
      return;
    }

    // Konwertuj base64 na buffer
    const fileBuffer = Buffer.from(fileData, 'base64');

    // Zwróć plik PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.status(200).send(fileBuffer);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to download invoice: ' + (error.message || 'Unknown error') 
    });
  }
};
