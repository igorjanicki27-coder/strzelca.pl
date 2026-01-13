// =============================================================================
// API ZDARZEŃ UŻYTKOWNIKÓW - strzelca.pl (Vercel Serverless)
// =============================================================================
// Obsługa zdarzeń użytkowników: wiadomości, polubienia, aktywność na stronie
// =============================================================================

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
    if (pathSegments.length === 1) {
      // /api/user-events
      switch (req.method) {
        case 'GET':
          await handleGetEvents(req, res, db);
          break;
        case 'POST':
          await handlePostEvent(req, res, db);
          break;
        case 'DELETE':
          await handleClearEvents(req, res, db);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'stats') {
      // /api/user-events/stats
      if (req.method === 'GET') {
        await handleGetStats(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'types') {
      // /api/user-events/types
      if (req.method === 'GET') {
        await handleGetTypes(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 3 && pathSegments[1] === 'users') {
      // /api/user-events/users/:userId
      const userId = pathSegments[2];
      if (req.method === 'GET') {
        await handleGetUserEvents(req, res, db, userId);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('User Events API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// GET /api/user-events - pobiera zdarzenia użytkowników
async function handleGetEvents(req, res, db) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type;
    const userId = req.query.userId;
    const action = req.query.action;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    let events = await db.getUserEvents(limit);

    // Filtrowanie
    if (type) {
      events = events.filter(event => event.type === type);
    }
    if (userId) {
      events = events.filter(event => event.userId === userId);
    }
    if (action) {
      events = events.filter(event => event.action === action);
    }
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      events = events.filter(event => new Date(event.timestamp) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      events = events.filter(event => new Date(event.timestamp) <= toDate);
    }

    res.json({
      success: true,
      data: events,
      count: events.length
    });
  } catch (error) {
    console.error('Error getting user events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// POST /api/user-events - dodaje nowe zdarzenie użytkownika
async function handlePostEvent(req, res, db) {
  try {
    const eventData = req.body;

    // Walidacja wymaganych pól
    if (!eventData.type) {
      return res.status(400).json({
        success: false,
        error: 'Event type is required'
      });
    }

    const event = await db.addUserEvent(eventData);

    res.json({
      success: true,
      data: event
    });
  } catch (error) {
    console.error('Error adding user event:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// DELETE /api/user-events - czyści wszystkie zdarzenia użytkowników
async function handleClearEvents(req, res, db) {
  try {
    await db.clearUserEvents();

    res.json({
      success: true,
      message: 'All user events cleared'
    });
  } catch (error) {
    console.error('Error clearing user events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/user-events/stats - statystyki zdarzeń użytkowników
async function handleGetStats(req, res, db) {
  try {
    const events = await db.getUserEvents(1000);

    const stats = {
      total: events.length,
      byType: {},
      byUser: {},
      byAction: {},
      recent: events.slice(0, 10)
    };

    // Grupowanie po typach, użytkownikach i akcjach
    events.forEach(event => {
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
      if (event.userId) {
        stats.byUser[event.userId] = (stats.byUser[event.userId] || 0) + 1;
      }
      if (event.action) {
        stats.byAction[event.action] = (stats.byAction[event.action] || 0) + 1;
      }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting user events stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/user-events/types - lista typów zdarzeń
async function handleGetTypes(req, res, db) {
  try {
    // Lista typów zdarzeń użytkowników
    const types = [
      { name: 'Rejestracja', type: 'user_registration', description: 'Użytkownik się zarejestrował' },
      { name: 'Logowanie', type: 'user_login', description: 'Użytkownik się zalogował' },
      { name: 'Wiadomość', type: 'message_sent', description: 'Użytkownik wysłał wiadomość' },
      { name: 'Zakup', type: 'purchase', description: 'Użytkownik dokonał zakupu' },
      { name: 'Kontakt', type: 'contact_form', description: 'Użytkownik wypełnił formularz kontaktowy' },
      { name: 'Newsletter', type: 'newsletter_subscribe', description: 'Użytkownik zapisał się do newslettera' }
    ];

    res.json({
      success: true,
      data: types
    });
  } catch (error) {
    console.error('Error getting event types:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/user-events/users/:userId - zdarzenia konkretnego użytkownika
async function handleGetUserEvents(req, res, db, userId) {
  try {
    const limit = parseInt(req.query.limit) || 50;

    let events = await db.getUserEvents(limit * 2); // Pobieramy więcej żeby odfiltrować
    events = events.filter(event => event.userId === userId).slice(0, limit);

    res.json({
      success: true,
      data: events,
      count: events.length,
      userId: userId
    });
  } catch (error) {
    console.error('Error getting user events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}