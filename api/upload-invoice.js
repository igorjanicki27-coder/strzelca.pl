// =============================================================================
// API UPLOADU FAKTUR - Firebase Storage dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require('./_sso-utils');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieName = getCookieName();
    const sessionCookie = cookies[cookieName];
    
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Cookie SSO verification failed', e?.message);
      }
    }
    
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.substring(7);
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.email_verified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Firebase Auth token verification failed', e?.message);
      }
    }
    
    return null;
  } catch (e) {
    console.debug('getSessionUser error:', e?.message || e);
    return null;
  }
}

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
  setCors(req, res, { methods: 'POST,OPTIONS' });
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
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

    const isUserAdmin = await isAdmin(sessionUser.uid);
    
    if (!isUserAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden - admin only' });
      return;
    }

    // Vercel przetwarza multipart/form-data automatycznie
    // Ale dla prostoty użyjmy base64 z body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    if (!body.file || !body.fileName || !body.orderId) {
      res.status(400).json({ success: false, error: 'file, fileName, and orderId are required' });
      return;
    }

    const { file, fileName, orderId } = body;

    // Konwertuj base64 na string (usuń prefix jeśli istnieje)
    const base64Data = file.replace(/^data:application\/pdf;base64,/, '');
    
    // Sprawdź rozmiar (Firestore ma limit ~1MB na pole, więc dla większych plików trzeba użyć zewnętrznego serwisu)
    const fileSizeBytes = Buffer.from(base64Data, 'base64').length;
    const maxSizeBytes = 900 * 1024; // ~900KB dla bezpieczeństwa (zostawiamy margines)
    
    if (fileSizeBytes > maxSizeBytes) {
      res.status(400).json({ 
        success: false, 
        error: `Plik jest za duży (${Math.round(fileSizeBytes / 1024)}KB). Maksymalny rozmiar: ${Math.round(maxSizeBytes / 1024)}KB. Użyj zewnętrznego serwisu do przechowywania większych plików.` 
      });
      return;
    }

    // Przechowuj fakturę w Firestore jako base64 (dla darmowej wersji Firebase)
    // Alternatywnie można użyć zewnętrznego serwisu jak Cloudinary, ImgBB, lub własnego hostingu
    const db = admin.firestore();
    const invoiceDoc = {
      orderId: orderId,
      fileName: fileName,
      fileData: base64Data, // Base64 string
      contentType: 'application/pdf',
      uploadedBy: sessionUser.uid,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      size: fileSizeBytes
    };

    // Zapisz w kolekcji invoices
    const invoiceRef = db.collection('invoices').doc(orderId);
    await invoiceRef.set(invoiceDoc);

    // Zaktualizuj zamówienie, aby wskazywało na fakturę
    try {
      const orderRef = db.collection('orders').doc(orderId);
      await orderRef.update({
        invoiceFile: `/api/download-invoice?orderId=${orderId}`
      });
    } catch (e) {
      console.warn('Could not update order with invoice file reference:', e);
      // Nie blokuj - faktura została zapisana
    }

    // URL do pobrania faktury przez API
    const downloadUrl = `${process.env.VERCEL_URL || 'https://strzelca.pl'}/api/download-invoice?orderId=${orderId}`;

    res.status(200).json({ 
      success: true, 
      url: downloadUrl,
      fileName: fileName,
      size: fileSizeBytes,
      message: 'Invoice uploaded successfully (stored in Firestore)' 
    });
  } catch (error) {
    console.error('Error uploading invoice:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload invoice: ' + (error.message || 'Unknown error') 
    });
  }
};
