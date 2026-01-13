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



      // Tabela kategorii wiadomości
      `CREATE TABLE IF NOT EXISTS message_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6B7280',
        icon TEXT DEFAULT 'fa-circle',
        is_active BOOLEAN DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Dodanie kolumny category_id do tabeli messages
      `ALTER TABLE messages ADD COLUMN category_id INTEGER REFERENCES message_categories(id) DEFAULT 1`,

      // Tabela szybkich odpowiedzi
      `CREATE TABLE IF NOT EXISTS quick_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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


      `CREATE INDEX IF NOT EXISTS idx_activity_action ON user_activity(action)`
    ];

    for (const sql of tables) {
      try {
        await this.run(sql);
      } catch (error) {
        // Ignoruj błędy ALTER TABLE jeśli kolumna już istnieje
        if (!sql.includes('ALTER TABLE') || !error.message.includes('duplicate column')) {
          throw error;
        }
      }
    }

    // Dodaj domyślne kategorie jeśli nie istnieją
    await this.initializeDefaultCategories();

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


  // Aktualizacja statusu wiadomości
  async updateMessageStatus(messageId, status) {
    const sql = 'UPDATE messages SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const result = await this.run(sql, [status, messageId]);
    return result.changes > 0;
  }

  // Aktualizacja kategorii wiadomości
  async updateMessageCategory(messageId, categoryId) {
    const sql = 'UPDATE messages SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const result = await this.run(sql, [categoryId, messageId]);
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

  // Inicjalizacja domyślnych kategorii
  async initializeDefaultCategories() {
    const defaultCategories = [
      { name: 'Zamówienia', color: '#3B82F6', icon: 'fa-shopping-cart', sort_order: 1 },
      { name: 'Oferty', color: '#10B981', icon: 'fa-tag', sort_order: 2 },
      { name: 'Inne', color: '#6B7280', icon: 'fa-circle', sort_order: 3 }
    ];

    for (const category of defaultCategories) {
      await this.run(`
        INSERT OR IGNORE INTO message_categories (name, color, icon, sort_order)
        VALUES (?, ?, ?, ?)
      `, [category.name, category.color, category.icon, category.sort_order]);
    }
  }

  // Funkcje zarządzania kategoriami
  async getCategories() {
    return await this.all(`
      SELECT * FROM message_categories
      WHERE is_active = 1
      ORDER BY sort_order ASC, name ASC
    `);
  }

  async addCategory(categoryData) {
    const result = await this.run(`
      INSERT INTO message_categories (name, color, icon, sort_order)
      VALUES (?, ?, ?, ?)
    `, [categoryData.name, categoryData.color, categoryData.icon, categoryData.sort_order || 0]);

    return result.id;
  }

  async updateCategory(id, categoryData) {
    await this.run(`
      UPDATE message_categories
      SET name = ?, color = ?, icon = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [categoryData.name, categoryData.color, categoryData.icon, categoryData.sort_order || 0, id]);
  }

  async deleteCategory(id) {
    // Sprawdź czy kategoria jest używana
    const usage = await this.get(`
      SELECT COUNT(*) as count FROM messages WHERE category_id = ?
    `, [id]);

    if (usage.count > 0) {
      // Przenieś wiadomości do kategorii "Inne"
      const otherCategory = await this.get(`SELECT id FROM message_categories WHERE name = 'Inne'`);
      if (otherCategory) {
        await this.run(`UPDATE messages SET category_id = ? WHERE category_id = ?`, [otherCategory.id, id]);
      }
    }

    await this.run(`UPDATE message_categories SET is_active = 0 WHERE id = ?`, [id]);
  }

  // Zaktualizowana funkcja dodawania wiadomości z kategorią
  async addMessage(messageData) {
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      isRead: false,
      status: 'in_progress',
      hash: this.generateHash(messageData.content),
      category_id: messageData.category_id || 1, // Domyślnie "Inne"
      ...messageData
    };

    const sql = `
      INSERT INTO messages (
        id, senderId, senderName, senderEmail, senderType,
        recipientId, recipientType, topic, content, timestamp,
        isRead, status, hash, conversationType, category_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      message.conversationType || 'support_chat',
      message.category_id
    ];

    await this.run(sql, params);
    return message;
  }

  // Zaktualizowana funkcja pobierania wiadomości z kategoriami
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
      categoryId
    } = options;

    let sql = `
      SELECT m.*,
             COALESCE(c.name, 'Inne') as category_name,
             COALESCE(c.color, '#6B7280') as category_color,
             COALESCE(c.icon, 'fa-circle') as category_icon
      FROM messages m
      LEFT JOIN message_categories c ON m.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Filtry
    if (recipientId) {
      sql += ' AND m.recipientId = ?';
      params.push(recipientId);
    }

    if (categoryId) {
      sql += ' AND m.category_id = ?';
      params.push(categoryId);
    }

    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    }

    if (typeof isRead === 'boolean') {
      sql += ' AND m.isRead = ?';
      params.push(isRead ? 1 : 0);
    }

    if (dateFrom) {
      sql += ' AND m.timestamp >= ?';
      params.push(new Date(dateFrom).getTime());
    }

    if (dateTo) {
      sql += ' AND m.timestamp <= ?';
      params.push(new Date(dateTo).getTime() + (24 * 60 * 60 * 1000));
    }

    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      sql += ` AND (
        LOWER(m.content) LIKE ? OR
        LOWER(m.topic) LIKE ? OR
        LOWER(m.senderName) LIKE ? OR
        LOWER(m.senderEmail) LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Sortowanie i paginacja
    sql += ' ORDER BY m.timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = await this.all(sql, params);

    // Pobierz całkowitą liczbę dla paginacji
    const countSql = sql.replace('SELECT m.*', 'SELECT COUNT(*) as total').replace(' ORDER BY m.timestamp DESC LIMIT ? OFFSET ?', '');
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

  // Funkcja pobierania statystyk z kategoriami
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

    // Pobierz statystyki per kategoria
    const categoryStats = await this.all(`
      SELECT
        COALESCE(c.name, 'Inne') as category_name,
        COUNT(m.id) as total,
        SUM(CASE WHEN m.isRead = 0 THEN 1 ELSE 0 END) as unread
      FROM messages m
      LEFT JOIN message_categories c ON m.category_id = c.id
      WHERE m.recipientId = 'admin' AND m.status = 'in_progress'
      GROUP BY m.category_id
      ORDER BY c.sort_order ASC
    `);

    return {
      total: result.total || 0,
      unread: result.unread || 0,
      read: result.read || 0,
      inProgress: result.inProgress || 0,
      completed: result.completed || 0,
      categories: categoryStats
    };
  }

  // Metody obsługi szybkich odpowiedzi
  async getQuickReplies() {
    const sql = 'SELECT * FROM quick_replies ORDER BY updated_at DESC';
    const replies = await this.all(sql);
    return replies.map(reply => ({
      ...reply,
      created_at: new Date(reply.created_at).toISOString(),
      updated_at: new Date(reply.updated_at).toISOString()
    }));
  }

  async addQuickReply(replyData) {
    if (!replyData.title || !replyData.content) {
      throw new Error('Title and content are required');
    }

    const sql = `
      INSERT INTO quick_replies (title, content)
      VALUES (?, ?)
    `;

    const result = await this.run(sql, [replyData.title.trim(), replyData.content.trim()]);
    return { id: result.id, ...replyData };
  }

  async updateQuickReply(id, replyData) {
    if (!replyData.title || !replyData.content) {
      throw new Error('Title and content are required');
    }

    const sql = `
      UPDATE quick_replies
      SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const result = await this.run(sql, [replyData.title.trim(), replyData.content.trim(), id]);
    if (result.changes === 0) {
      throw new Error('Quick reply not found');
    }

    return { id, ...replyData };
  }

  async deleteQuickReply(id) {
    const sql = 'DELETE FROM quick_replies WHERE id = ?';
    const result = await this.run(sql, [id]);
    if (result.changes === 0) {
      throw new Error('Quick reply not found');
    }
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
