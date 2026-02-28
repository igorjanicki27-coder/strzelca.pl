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

    // Konwertuj base64 na buffer
    const base64Data = file.replace(/^data:application\/pdf;base64,/, '');
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // Upload do Firebase Storage
    // Użyj jawnej nazwy bucketa z konfiguracji
    const projectId = process.env.FIREBASE_PROJECT_ID || "strzelca-pl";
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 
                         process.env.FIREBASE_STORAGE_BUCKET_NAME || 
                         process.env.GCLOUD_STORAGE_BUCKET ||
                         `${projectId}.appspot.com`;
    
    const bucket = admin.storage().bucket(storageBucket);
    const filePath = `invoices/${orderId}_${Date.now()}_${fileName}`;
    const fileRef = bucket.file(filePath);

    await fileRef.save(fileBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          orderId: orderId,
          uploadedBy: sessionUser.uid,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Ustaw uprawnienia do odczytu
    await fileRef.makePublic();

    // Pobierz publiczny URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    res.status(200).json({ 
      success: true, 
      url: publicUrl,
      fileName: fileName,
      message: 'Invoice uploaded successfully' 
    });
  } catch (error) {
    console.error('Error uploading invoice:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload invoice: ' + (error.message || 'Unknown error') 
    });
  }
};
