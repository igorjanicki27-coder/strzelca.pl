// =============================================================================
// API SYSTEMU SZYBKICH ODPOWIEDZI - strzelca.pl (Vercel Serverless)
// =============================================================================
// API endpoints dla zarządzania szablonami szybkich odpowiedzi
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
      // /api/quick-replies
      switch (req.method) {
        case 'GET':
          await handleGetQuickReplies(req, res, db);
          break;
        case 'POST':
          await handlePostQuickReply(req, res, db);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2) {
      // /api/quick-replies/:id
      const replyId = pathSegments[1];
      switch (req.method) {
        case 'PUT':
          await handlePutQuickReply(req, res, db, replyId);
          break;
        case 'DELETE':
          await handleDeleteQuickReply(req, res, db, replyId);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('Quick Replies API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// GET /api/quick-replies - Pobieranie wszystkich szablonów odpowiedzi
async function handleGetQuickReplies(req, res, db) {
  try {
    const replies = await db.getQuickReplies();

    res.json({
      success: true,
      data: replies
    });
  } catch (error) {
    console.error('Error getting quick replies:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// POST /api/quick-replies - Dodawanie nowego szablonu odpowiedzi
async function handlePostQuickReply(req, res, db) {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required'
      });
    }

    if (title.trim().length === 0 || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Title and content cannot be empty'
      });
    }

    const newReply = await db.addQuickReply({ title, content });

    res.status(201).json({
      success: true,
      data: newReply
    });
  } catch (error) {
    console.error('Error creating quick reply:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/quick-replies/:id - Aktualizacja szablonu odpowiedzi
async function handlePutQuickReply(req, res, db, replyId) {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required'
      });
    }

    if (title.trim().length === 0 || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Title and content cannot be empty'
      });
    }

    const updatedReply = await db.updateQuickReply(replyId, { title, content });

    res.json({
      success: true,
      data: updatedReply
    });
  } catch (error) {
    console.error('Error updating quick reply:', error);

    if (error.message === 'Quick reply not found') {
      return res.status(404).json({
        success: false,
        error: 'Quick reply not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// DELETE /api/quick-replies/:id - Usuwanie szablonu odpowiedzi
async function handleDeleteQuickReply(req, res, db, replyId) {
  try {
    const deleted = await db.deleteQuickReply(replyId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Quick reply not found'
      });
    }

    res.json({
      success: true,
      message: 'Quick reply deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting quick reply:', error);

    if (error.message === 'Quick reply not found') {
      return res.status(404).json({
        success: false,
        error: 'Quick reply not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}