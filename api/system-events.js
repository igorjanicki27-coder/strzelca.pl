// =============================================================================
// API ZDARZEŃ SYSTEMOWYCH - strzelca.pl (Vercel Serverless)
// =============================================================================
// Obsługa zdarzeń systemowych: monitoring usług domeny
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
      // /api/system-events
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
      // /api/system-events/stats
      if (req.method === 'GET') {
        await handleGetStats(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'sites') {
      // /api/system-events/sites
      if (req.method === 'GET') {
        await handleGetSites(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'services') {
      // /api/system-events/services
      if (req.method === 'GET') {
        await handleGetServices(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('System Events API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// GET /api/system-events - pobiera zdarzenia systemowe
async function handleGetEvents(req, res, db) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type;
    const site = req.query.site;
    const service = req.query.service;
    const severity = req.query.severity;

    let events = await db.getSystemEvents(limit);

    // Filtrowanie
    if (type) {
      events = events.filter(event => event.type === type);
    }
    if (site) {
      events = events.filter(event => event.site === site);
    }
    if (service) {
      events = events.filter(event => event.service === service);
    }
    if (severity) {
      events = events.filter(event => event.severity === severity);
    }

    res.json({
      success: true,
      data: events,
      count: events.length
    });
  } catch (error) {
    console.error('Error getting system events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// POST /api/system-events - dodaje nowe zdarzenie systemowe
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

    const event = await db.addSystemEvent(eventData);

    res.json({
      success: true,
      data: event
    });
  } catch (error) {
    console.error('Error adding system event:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// DELETE /api/system-events - czyści wszystkie zdarzenia systemowe
async function handleClearEvents(req, res, db) {
  try {
    await db.clearSystemEvents();

    res.json({
      success: true,
      message: 'All system events cleared'
    });
  } catch (error) {
    console.error('Error clearing system events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/system-events/stats - statystyki zdarzeń systemowych
async function handleGetStats(req, res, db) {
  try {
    const events = await db.getSystemEvents(1000);

    const stats = {
      total: events.length,
      byType: {},
      bySite: {},
      byService: {},
      bySeverity: {},
      recent: events.slice(0, 10)
    };

    // Grupowanie po typach
    events.forEach(event => {
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
      if (event.site) {
        stats.bySite[event.site] = (stats.bySite[event.site] || 0) + 1;
      }
      if (event.service) {
        stats.byService[event.service] = (stats.byService[event.service] || 0) + 1;
      }
      if (event.severity) {
        stats.bySeverity[event.severity] = (stats.bySeverity[event.severity] || 0) + 1;
      }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting system events stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/system-events/sites - lista monitorowanych stron
async function handleGetSites(req, res, db) {
  try {
    // Lista stron do monitorowania (taka sama jak w admin panelu)
    const sites = [
      'strzelca.pl',
      'sklep.strzelca.pl',
      'bazar.strzelca.pl',
      'szkolenia.strzelca.pl',
      'wydarzenia.strzelca.pl',
      'blog.strzelca.pl',
      'pomoc.strzelca.pl',
      'dokumenty.strzelca.pl',
      'kontakt.strzelca.pl',
      'konto.strzelca.pl'
    ];

    res.json({
      success: true,
      data: sites
    });
  } catch (error) {
    console.error('Error getting sites:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/system-events/services - lista monitorowanych usług
async function handleGetServices(req, res, db) {
  try {
    const services = [
      { name: 'Baza danych', type: 'firestore', description: 'Baza danych Firestore' },
      { name: 'Logowanie', type: 'auth', description: 'System uwierzytelniania Firebase' },
      { name: 'Domena', type: 'domain', description: 'Domena główna strzelca.pl' }
    ];

    res.json({
      success: true,
      data: services
    });
  } catch (error) {
    console.error('Error getting services:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}