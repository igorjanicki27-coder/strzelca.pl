// =============================================================================
// API SYSTEMU ADMINISTRATORÓW dla Strzelca.pl
// =============================================================================
// Firebase-based admin authentication - no local SQL admin logic needed
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

// API endpoints dla administratorów (Firebase-based)
const adminAPI = {
  // GET /api/admin/activity-logs - pobiera logi aktywności
  async getActivityLogs(req, res) {
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
  },

  // GET /api/admin/stats/contact-forms-today - statystyki formularzy kontaktowych na dzisiaj
  async getContactFormsToday(req, res) {
    try {
      const db = await initDatabase();

      // Pobierz liczbę formularzy kontaktowych z dzisiaj
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const sql = 'SELECT COUNT(*) as count FROM messages WHERE timestamp >= ? AND timestamp < ? AND recipientId = "admin"';
      const result = await db.get(sql, [today.getTime(), tomorrow.getTime()]);

      res.json({
        success: true,
        count: result.count || 0
      });
    } catch (error) {
      console.error('Error getting contact forms count:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // GET /api/admin/stats/pending-tasks - liczba oczekujących zadań
  async getPendingTasks(req, res) {
    try {
      const db = await initDatabase();

      // Pobierz liczbę oczekujących zadań (wiadomości w statusie 'in_progress')
      const sql = 'SELECT COUNT(*) as count FROM messages WHERE status = "in_progress" AND recipientId = "admin"';
      const result = await db.get(sql);

      res.json({
        success: true,
        count: result.count || 0
      });
    } catch (error) {
      console.error('Error getting pending tasks count:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

};

module.exports = adminAPI;
