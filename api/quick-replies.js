// =============================================================================
// API SYSTEMU SZYBKICH ODPOWIEDZI - strzelca.pl
// =============================================================================
// API endpoints dla zarządzania szablonami szybkich odpowiedzi
// =============================================================================

const DatabaseManager = require('../database');

// Inicjalizacja bazy danych
let dbManager = null;
async function initDatabase() {
  if (!dbManager) {
    dbManager = new DatabaseManager();
    await dbManager.initDatabase();
  }
  return dbManager;
}

// API endpoints dla szybkich odpowiedzi
const quickRepliesAPI = {
  // GET /api/quick-replies - Pobieranie wszystkich szablonów odpowiedzi
  async get(req, res) {
    try {
      const db = await initDatabase();
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
  },

  // POST /api/quick-replies - Dodawanie nowego szablonu odpowiedzi
  async post(req, res) {
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

      const db = await initDatabase();
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
  },

  // PUT /api/quick-replies/:id - Aktualizacja szablonu odpowiedzi
  async put(req, res) {
    try {
      const { id } = req.params;
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

      const db = await initDatabase();
      const updatedReply = await db.updateQuickReply(parseInt(id), { title, content });

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
  },

  // DELETE /api/quick-replies/:id - Usuwanie szablonu odpowiedzi
  async delete(req, res) {
    try {
      const { id } = req.params;

      const db = await initDatabase();
      const deleted = await db.deleteQuickReply(parseInt(id));

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
};

module.exports = quickRepliesAPI;