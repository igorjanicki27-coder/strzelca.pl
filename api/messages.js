// =============================================================================
// API SYSTEMU WIADOMOŚCI - Firestore dla Strzelca.pl (Vercel Serverless)
// =============================================================================
// Ten plik obsługuje operacje na wiadomościach w bazie danych Firestore
// =============================================================================

const FirestoreDatabaseManager = require('../firestore-db');

let dbManager = null;

// Inicjalizacja bazy danych
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
      // /api/messages
      switch (req.method) {
        case 'GET':
          await handleGetMessages(req, res, db);
          break;
        case 'POST':
          await handlePostMessage(req, res, db);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'stats') {
      // /api/messages/stats
      if (req.method === 'GET') {
        await handleGetStats(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 2 && pathSegments[1] === 'categories') {
      // /api/messages/categories
      switch (req.method) {
        case 'GET':
          await handleGetCategories(req, res, db);
          break;
        case 'POST':
          await handleAddCategory(req, res, db);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 3 && pathSegments[1] === 'categories') {
      // /api/messages/categories/:id
      const categoryId = pathSegments[2];
      switch (req.method) {
        case 'PUT':
          await handleUpdateCategory(req, res, db, categoryId);
          break;
        case 'DELETE':
          await handleDeleteCategory(req, res, db, categoryId);
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 3) {
      // /api/messages/:id/:action
      const messageId = pathSegments[1];
      const action = pathSegments[2];

      if (req.method === 'PUT') {
        if (action === 'status') {
          await handleUpdateStatus(req, res, db, messageId);
        } else if (action === 'read') {
          await handleMarkRead(req, res, db, messageId);
        } else if (action === 'category') {
          await handleUpdateMessageCategory(req, res, db, messageId);
        } else {
          res.status(404).json({ success: false, error: 'Action not found' });
        }
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (pathSegments.length === 3 && pathSegments[1] === 'conversation' && pathSegments[2] === 'category') {
      // /api/messages/conversation/category
      if (req.method === 'PUT') {
        await handleUpdateConversationCategory(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else {
      res.status(404).json({ success: false, error: 'Endpoint not found' });
    }
  } catch (error) {
    console.error('Messages API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// GET /api/messages - pobiera wiadomości z opcjami filtrowania
async function handleGetMessages(req, res, db) {
  try {
    const options = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
      search: req.query.search || '',
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      status: req.query.status,
      isRead: req.query.isRead ? req.query.isRead === 'true' : undefined,
      recipientId: req.query.recipientId || 'admin',
      categoryId: req.query.categoryId
    };

    const result = await db.getMessages(options);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// POST /api/messages - dodaje nową wiadomość
async function handlePostMessage(req, res, db) {
  try {
    const messageData = req.body;

    // Walidacja wymaganych pól
    if (!messageData.content || !messageData.senderName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: content and senderName'
      });
    }

    const message = await db.addMessage(messageData);

    if (message) {
      res.json({
        success: true,
        data: message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save message'
      });
    }
  } catch (error) {
    console.error('Error adding message:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/:id/status - aktualizuje status wiadomości
async function handleUpdateStatus(req, res, db, messageId) {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const success = await db.updateMessageStatus(messageId, status);

    if (success) {
      res.json({
        success: true,
        message: 'Status updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
  } catch (error) {
    console.error('Error updating message status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/:id/read - oznacza wiadomość jako przeczytaną
async function handleMarkRead(req, res, db, messageId) {
  try {
    const success = await db.markAsRead(messageId);

    if (success) {
      res.json({
        success: true,
        message: 'Message marked as read'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/:id/category - aktualizuje kategorię wiadomości
async function handleUpdateMessageCategory(req, res, db, messageId) {
  try {
    const { categoryId } = req.body;

    if (!categoryId) {
      return res.status(400).json({
        success: false,
        error: 'Category ID is required'
      });
    }

    const success = await db.updateMessageCategory(messageId, categoryId);

    if (success) {
      res.json({
        success: true,
        message: 'Message category updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
  } catch (error) {
    console.error('Error updating message category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/messages/stats - pobiera statystyki wiadomości
async function handleGetStats(req, res, db) {
  try {
    const stats = await db.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting message stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// GET /api/messages/categories - pobiera wszystkie kategorie
async function handleGetCategories(req, res, db) {
  try {
    const categories = await db.getCategories();

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// POST /api/messages/categories - dodaje nową kategorię
async function handleAddCategory(req, res, db) {
  try {
    const categoryData = req.body;

    if (!categoryData.name) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required'
      });
    }

    const categoryId = await db.addCategory(categoryData);

    res.json({
      success: true,
      data: { id: categoryId, ...categoryData }
    });
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/categories/:id - aktualizuje kategorię
async function handleUpdateCategory(req, res, db, categoryId) {
  try {
    const categoryData = req.body;

    await db.updateCategory(categoryId, categoryData);

    res.json({
      success: true,
      message: 'Category updated successfully'
    });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// DELETE /api/messages/categories/:id - usuwa kategorię
async function handleDeleteCategory(req, res, db, categoryId) {
  try {
    await db.deleteCategory(categoryId);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/conversation/category - aktualizuje kategorię całej konwersacji
async function handleUpdateConversationCategory(req, res, db) {
  try {
    const { userId, categoryId } = req.body;

    if (!userId || !categoryId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Category ID are required'
      });
    }

    // Zaktualizuj kategorię całej konwersacji
    const success = await db.updateConversationCategory(userId, categoryId);

    if (success) {
      res.json({
        success: true,
        message: 'Conversation category updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update conversation category'
      });
    }
  } catch (error) {
    console.error('Error updating conversation category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}