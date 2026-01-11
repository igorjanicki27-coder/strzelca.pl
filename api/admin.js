// =============================================================================
// API SYSTEMU ADMINISTRATORÓW - SQLite dla Strzelca.pl
// =============================================================================
// Ten plik obsługuje operacje na administratorach w bazie danych SQLite
// =============================================================================

const DatabaseManager = require('../database');
const crypto = require('crypto');

let dbManager = null;

// Inicjalizacja bazy danych
async function initDatabase() {
  if (!dbManager) {
    dbManager = new DatabaseManager();
    await dbManager.initDatabase();
  }
  return dbManager;
}

// Funkcja hashowania używająca PBKDF2-SHA256 (Node.js crypto)
// Ta sama funkcja co w admin/index.html, ale przystosowana do Node.js
async function hashPassword(password, salt, iterations = 100000) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        const hashArray = Array.from(derivedKey);
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        resolve(hashHex);
      }
    });
  });
}

// API endpoints dla administratorów
const adminAPI = {
  // POST /api/admin/verify - weryfikuje dane logowania administratora
  async verify(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const db = await initDatabase();

      // Pobierz administratora z bazy danych
      const admin = await db.getAdministratorByUsername(username);

      if (!admin) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // Zahashuj wprowadzone dane używając soli z bazy danych
      const hashedLogin = await hashPassword(username, admin.login_salt);
      const hashedPassword = await hashPassword(password, admin.password_salt);

      // Sprawdź czy hashe się zgadzają
      if (hashedLogin === admin.login_hash && hashedPassword === admin.password_hash) {
        // Aktualizuj czas ostatniego logowania
        await db.updateAdministrator(admin.id, { last_login: Date.now() });

        return res.json({
          success: true,
          admin: {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            last_login: admin.last_login
          }
        });
      } else {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

    } catch (error) {
      console.error('Error verifying admin credentials:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // GET /api/admin/list - pobiera listę administratorów (tylko dla super adminów)
  async list(req, res) {
    try {
      const db = await initDatabase();

      const admins = await db.getAllAdministrators();

      res.json({
        success: true,
        data: admins
      });
    } catch (error) {
      console.error('Error getting administrators:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // POST /api/admin/create - tworzy nowego administratora
  async create(req, res) {
    try {
      const { username, password, role } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const db = await initDatabase();

      // Sprawdź czy administrator już istnieje
      const existingAdmin = await db.getAdministratorByUsername(username);
      if (existingAdmin) {
        return res.status(409).json({
          success: false,
          error: 'Administrator with this username already exists'
        });
      }

      // Wygeneruj nowe sole
      const loginSalt = crypto.randomBytes(32).toString('hex');
      const passwordSalt = crypto.randomBytes(32).toString('hex');

      // Zahashuj dane
      const loginHash = await hashPassword(username, loginSalt);
      const passwordHash = await hashPassword(password, passwordSalt);

      const adminData = {
        username,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        login_hash: loginHash,
        login_salt: loginSalt,
        role: role || 'admin',
        is_active: true
      };

      const admin = await db.createAdministrator(adminData);

      res.json({
        success: true,
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          created_at: admin.created_at
        }
      });
    } catch (error) {
      console.error('Error creating administrator:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
};

module.exports = adminAPI;
