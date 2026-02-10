// =============================================================================
// API SYSTEMU WIADOMOŚCI - Firestore dla Strzelca.pl (Vercel Serverless)
// =============================================================================
// Ten plik obsługuje operacje na wiadomościach w bazie danych Firestore
// =============================================================================

const FirestoreDatabaseManager = require('../firestore-db');
const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  readJsonBody,
} = require('./_sso-utils');

let dbManager = null;

// Inicjalizacja bazy danych
async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';
const SUPPORT_SENDER_ID = 'admin';
const SUPPORT_SENDER_NAME = 'Pomoc STRZELCA.PL';

function normalizePathSegments(urlPathname) {
  let segs = urlPathname.split('/').filter(Boolean);
  // wspieramy oba warianty: /api/messages/... oraz /messages/... oraz /...
  if (segs[0] === 'api') segs = segs.slice(1);
  if (segs[0] === 'messages') segs = segs.slice(1);
  return segs;
}

function getQuery(req, urlObj) {
  if (req && req.query && typeof req.query === 'object') return req.query;
  const out = {};
  for (const [k, v] of urlObj.searchParams.entries()) out[k] = v;
  return out;
}

function getRoutedSegments({ urlObj, queryObj }) {
  // Vercel rewrite: /api/messages/<path> -> /api/messages?__path=<path>
  const raw = (queryObj?.__path ?? urlObj.searchParams.get('__path') ?? '').toString().trim();
  if (!raw) return normalizePathSegments(urlObj.pathname);
  return raw.split('/').filter(Boolean);
}

async function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieName = getCookieName();
    const sessionCookie = cookies[cookieName];
    
    // Próbuj najpierw cookie SSO
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Cookie SSO verification failed, trying Firebase Auth token', e?.message);
      }
    }
    
    // Fallback: spróbuj Firebase Auth ID token z nagłówka Authorization
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.substring(7);
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.email_verified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Firebase Auth token verification failed', e?.message);
      }
    }
    
    console.debug('getSessionUser: No valid session found', { 
      cookieName, 
      hasCookies: !!req.headers.cookie,
      hasAuthHeader: !!authHeader,
      cookieKeys: Object.keys(cookies)
    });
    return null;
  } catch (e) {
    console.debug('getSessionUser error:', e?.message || e);
    return null;
  }
}

async function isAdminOrSuperAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    initAdmin();
    const snap = await admin.firestore().collection('userProfiles').doc(uid).get();
    return snap.exists && snap.data()?.role === 'admin';
  } catch {
    return false;
  }
}

async function getDisplayNameForUid(uid) {
  if (!uid) return null;
  try {
    initAdmin();
    const snap = await admin.firestore().collection('userProfiles').doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return typeof d.displayName === 'string' ? d.displayName : null;
  } catch {
    return null;
  }
}

// Serverless function handler
module.exports = async (req, res) => {
  // CORS (wspiera cookie SSO między subdomenami)
  setCors(req, res, { methods: 'GET, POST, PUT, DELETE, OPTIONS' });

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const db = await initDatabase();

    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = getQuery(req, url);
    const segs = getRoutedSegments({ urlObj: url, queryObj: query });
    const sessionUser = await getSessionUser(req);
    const requesterUid = sessionUser?.uid || null;
    const requesterIsAdmin = await isAdminOrSuperAdmin(requesterUid);
    console.log('API request:', {
      method: req.method,
      path: req.url,
      requesterUid,
      requesterIsAdmin,
      hasXAdminPanel: req.headers['x-admin-panel'] === 'true'
    });

    // Ujednolicamy body (Vercel czasem daje string)
    if (req.body && typeof req.body !== 'object') {
      req.body = readJsonBody(req);
    }

    // Routing based on URL path
    if (segs.length === 0) {
      // /api/messages
      switch (req.method) {
        case 'GET':
          await handleGetMessages(req, res, db, { query, requesterUid, requesterIsAdmin });
          break;
        case 'POST':
          await handlePostMessage(req, res, db, { query, requesterUid, requesterIsAdmin });
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 1 && segs[0] === 'thread') {
      // /api/messages/thread?peerId=...&limit=...
      if (req.method === 'GET') {
        await handleGetThread(req, res, db, { query, requesterUid, requesterIsAdmin });
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 2 && segs[0] === 'conversation' && segs[1] === 'category') {
      // /api/messages/conversation/category  (NAPRAWA: wcześniej było nieosiągalne)
      if (req.method === 'PUT') {
        await handleUpdateConversationCategory(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 1 && segs[0] === 'stats') {
      // /api/messages/stats
      if (req.method === 'GET') {
        await handleGetStats(req, res, db);
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 1 && segs[0] === 'categories') {
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
    } else if (segs.length === 2 && segs[0] === 'categories') {
      // /api/messages/categories/:id
      const categoryId = segs[1];
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
    } else if (segs.length === 2) {
      // /api/messages/:id/:action
      const messageId = segs[0];
      const action = segs[1];

      if (req.method === 'PUT') {
        if (action === 'status') {
          await handleUpdateStatus(req, res, db, messageId);
        } else if (action === 'read') {
          await handleMarkRead(req, res, db, messageId, { requesterUid, requesterIsAdmin });
        } else if (action === 'category') {
          await handleUpdateMessageCategory(req, res, db, messageId);
        } else {
          res.status(404).json({ success: false, error: 'Action not found' });
        }
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
async function handleGetMessages(req, res, db, { query, requesterUid, requesterIsAdmin }) {
  try {
    const options = {
      limit: parseInt(query.limit) || 50,
      offset: parseInt(query.offset) || 0,
      search: query.search || '',
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      status: query.status,
      isRead: query.isRead ? query.isRead === 'true' : undefined,
      recipientId: query.recipientId || 'admin',
      senderId: query.senderId,
      categoryId: query.categoryId
    };

    console.log('handleGetMessages: Authorization check:', {
      requesterIsAdmin,
      requesterUid,
      recipientId: options.recipientId,
      senderId: options.senderId
    });
    
    // Autoryzacja (dla zalogowanych userów). Admin ma pełen dostęp jak dotychczas.
    if (!requesterIsAdmin) {
      // Jeśli user jest zalogowany: może czytać tylko swoje wiadomości / rozmowę z adminem.
      if (requesterUid) {
        if (options.senderId && options.senderId !== requesterUid && options.senderId !== 'admin') {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        if (options.recipientId && options.recipientId !== requesterUid && options.recipientId !== 'admin') {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        // Jeśli nie podano senderId, domyślnie ogranicz do usera przy odczycie skrzynki (żeby nie wyciągać całego /admin)
        if (!options.senderId && options.recipientId === 'admin') {
          options.senderId = requesterUid;
        }
      } else {
        // Niezalogowany: dopuszczamy tylko odczyt publiczny? Nie — trzymamy dotychczasowe zachowanie dla admin panelu.
        // Zwróć pusty wynik, żeby nie wyciekały dane.
        return res.status(200).json({ success: true, data: { messages: [], total: 0, limit: options.limit, offset: options.offset } });
      }
    }

    console.log('handleGetMessages: Fetching messages with options:', options);
    const result = await db.getMessages(options);
    console.log('handleGetMessages: Result:', {
      messagesCount: result?.messages?.length || 0,
      total: result?.total || 0
    });

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
async function handlePostMessage(req, res, db, { requesterUid, requesterIsAdmin }) {
  try {
    const messageData = req.body || {};

    const rawContent = (messageData.content || '').toString();
    const content = rawContent.trim().slice(0, 4000);
    if (!content) {
      return res.status(400).json({ success: false, error: 'Missing required field: content' });
    }

    // Jeśli zalogowany: wymuszamy senderId po sesji cookie, a senderName bierzemy z profilu (best-effort).
    // Jeśli niezalogowany: zostawiamy tryb "kontaktowy" (wymaga senderName), ale nie pozwalamy podszywać się pod usera.
    let senderId = messageData.senderId || 'anonymous';
    let senderName = messageData.senderName || null;
    let recipientId = messageData.recipientId || 'admin';

    if (requesterUid && !requesterIsAdmin) {
      senderId = requesterUid;
      senderName = (await getDisplayNameForUid(requesterUid)) || senderName || 'Użytkownik';
      // User może pisać tylko do admina (support) w tym endpointcie
      recipientId = 'admin';
    } else if (requesterUid && requesterIsAdmin) {
      // Admin: sprawdź czy wiadomość jest wysyłana z panelu administracyjnego
      // Jeśli tak, ustaw jako "Pomoc STRZELCA.PL", jeśli nie, jako zwykły użytkownik
      const isFromAdminPanel = req.headers['x-admin-panel'] === 'true' || 
                                messageData.fromAdminPanel === true ||
                                (req.headers.referer && req.headers.referer.includes('/admin/'));
      
      if (isFromAdminPanel) {
        // Z panelu administracyjnego: wysyłamy jako "Pomoc STRZELCA.PL"
        senderId = SUPPORT_SENDER_ID;
        senderName = SUPPORT_SENDER_NAME;
      } else {
        // Z widgetu: wysyłamy jako zwykły użytkownik (administrator)
        senderId = requesterUid;
        senderName = (await getDisplayNameForUid(requesterUid)) || senderName || 'Administrator';
      }
      
      recipientId = (messageData.recipientId || '').toString().trim();
      if (!recipientId) {
        return res.status(400).json({ success: false, error: 'Missing required field: recipientId' });
      }
    } else {
      // Niezalogowany: wymagamy senderName, recipientId zawsze admin, senderId nie może wyglądać jak UID
      if (!senderName || typeof senderName !== 'string' || senderName.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Missing required field: senderName' });
      }
      senderId = 'anonymous';
      recipientId = 'admin';
    }

    console.log('handlePostMessage: Adding message:', {
      content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
      senderId,
      senderName,
      recipientId,
      status: messageData.status || 'pending',
      categoryId: messageData.categoryId
    });
    const message = await db.addMessage({
      ...messageData,
      content,
      senderId,
      senderName,
      recipientId,
      timestamp: Date.now(),
    });
    console.log('handlePostMessage: Message added successfully:', message?.id);

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

// GET /api/messages/thread - pobiera wątek między requesterem a peerem (np. admin)
async function handleGetThread(req, res, db, { query, requesterUid, requesterIsAdmin }) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 100));
    const peerId = (query.peerId || 'admin').toString();

    // Kto jest userem "A" w wątku:
    // - zwykły user: zawsze requesterUid
    // - admin: może podać userId, żeby obejrzeć wątek konkretnego usera
    let userA = requesterUid;
    if (requesterIsAdmin && query.userId) {
      userA = query.userId.toString();
    }

    if (!userA) {
      // Dodaj więcej informacji diagnostycznych
      const cookies = req.headers.cookie || '';
      const hasCookie = cookies.includes(getCookieName());
      console.warn('handleGetThread: Not authenticated', {
        hasCookie,
        cookieName: getCookieName(),
        peerId,
        query: query
      });
      return res.status(401).json({ 
        success: false, 
        error: 'Not authenticated',
        debug: process.env.NODE_ENV === 'development' ? {
          hasCookie,
          cookieName: getCookieName()
        } : undefined
      });
    }

    if (!requesterIsAdmin) {
      // zwykły user nie może oglądać wątków innych niż swoje
      if (userA !== requesterUid) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      // i tylko z adminem w tym modelu
      if (peerId !== 'admin') {
        return res.status(400).json({ success: false, error: 'Unsupported peerId' });
      }
    }

    // Administrator może normalnie widzieć swoją konwersację z supportem w widgetcie
    // (w panelu administracyjnym używa innego endpointu)

    console.log('handleGetThread: Fetching messages', { userA, peerId, limit, requesterIsAdmin });
    
    // Walidacja: sprawdź czy db i getMessages istnieją
    if (!db || typeof db.getMessages !== 'function') {
      console.error('handleGetThread: db.getMessages is not available', { 
        hasDb: !!db, 
        dbType: typeof db,
        hasGetMessages: db && typeof db.getMessages === 'function'
      });
      return res.status(500).json({ 
        success: false, 
        error: 'Database not initialized' 
      });
    }
    
    const [aToB, bToA] = await Promise.all([
      db.getMessages({ senderId: userA, recipientId: peerId, limit }).catch(e => {
        console.error('Error getting messages aToB:', e);
        console.error('Error details:', { userA, peerId, error: e.message, stack: e.stack });
        return { messages: [] };
      }),
      db.getMessages({ senderId: peerId, recipientId: userA, limit }).catch(e => {
        console.error('Error getting messages bToA:', e);
        console.error('Error details:', { peerId, userA, error: e.message, stack: e.stack });
        return { messages: [] };
      }),
    ]);

    console.log('handleGetThread: Messages fetched', { 
      aToBCount: aToB?.messages?.length || 0, 
      bToACount: bToA?.messages?.length || 0 
    });

    const all = [...(aToB?.messages || []), ...(bToA?.messages || [])].sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));

    res.json({
      success: true,
      data: {
        messages: all,
        participantA: userA,
        participantB: peerId,
      },
    });
  } catch (error) {
    console.error('Error getting thread:', error);
    console.error('Error stack:', error.stack);
    console.error('Error context:', { requesterUid, requesterIsAdmin, query });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
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
async function handleMarkRead(req, res, db, messageId, { requesterUid, requesterIsAdmin }) {
  try {
    // Autoryzacja: recipient lub admin
    if (!requesterIsAdmin) {
      if (!requesterUid) return res.status(401).json({ success: false, error: 'Not authenticated' });
      try {
        initAdmin();
        const snap = await admin.firestore().collection('messages').doc(messageId).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: 'Message not found' });
        const d = snap.data() || {};
        if (d.recipientId !== requesterUid) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      } catch (e) {
        console.error('Auth check read failed:', e);
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
    }

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