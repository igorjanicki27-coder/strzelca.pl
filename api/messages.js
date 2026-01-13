// =============================================================================
// API SYSTEMU WIADOMOŚCI - SQLite dla Strzelca.pl
// =============================================================================
// Ten plik obsługuje operacje na wiadomościach w bazie danych SQLite
// =============================================================================

const DatabaseManager = require('../database');

let dbManager = null;

// Inicjalizacja bazy danych
async function initDatabase() {
  if (!dbManager) {
    dbManager = new DatabaseManager();
    await dbManager.initDatabase();
  }
  return dbManager;
}

// API endpoints dla wiadomości
const messagesAPI = {
  // GET /api/messages - pobiera wiadomości z opcjami filtrowania
  async get(req, res) {
    try {
      const db = await initDatabase();

      const options = {
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        search: req.query.search || '',
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        status: req.query.status,
        isRead: req.query.isRead ? req.query.isRead === 'true' : undefined,
        recipientId: req.query.recipientId || 'admin', // Domyślnie tylko do admina
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
  },

  // POST /api/messages - dodaje nową wiadomość
  async post(req, res) {
    try {
      const db = await initDatabase();
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
  },

  // PUT /api/messages/:id/status - aktualizuje status wiadomości
  async updateStatus(req, res) {
    try {
      const db = await initDatabase();
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required'
        });
      }

      const success = await db.updateMessageStatus(id, status);

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
  },

  // PUT /api/messages/:id/read - oznacza wiadomość jako przeczytaną
  async markRead(req, res) {
    try {
      const db = await initDatabase();
      const { id } = req.params;

      const success = await db.markAsRead(id);

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
  },

  // PUT /api/messages/:id/category - aktualizuje kategorię wiadomości
  async updateCategory(req, res) {
    try {
      const db = await initDatabase();
      const { id } = req.params;
      const { categoryId } = req.body;

      if (!categoryId) {
        return res.status(400).json({
          success: false,
          error: 'Category ID is required'
        });
      }

      const success = await db.updateMessageCategory(id, categoryId);

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
  },

  // GET /api/messages/stats - pobiera statystyki wiadomości
  async getStats(req, res) {
    try {
      const db = await initDatabase();
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
  },

  // GET /api/message-categories - pobiera wszystkie kategorie
  async getCategories(req, res) {
    try {
      const db = await initDatabase();
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
  },

  // POST /api/message-categories - dodaje nową kategorię
  async addCategory(req, res) {
    try {
      const db = await initDatabase();
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
  },

  // PUT /api/message-categories/:id - aktualizuje kategorię
  async updateCategory(req, res) {
    try {
      const db = await initDatabase();
      const { id } = req.params;
      const categoryData = req.body;

      await db.updateCategory(id, categoryData);

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
  },

  // DELETE /api/message-categories/:id - usuwa kategorię
  async deleteCategory(req, res) {
    try {
      const db = await initDatabase();
      const { id } = req.params;

      await db.deleteCategory(id);

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
};

module.exports = messagesAPI;

