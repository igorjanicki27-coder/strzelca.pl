// =============================================================================
// API NEWSLETTER - strzelca.pl (Vercel Serverless)
// =============================================================================
// API endpoint dla wysyłania newslettera
// =============================================================================

const FirestoreDatabaseManager = require('../firestore-db');
const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  readJsonBody,
} = require('./_sso-utils');

let dbManager = null;

async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function isAdminOrSuperAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    const db = await initDatabase();
    const userDoc = await db.getUserProfile(uid);
    return userDoc?.role === 'admin';
  } catch {
    return false;
  }
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const cookieName = getCookieName('sso_session');
  const sessionToken = cookies[cookieName];
  if (!sessionToken) return null;
  try {
    return verifyLocalSessionJwt(sessionToken);
  } catch {
    return null;
  }
}

// Serverless function handler
module.exports = async (req, res) => {
  setCors(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    initAdmin();
    const db = await initDatabase();

    const sessionUser = getSessionUser(req);
    const requesterUid = sessionUser?.uid || null;
    const requesterIsAdmin = await isAdminOrSuperAdmin(requesterUid);

    if (!requesterIsAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized - Admin access required'
      });
    }

    // Ujednolicamy body (Vercel czasem daje string)
    if (req.body && typeof req.body !== 'object') {
      req.body = readJsonBody(req);
    }

    // Routing based on method
    switch (req.method) {
      case 'POST':
        await handlePostNewsletter(req, res, db, requesterUid);
        break;
      default:
        res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Newsletter API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// POST /api/newsletter - Dodawanie newslettera do kolejki wysyłki
async function handlePostNewsletter(req, res, db, requesterUid) {
  try {
    const {
      subject,
      content,
      subscribers,
      subscriberCount,
      senderName,
      senderEmail,
      sentBy
    } = req.body;

    // Walidacja wymaganych pól
    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        error: 'Subject and content are required'
      });
    }

    if (!subscribers || !Array.isArray(subscribers) || subscribers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Subscribers list is required and must not be empty'
      });
    }

    // Przygotuj dane newslettera
    const newsletterData = {
      subject: subject.trim(),
      content: content,
      subscribers: subscribers,
      subscriberCount: subscriberCount || subscribers.length,
      senderName: senderName || 'Administrator',
      senderEmail: senderEmail || 'admin@strzelca.pl',
      sentBy: sentBy || requesterUid,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Zapisz newsletter do kolekcji newsletterQueue
    const newsletterRef = await admin.firestore().collection('newsletterQueue').add(newsletterData);

    res.json({
      success: true,
      data: {
        id: newsletterRef.id,
        ...newsletterData,
        createdAt: new Date().toISOString(),
      }
    });
  } catch (error) {
    console.error('Error creating newsletter:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create newsletter: ' + error.message
    });
  }
}
