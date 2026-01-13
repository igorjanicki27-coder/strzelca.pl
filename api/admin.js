// =============================================================================
// API SYSTEMU ADMINISTRATORÓW dla Strzelca.pl (Vercel Serverless)
// =============================================================================
// Firebase-based admin authentication - no local SQL admin logic needed
// =============================================================================

const admin = require('firebase-admin');
const FirestoreDatabaseManager = require('../firestore-db');

let dbManager = null;
async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

// Serverless function handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
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