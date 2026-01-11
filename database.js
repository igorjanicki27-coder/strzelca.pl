// =============================================================================
// SYSTEM BAZY DANYCH - SQLite dla Strzelca.pl
// =============================================================================
// Zewnętrzna baza danych dla bezpiecznego przechowywania wiadomości
// =============================================================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseManager {
  constructor() {
    // Ścieżka do bazy danych - poza repozytorium Git
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../strzelca-data');
    this.dbPath = path.join(dataDir, 'strzelca.db');

    // Upewnij się, że katalog istnieje
    const fs = require('fs');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = null;
    this.initDatabase();
  }

  // Inicjalizacja bazy danych
  initDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }

        console.log('Connected to SQLite database');

        // Utwórz tabele jeśli nie istnieją
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  // Tworzenie tabel
  async createTables() {
    const tables = [
      // Tabela wiadomości
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        senderId TEXT NOT NULL,
        senderName TEXT NOT NULL,
        senderEmail TEXT,
        senderType TEXT DEFAULT 'user',
        recipientId TEXT NOT NULL,
        recipientType TEXT DEFAULT 'admin',
        topic TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        isRead BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'in_progress',
        hash TEXT,
        conversationType TEXT DEFAULT 'support_chat',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Indeksy dla wydajności
      `CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipientId)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(senderId, recipientId)`,

      // Tabela aktywności użytkowników (rozszerzona)
      `CREATE TABLE IF NOT EXISTS user_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        userEmail TEXT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        path TEXT,
        userAgent TEXT,
        ipAddress TEXT,
        sessionType TEXT DEFAULT 'standard',
        lastActivity INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tabela sesji (opcjonalnie)
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        data TEXT,
        expires_at INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tabela logów zdarzeń systemowych
      `CREATE TABLE IF NOT EXISTS system_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        site TEXT NOT NULL,
        details TEXT,
        severity TEXT DEFAULT 'info',
        resolved BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Indeksy dla system_events
      `CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(type)`,
      `CREATE INDEX IF NOT EXISTS idx_system_events_site ON system_events(site)`,
      `CREATE INDEX IF NOT EXISTS idx_system_events_severity ON system_events(severity)`,

      // Tabela administratorów (lokalnych)
      `CREATE TABLE IF NOT EXISTS administrators (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        login_salt TEXT NOT NULL,
        login_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        is_active BOOLEAN DEFAULT 1,
        last_login INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Dodatkowe indeksy dla user_activity
      `CREATE INDEX IF NOT EXISTS idx_activity_user_timestamp ON user_activity(userId, timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON user_activity(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_action ON user_activity(action)`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }

    console.log('Database tables created successfully');
  }

  // Wykonanie zapytania SQL bez zwracania wyników
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  // Wykonanie zapytania SELECT
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Wykonanie zapytania SELECT zwracającego wiele wierszy
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Dodanie nowej wiadomości
  async addMessage(messageData) {
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      isRead: false,
      status: 'in_progress',
      hash: this.generateHash(messageData.content),
      ...messageData
    };

    const sql = `
      INSERT INTO messages (
        id, senderId, senderName, senderEmail, senderType,
        recipientId, recipientType, topic, content, timestamp,
        isRead, status, hash, conversationType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      message.id,
      message.senderId,
      message.senderName,
      message.senderEmail,
      message.senderType || 'user',
      message.recipientId,
      message.recipientType || 'admin',
      message.topic,
      message.content,
      message.timestamp,
      message.isRead ? 1 : 0,
      message.status,
      message.hash,
      message.conversationType || 'support_chat'
    ];

    await this.run(sql, params);
    return message;
  }

  // Pobieranie wiadomości z filtrami
  async getMessages(options = {}) {
    const {
      limit = 50,
      offset = 0,
      search = '',
      dateFrom,
      dateTo,
      status,
      isRead,
      recipientId,
      senderId
    } = options;

    let sql = `
      SELECT * FROM messages
      WHERE 1=1
    `;
    const params = [];

    // Filtry
    if (recipientId) {
      sql += ' AND recipientId = ?';
      params.push(recipientId);
    }

    if (senderId) {
      sql += ' AND senderId = ?';
      params.push(senderId);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (typeof isRead === 'boolean') {
      sql += ' AND isRead = ?';
      params.push(isRead ? 1 : 0);
    }

    if (dateFrom) {
      sql += ' AND timestamp >= ?';
      params.push(new Date(dateFrom).getTime());
    }

    if (dateTo) {
      sql += ' AND timestamp <= ?';
      params.push(new Date(dateTo).getTime() + (24 * 60 * 60 * 1000));
    }

    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      sql += ` AND (
        LOWER(content) LIKE ? OR
        LOWER(topic) LIKE ? OR
        LOWER(senderName) LIKE ? OR
        LOWER(senderEmail) LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Sortowanie i paginacja
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = await this.all(sql, params);

    // Pobierz całkowitą liczbę dla paginacji
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total').replace(' ORDER BY timestamp DESC LIMIT ? OFFSET ?', '');
    const countParams = params.slice(0, -2); // Usuń limit i offset
    const countResult = await this.get(countSql, countParams);

    return {
      messages: messages.map(msg => ({
        ...msg,
        isRead: Boolean(msg.isRead)
      })),
      total: countResult.total,
      hasMore: offset + limit < countResult.total
    };
  }

  // Aktualizacja statusu wiadomości
  async updateMessageStatus(messageId, status) {
    const sql = 'UPDATE messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const result = await this.run(sql, [status, messageId]);
    return result.changes > 0;
  }

  // Oznaczanie wiadomości jako przeczytanej
  async markAsRead(messageId) {
    const sql = 'UPDATE messages SET isRead = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const result = await this.run(sql, [messageId]);
    return result.changes > 0;
  }

  // Generowanie hash dla wiadomości
  generateHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // Pobieranie statystyk
  async getStats() {
    const sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN isRead = 1 THEN 1 ELSE 0 END) as read,
        SUM(CASE WHEN isRead = 0 THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM messages
      WHERE recipientId = 'admin'
    `;

    const result = await this.get(sql);
    return {
      total: result.total || 0,
      unread: result.unread || 0,
      read: result.read || 0,
      inProgress: result.inProgress || 0,
      completed: result.completed || 0
    };
  }

  // Metody obsługi aktywności użytkowników
  async logUserActivity(activityData) {
    const activity = {
      userId: activityData.userId || 'anonymous',
      userEmail: activityData.userEmail || null,
      timestamp: activityData.timestamp ? new Date(activityData.timestamp).getTime() : Date.now(),
      action: activityData.action || 'page_view',
      path: activityData.path || '/',
      userAgent: activityData.userAgent || null,
      ipAddress: activityData.ip || activityData.ipAddress || null,
      sessionType: activityData.sessionType || 'standard',
      lastActivity: Date.now(),
      ...activityData
    };

    const sql = `
      INSERT OR REPLACE INTO user_activity
      (userId, userEmail, timestamp, action, path, userAgent, ipAddress, sessionType, lastActivity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      activity.userId,
      activity.userEmail,
      activity.timestamp,
      activity.action,
      activity.path,
      activity.userAgent,
      activity.ipAddress,
      activity.sessionType,
      activity.lastActivity
    ];

    await this.run(sql, params);
    return activity;
  }

  async getUserActivityStats() {
    const sql = `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT CASE WHEN userId != 'anonymous' AND userId NOT LIKE 'guest%' THEN userId END) as loggedIn,
        COUNT(DISTINCT CASE WHEN userId = 'anonymous' OR userId LIKE 'guest%' THEN userId END) as guests
      FROM user_activity
      WHERE timestamp > ?
    `;

    // Ostatnie 30 minut
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    const result = await this.get(sql, [thirtyMinutesAgo]);

    return {
      loggedIn: result.loggedIn || 0,
      guests: result.guests || 0,
      total: result.total || 0
    };
  }

  async getUserActivitySessions(options = {}) {
    const {
      limit = 50,
      offset = 0,
      userId,
      action,
      dateFrom,
      dateTo
    } = options;

    let sql = `
      SELECT * FROM user_activity
      WHERE timestamp > ?
    `;
    const params = [Date.now() - (30 * 60 * 1000)]; // Ostatnie 30 minut

    // Filtry
    if (userId) {
      sql += ' AND userId = ?';
      params.push(userId);
    }

    if (action) {
      sql += ' AND action = ?';
      params.push(action);
    }

    if (dateFrom) {
      sql += ' AND timestamp >= ?';
      params.push(new Date(dateFrom).getTime());
    }

    if (dateTo) {
      sql += ' AND timestamp <= ?';
      params.push(new Date(dateTo).getTime());
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const activities = await this.all(sql, params);

    return activities.map(activity => ({
      ...activity,
      timestamp: new Date(activity.timestamp).toISOString(),
      lastActivity: new Date(activity.lastActivity).toISOString()
    }));
  }

  async getUserSession(userId) {
    const sql = `
      SELECT * FROM user_activity
      WHERE userId = ? AND timestamp > ?
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    const session = await this.get(sql, [userId, thirtyMinutesAgo]);

    if (session) {
      return {
        ...session,
        timestamp: new Date(session.timestamp).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        isActive: true
      };
    }

    return null;
  }

  async cleanupOldActivities(daysOld = 30) {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const sql = 'DELETE FROM user_activity WHERE timestamp < ?';
    const result = await this.run(sql, [cutoffTime]);
    return result.changes;
  }

  // Metody obsługi logów zdarzeń systemowych
  async logSystemEvent(eventData) {
    const event = {
      id: eventData.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: eventData.timestamp ? new Date(eventData.timestamp).getTime() : Date.now(),
      type: eventData.type || 'info',
      site: eventData.site || 'System',
      details: eventData.details || '',
      severity: eventData.severity || 'info',
      resolved: eventData.resolved || false,
      ...eventData
    };

    const sql = `
      INSERT INTO system_events
      (id, timestamp, type, site, details, severity, resolved)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      event.id,
      event.timestamp,
      event.type,
      event.site,
      event.details,
      event.severity,
      event.resolved ? 1 : 0
    ];

    await this.run(sql, params);
    return event;
  }

  async getSystemEvents(options = {}) {
    const {
      limit = 100,
      offset = 0,
      type,
      site,
      severity,
      resolved,
      dateFrom,
      dateTo
    } = options;

    let sql = 'SELECT * FROM system_events WHERE 1=1';
    const params = [];

    // Filtry
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    if (site) {
      sql += ' AND site = ?';
      params.push(site);
    }

    if (severity) {
      sql += ' AND severity = ?';
      params.push(severity);
    }

    if (typeof resolved === 'boolean') {
      sql += ' AND resolved = ?';
      params.push(resolved ? 1 : 0);
    }

    if (dateFrom) {
      sql += ' AND timestamp >= ?';
      params.push(new Date(dateFrom).getTime());
    }

    if (dateTo) {
      sql += ' AND timestamp <= ?';
      params.push(new Date(dateTo).getTime());
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const events = await this.all(sql, params);

    return events.map(event => ({
      ...event,
      timestamp: new Date(event.timestamp).toISOString(),
      resolved: Boolean(event.resolved)
    }));
  }

  async updateSystemEvent(eventId, updates) {
    const fields = [];
    const params = [];

    if (updates.resolved !== undefined) {
      fields.push('resolved = ?');
      params.push(updates.resolved ? 1 : 0);
    }

    if (updates.details !== undefined) {
      fields.push('details = ?');
      params.push(updates.details);
    }

    if (updates.severity !== undefined) {
      fields.push('severity = ?');
      params.push(updates.severity);
    }

    if (fields.length === 0) return false;

    const sql = `
      UPDATE system_events
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    params.push(eventId);

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  async cleanupOldSystemEvents(daysOld = 90) {
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const sql = 'DELETE FROM system_events WHERE timestamp < ?';
    const result = await this.run(sql, [cutoffTime]);
    return result.changes;
  }

  // Metody obsługi administratorów
  async createAdministrator(adminData) {
    const admin = {
      id: adminData.id || `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username: adminData.username,
      password_hash: adminData.password_hash,
      password_salt: adminData.password_salt,
      login_salt: adminData.login_salt,
      login_hash: adminData.login_hash,
      role: adminData.role || 'admin',
      is_active: adminData.is_active !== undefined ? adminData.is_active : true,
      last_login: null,
      ...adminData
    };

    const sql = `
      INSERT INTO administrators
      (id, username, password_hash, password_salt, login_salt, login_hash, role, is_active, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      admin.id,
      admin.username,
      admin.password_hash,
      admin.password_salt,
      admin.login_salt,
      admin.login_hash,
      admin.role,
      admin.is_active ? 1 : 0,
      admin.last_login
    ];

    await this.run(sql, params);
    return admin;
  }

  async getAdministratorByUsername(username) {
    const sql = 'SELECT * FROM administrators WHERE username = ? AND is_active = 1';
    const admin = await this.get(sql, [username]);

    if (admin) {
      return {
        ...admin,
        is_active: Boolean(admin.is_active)
      };
    }

    return null;
  }

  async verifyAdministratorCredentials(username, password_hash, login_hash) {
    const sql = 'SELECT * FROM administrators WHERE username = ? AND is_active = 1';
    const admin = await this.get(sql, [username]);

    if (!admin) {
      return null;
    }

    // Sprawdź czy hashe się zgadzają
    if (admin.password_hash === password_hash && admin.login_hash === login_hash) {
      // Aktualizuj czas ostatniego logowania
      const updateSql = 'UPDATE administrators SET last_login = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      await this.run(updateSql, [Date.now(), admin.id]);

      return {
        ...admin,
        is_active: Boolean(admin.is_active)
      };
    }

    return null;
  }

  async getAllAdministrators() {
    const sql = 'SELECT id, username, role, is_active, last_login, created_at, updated_at FROM administrators ORDER BY created_at DESC';
    const admins = await this.all(sql);

    return admins.map(admin => ({
      ...admin,
      is_active: Boolean(admin.is_active),
      last_login: admin.last_login ? new Date(admin.last_login).toISOString() : null,
      created_at: new Date(admin.created_at).toISOString(),
      updated_at: new Date(admin.updated_at).toISOString()
    }));
  }

  async updateAdministrator(id, updates) {
    const fields = [];
    const params = [];

    if (updates.username !== undefined) {
      fields.push('username = ?');
      params.push(updates.username);
    }

    if (updates.password_hash !== undefined) {
      fields.push('password_hash = ?');
      params.push(updates.password_hash);
    }

    if (updates.password_salt !== undefined) {
      fields.push('password_salt = ?');
      params.push(updates.password_salt);
    }

    if (updates.login_salt !== undefined) {
      fields.push('login_salt = ?');
      params.push(updates.login_salt);
    }

    if (updates.login_hash !== undefined) {
      fields.push('login_hash = ?');
      params.push(updates.login_hash);
    }

    if (updates.role !== undefined) {
      fields.push('role = ?');
      params.push(updates.role);
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }

    if (fields.length === 0) return false;

    const sql = `
      UPDATE administrators
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    params.push(id);

    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  async deleteAdministrator(id) {
    const sql = 'DELETE FROM administrators WHERE id = ?';
    const result = await this.run(sql, [id]);
    return result.changes > 0;
  }

  // Zamykanie połączenia z bazą danych
  close() {
    if (this.db) {
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

module.exports = DatabaseManager;
