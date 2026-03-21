// =============================================================================
// API SYSTEMU ADMINISTRATORÓW dla Strzelca.pl (Vercel Serverless)
// =============================================================================
// Firebase-based admin authentication - no local SQL admin logic needed
// =============================================================================

const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
} = require('./_sso-utils');

// Przed firestore-db: pełna inicjalizacja Admin SDK + klucze SSO (cookie __session)
initAdmin();

const FirestoreDatabaseManager = require('../firestore-db');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

let dbManager = null;
async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

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
        console.debug('admin API: cookie SSO verification failed', e?.message);
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
        console.debug('admin API: Firebase ID token verification failed', e?.message);
      }
    }

    return null;
  } catch (e) {
    console.debug('admin API getSessionUser:', e?.message || e);
    return null;
  }
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;

  try {
    initAdmin();
    const profileDoc = await admin.firestore().collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    const profile = profileDoc.data();
    return profile?.role === 'admin';
  } catch (e) {
    console.error('admin API isAdmin:', e);
    return false;
  }
}

/** Zwraca użytkownika sesji albo kończy odpowiedź 401/403. */
async function requireAdmin(req, res) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  if (!(await isAdmin(sessionUser.uid))) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  return sessionUser;
}

// Serverless function handler
module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET, OPTIONS' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const authed = await requireAdmin(req, res);
    if (!authed) return;

    const db = await initDatabase();

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // Routing based on URL path
    if (pathSegments.length === 3 && pathSegments[1] === 'activity-logs') {
      // /api/admin/activity-logs
      if (req.method === 'GET') {
        await handleGetActivityLogs(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 5 && pathSegments[1] === 'stats' && pathSegments[2] === 'contact-forms-today') {
      // /api/admin/stats/contact-forms-today
      if (req.method === 'GET') {
        await handleGetContactFormsToday(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 5 && pathSegments[1] === 'stats' && pathSegments[2] === 'pending-tasks') {
      // /api/admin/stats/pending-tasks
      if (req.method === 'GET') {
        await handleGetPendingTasks(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// GET /api/admin/activity-logs - pobiera logi aktywności
async function handleGetActivityLogs(req, res, db) {
  try {
    const limit = parseInt(req.query.limit) || 10;

    // Na razie zwracamy przykładowe dane
    const mockLogs = [
      {
        id: '1',
        type: 'admin_login',
        action: 'Admin login',
        details: 'Administrator logged in via Firebase',
        timestamp: new Date().toISOString(),
        adminId: 'firebase-admin'
      },
      {
        id: '2',
        type: 'dashboard_view',
        action: 'Dashboard viewed',
        details: 'Administrator viewed dashboard',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        adminId: 'firebase-admin'
      }
    ].slice(0, limit);

    res.json({
      success: true,
      logs: mockLogs
    });
  } catch (error) {
    console.error('Error getting activity logs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/admin/stats/contact-forms-today - statystyki formularzy kontaktowych na dzisiaj
async function handleGetContactFormsToday(req, res, db) {
  try {
    // Pobierz liczbę formularzy kontaktowych z dzisiaj
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // W Firestore używamy timestamp range queries
    const messagesRef = db.db.collection('messages');
    const snapshot = await messagesRef
      .where('recipientId', '==', 'admin')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(today))
      .where('timestamp', '<', admin.firestore.Timestamp.fromDate(tomorrow))
      .get();

    const count = snapshot.size;

    res.json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error('Error getting contact forms count:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/admin/stats/pending-tasks - liczba oczekujących zadań
async function handleGetPendingTasks(req, res, db) {
  try {
    // Pobierz liczbę oczekujących zadań (wiadomości w statusie 'in_progress')
    const messagesRef = db.db.collection('messages');
    const snapshot = await messagesRef
      .where('recipientId', '==', 'admin')
      .where('status', '==', 'in_progress')
      .get();

    const count = snapshot.size;

    res.json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error('Error getting pending tasks count:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}