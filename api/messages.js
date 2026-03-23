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

/** Dozwolone MIME + limit binarny (Firestore ~1 MiB na dokument; base64 zwiększa rozmiar). */
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_MESSAGE_IMAGE_BYTES = 720 * 1024;

function stripBase64Payload(input) {
  const s = (input || '').toString().trim();
  const m = s.match(/^data:([a-z0-9.+/=-]+);base64,(.*)$/i);
  if (m) return m[2].replace(/\s/g, '');
  return s.replace(/\s/g, '');
}

function verifyImageMagicBytes(buf, mimeType) {
  if (!buf || buf.length < 12) return false;
  if (mimeType === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  if (mimeType === 'image/webp') {
    const riff = buf.toString('utf8', 0, 4);
    const webp = buf.toString('utf8', 8, 12);
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

/**
 * @returns {{ value: { mimeType: string, dataBase64: string } } | { error: string } | null}
 */
function normalizeImageAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mimeType = (raw.mimeType || raw.mimetype || '').toString().trim().toLowerCase();
  const dataBase64 = stripBase64Payload(raw.dataBase64 || raw.data);
  if (!mimeType || !dataBase64) return null;
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    return { error: 'Dozwolone są tylko obrazy JPEG, PNG lub WebP' };
  }
  let buf;
  try {
    buf = Buffer.from(dataBase64, 'base64');
  } catch {
    return { error: 'Nieprawidłowe kodowanie obrazu (base64)' };
  }
  if (!buf.length || buf.length > MAX_MESSAGE_IMAGE_BYTES) {
    return { error: 'Obraz jest zbyt duży (maks. ok. 720 KB po zapisaniu; skompresuj zdjęcie i spróbuj ponownie)' };
  }
  if (!verifyImageMagicBytes(buf, mimeType)) {
    return { error: 'Plik nie jest rozpoznany jako bezpieczny obraz (nagłówek nie zgadza się z typem MIME)' };
  }
  return { value: { mimeType, dataBase64: buf.toString('base64') } };
}

/** Lista wiadomości w panelu — bez base64 (unika 500 / limitu rozmiaru odpowiedzi przy wielu załącznikach). */
function trimMessagesForListResponse(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    const out = { ...msg };
    if (out.imageAttachment && typeof out.imageAttachment === 'object') {
      const att = out.imageAttachment;
      const hasData =
        typeof att.dataBase64 === 'string' && att.dataBase64.length > 0;
      out.imageAttachment = {
        mimeType: att.mimeType || att.mimetype || null,
        hasData,
      };
    }
    return out;
  });
}

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
        // Nie loguj jako error jeśli brakuje klucza publicznego - to jest normalne gdy SSO nie jest skonfigurowane
        // System automatycznie fallbackuje do Firebase Auth token verification
        if (e?.code !== 'SSO_KEY_MISSING') {
          console.debug('getSessionUser: Cookie SSO verification failed, trying Firebase Auth token', e?.message);
        }
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

/** Całkowite usuwanie wątków (DELETE /api/messages*) — tylko z panelu admina (nagłówek jak przy innych akcjach panelu). */
function requireAdminPanelForMessageDelete(req, res) {
  if (req.headers['x-admin-panel'] !== 'true') {
    res.status(403).json({
      success: false,
      error: 'Usuwanie wiadomości jest dozwolone tylko z panelu administracji',
    });
    return false;
  }
  return true;
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
      hasXAdminPanel: req.headers['x-admin-panel'] === 'true',
      body: req.method === 'POST' ? (typeof req.body === 'object' ? JSON.stringify(req.body).substring(0, 200) : 'not object') : undefined
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
        case 'DELETE':
          await handleDeleteMessages(req, res, db, { query, requesterUid, requesterIsAdmin });
          break;
        default:
          res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 1 && segs[0] === 'delete-admin-messages') {
      // /api/messages/delete-admin-messages - usuwa wszystkie wiadomości od "Administrator"
      if (req.method === 'DELETE') {
        await handleDeleteAdminMessages(req, res, db, { requesterUid, requesterIsAdmin });
      } else {
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
    } else if (segs.length === 3 && segs[0] === 'conversation' && (segs[2] === 'read' || segs[2] === 'unread')) {
      // /api/messages/conversation/:senderId/read lub /api/messages/conversation/:senderId/unread
      const senderId = segs[1];
      const action = segs[2];
      if (req.method === 'PUT') {
        await handleConversationReadStatus(req, res, db, senderId, action, { requesterUid, requesterIsAdmin });
      } else {
        res.status(405).json({ success: false, error: 'Method not allowed' });
      }
    } else if (segs.length === 3 && segs[0] === 'conversation' && (segs[2] === 'pin' || segs[2] === 'unpin')) {
      // /api/messages/conversation/:senderId/pin lub /api/messages/conversation/:senderId/unpin
      const senderId = segs[1];
      const action = segs[2];
      if (req.method === 'PUT') {
        await handleConversationPinStatus(req, res, db, senderId, action, { requesterUid, requesterIsAdmin });
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
          await handleUpdateStatus(req, res, db, messageId, { requesterUid, requesterIsAdmin });
        } else if (action === 'read') {
          await handleMarkRead(req, res, db, messageId, { requesterUid, requesterIsAdmin });
        } else if (action === 'unread') {
          await handleMarkUnread(req, res, db, messageId, { requesterUid, requesterIsAdmin });
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

    console.log('handleGetMessages: Fetching messages with options:', JSON.stringify(options, null, 2));
    const result = await db.getMessages(options);
    console.log('handleGetMessages: Result:', {
      messagesCount: result?.messages?.length || 0,
      total: result?.total || 0,
      firstMessage: result?.messages?.[0] ? {
        id: result.messages[0].id,
        senderId: result.messages[0].senderId,
        recipientId: result.messages[0].recipientId,
        content: result.messages[0].content?.substring(0, 50)
      } : null
    });

    const safeMessages = trimMessagesForListResponse(result?.messages || []);
    res.json({
      success: true,
      messagesCount: safeMessages.length,
      total: result?.total || 0,
      data: {
        ...result,
        messages: safeMessages,
      },
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

    const imgNorm = normalizeImageAttachment(messageData.imageAttachment);
    if (imgNorm && imgNorm.error) {
      return res.status(400).json({ success: false, error: imgNorm.error });
    }
    const imageAttachment = imgNorm && imgNorm.value ? imgNorm.value : null;

    const rawContent = (messageData.content || '').toString();
    let content = rawContent.trim().slice(0, 4000);
    if (imageAttachment && !content) {
      content = '[Zdjęcie]';
    }
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
      
      // Jeśli to formularz kontaktowy (senderType: 'contact_form'), ustaw flagi
      if (messageData.senderType === 'contact_form') {
        messageData.allowReply = false;
        messageData.isReadOnly = true;
      }
    }

    console.log('handlePostMessage: Adding message:', {
      content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
      senderId,
      senderName,
      recipientId,
      status: messageData.status || 'pending',
      categoryId: messageData.categoryId
    });
    const { imageAttachment: _discardUnvalidatedImage, ...messageDataRest } = messageData;
    const message = await db.addMessage({
      ...messageDataRest,
      content,
      senderId,
      senderName,
      recipientId,
      timestamp: Date.now(),
      ...(imageAttachment ? { imageAttachment } : {}),
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
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      requesterUid,
      requesterIsAdmin
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
async function handleUpdateStatus(req, res, db, messageId, { requesterUid, requesterIsAdmin }) {
  try {
    // Tylko admin może zmieniać status wiadomości
    if (!requesterIsAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden - admin only' });
    }

    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Status is required'
      });
    }

    const validStatuses = ['pending', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    console.log('handleUpdateStatus: Updating message status:', {
      messageId,
      status,
      requesterUid
    });

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

// PUT /api/messages/:id/unread - oznacza wiadomość jako nieprzeczytaną
async function handleMarkUnread(req, res, db, messageId, { requesterUid, requesterIsAdmin }) {
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
        console.error('Auth check unread failed:', e);
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
    }

    const success = await db.markAsUnread(messageId);

    if (success) {
      res.json({
        success: true,
        message: 'Message marked as unread'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
  } catch (error) {
    console.error('Error marking message as unread:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/conversation/:senderId/read lub /unread - oznacza całą konwersację jako przeczytaną/nieprzeczytaną
async function handleConversationReadStatus(req, res, db, senderId, action, { requesterUid, requesterIsAdmin }) {
  try {
    // Tylko admin może zmieniać status konwersacji
    if (!requesterIsAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden - admin only' });
    }

    const recipientId = 'admin'; // Konwersacje z adminem

    let result;
    if (action === 'read') {
      result = await db.markConversationAsRead(senderId, recipientId);
    } else if (action === 'unread') {
      result = await db.markConversationAsUnread(senderId, recipientId);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action. Must be "read" or "unread"' });
    }

    res.json({
      success: true,
      message: `Conversation marked as ${action}`,
      data: result
    });
  } catch (error) {
    console.error('Error marking conversation as read/unread:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// PUT /api/messages/conversation/:senderId/pin lub /unpin - przypina/odpina konwersację
async function handleConversationPinStatus(req, res, db, senderId, action, { requesterUid, requesterIsAdmin }) {
  try {
    // Tylko admin może przypinać/odpinać konwersacje
    if (!requesterIsAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden - admin only' });
    }

    const recipientId = 'admin'; // Konwersacje z adminem

    let result;
    if (action === 'pin') {
      result = await db.pinConversation(senderId, recipientId);
    } else if (action === 'unpin') {
      result = await db.unpinConversation(senderId, recipientId);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action. Must be "pin" or "unpin"' });
    }

    res.json({
      success: true,
      message: `Conversation ${action === 'pin' ? 'pinned' : 'unpinned'}`,
      data: result
    });
  } catch (error) {
    console.error('Error pinning/unpinning conversation:', error);
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

// DELETE /api/messages - usuwa wiadomości (dla admina)
async function handleDeleteMessages(req, res, db, { query, requesterUid, requesterIsAdmin }) {
  try {
    // Tylko admin może usuwać wiadomości
    if (!requesterIsAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden - admin only' });
    }
    if (!requireAdminPanelForMessageDelete(req, res)) return;

    const senderId = query.senderId;
    const recipientId = query.recipientId || 'admin';

    // Dla wiadomości od administratora (systemowych), senderId może być 'admin'
    if (!senderId && recipientId !== 'admin') {
      return res.status(400).json({ success: false, error: 'Missing required field: senderId' });
    }

    console.log('handleDeleteMessages: Deleting messages:', {
      senderId,
      recipientId,
      requesterUid
    });

    // Usuń wszystkie wiadomości między senderId a recipientId
    const dbInstance = await db.initializeFirebase();
    
    // Znajdź wszystkie wiadomości w obie strony
    let deletedCount = 0;
    
    // Specjalny przypadek: wiadomości od administratora do administratora (systemowe)
    if (senderId === 'admin' && recipientId === 'admin') {
      const adminMessagesQuery = dbInstance.collection('messages')
        .where('senderId', '==', 'admin')
        .where('recipientId', '==', 'admin');
      
      const adminSnapshot = await adminMessagesQuery.get();
      
      if (!adminSnapshot.empty) {
        // Firestore batch limit to 500, więc musimy przetwarzać w partiach
        const batchSize = 500;
        const docs = adminSnapshot.docs;
        
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = dbInstance.batch();
          const batchDocs = docs.slice(i, i + batchSize);
          
          batchDocs.forEach(doc => {
            batch.delete(doc.ref);
          });
          
          await batch.commit();
          deletedCount += batchDocs.length;
        }
        
        console.log('handleDeleteMessages: Deleted', deletedCount, 'admin system messages');
      }
    } else {
      // Standardowe usuwanie: wiadomości między użytkownikiem a adminem
      // Wiadomości od użytkownika do admina
      const messagesQuery1 = dbInstance.collection('messages')
        .where('senderId', '==', senderId)
        .where('recipientId', '==', recipientId);
      
      const snapshot1 = await messagesQuery1.get();
      
      if (!snapshot1.empty) {
        // Firestore batch limit to 500, więc musimy przetwarzać w partiach
        const batchSize = 500;
        const docs = snapshot1.docs;
        
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = dbInstance.batch();
          const batchDocs = docs.slice(i, i + batchSize);
          
          batchDocs.forEach(doc => {
            batch.delete(doc.ref);
          });
          
          await batch.commit();
          deletedCount += batchDocs.length;
        }
        
        console.log('handleDeleteMessages: Deleted', snapshot1.size, 'messages (user -> admin)');
      }
      
      // Wiadomości od admina do użytkownika
      const messagesQuery2 = dbInstance.collection('messages')
        .where('senderId', '==', recipientId)
        .where('recipientId', '==', senderId);
      
      const snapshot2 = await messagesQuery2.get();
      
      if (!snapshot2.empty) {
        // Firestore batch limit to 500, więc musimy przetwarzać w partiach
        const batchSize = 500;
        const docs = snapshot2.docs;
        
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = dbInstance.batch();
          const batchDocs = docs.slice(i, i + batchSize);
          
          batchDocs.forEach(doc => {
            batch.delete(doc.ref);
          });
          
          await batch.commit();
          deletedCount += batchDocs.length;
        }
        
        console.log('handleDeleteMessages: Deleted', snapshot2.size, 'messages (admin -> user)');
      }

      // Skrzynka Pomocy (user ↔ admin): dopnij brakujące warianty zapisu + usuń metadane konwersacji,
      // żeby u użytkownika w /api/messages/thread i w panelu zniknęła cała rozmowa.
      if (recipientId === 'admin' && senderId && senderId !== 'admin' && senderId !== 'anonymous') {
        const userUid = senderId;
        const batchSize = 500;

        // Odpowiedzi zapisane z senderId = rzeczywisty UID admina (np. stary widżet bez X-Admin-Panel)
        const adminUidSet = new Set([SUPERADMIN_UID]);
        try {
          const profSnap = await dbInstance.collection('userProfiles').where('role', '==', 'admin').get();
          profSnap.forEach((d) => {
            if (d.id) adminUidSet.add(d.id);
          });
        } catch (e) {
          console.warn('handleDeleteMessages: lista profili admin —', e?.message || e);
        }

        for (const adminUid of adminUidSet) {
          if (!adminUid || adminUid === userUid) continue;
          try {
            const snapAdm = await dbInstance
              .collection('messages')
              .where('senderId', '==', adminUid)
              .where('recipientId', '==', userUid)
              .get();
            if (snapAdm.empty) continue;
            const docs = snapAdm.docs;
            for (let i = 0; i < docs.length; i += batchSize) {
              const batch = dbInstance.batch();
              const batchDocs = docs.slice(i, i + batchSize);
              batchDocs.forEach((doc) => batch.delete(doc.ref));
              await batch.commit();
              deletedCount += batchDocs.length;
            }
            console.log(
              'handleDeleteMessages: Deleted',
              snapAdm.size,
              'messages (admin UID -> user)',
              adminUid,
            );
          } catch (e) {
            console.warn('handleDeleteMessages: admin UID sweep failed for', adminUid, e?.message || e);
          }
        }

        // Dokument konwersacji (grupowanie / piny) — bez tego część UI trzyma „martwy” wątek
        try {
          const convId = [userUid, 'admin'].sort().join('_');
          await dbInstance.collection('conversations').doc(convId).delete();
          console.log('handleDeleteMessages: Deleted conversations/', convId);
        } catch (e) {
          console.warn('handleDeleteMessages: conversations sorted id —', e?.message || e);
        }
        try {
          await dbInstance.collection('conversations').doc(userUid).delete();
          console.log('handleDeleteMessages: Deleted legacy conversations/', userUid);
        } catch (e) {
          /* brak dokumentu */
        }
      }
    }
    
    console.log('handleDeleteMessages: Total deleted:', deletedCount);
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: 'Messages deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting messages:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

// DELETE /api/messages/delete-admin-messages - usuwa wszystkie wiadomości od "Administrator" (na twardo)
async function handleDeleteAdminMessages(req, res, db, { requesterUid, requesterIsAdmin }) {
  try {
    // Tylko admin może usuwać wiadomości
    if (!requesterIsAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden - admin only' });
    }
    if (!requireAdminPanelForMessageDelete(req, res)) return;

    console.log('handleDeleteAdminMessages: Deleting all messages from Administrator');

    const dbInstance = await db.initializeFirebase();
    let deletedCount = 0;
    
    // Znajdź wszystkie wiadomości gdzie senderName === 'Administrator' lub senderId === 'admin'
    // Używamy wielu zapytań, ponieważ Firestore nie obsługuje OR w jednym zapytaniu
    
    // 1. Wiadomości gdzie senderName === 'Administrator'
    const adminNameQuery = dbInstance.collection('messages')
      .where('senderName', '==', 'Administrator');
    
    const adminNameSnapshot = await adminNameQuery.get();
    
    if (!adminNameSnapshot.empty) {
      const batchSize = 500;
      const docs = adminNameSnapshot.docs;
      
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = dbInstance.batch();
        const batchDocs = docs.slice(i, i + batchSize);
        
        batchDocs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        deletedCount += batchDocs.length;
      }
      
      console.log('handleDeleteAdminMessages: Deleted', adminNameSnapshot.size, 'messages with senderName=Administrator');
    }
    
    // 2. Wiadomości gdzie senderId === 'admin' i recipientId === 'admin' (systemowe)
    const adminSystemQuery = dbInstance.collection('messages')
      .where('senderId', '==', 'admin')
      .where('recipientId', '==', 'admin');
    
    const adminSystemSnapshot = await adminSystemQuery.get();
    
    if (!adminSystemSnapshot.empty) {
      const batchSize = 500;
      const docs = adminSystemSnapshot.docs;
      
      // Sprawdź, czy nie zostały już usunięte w poprzednim kroku
      const existingIds = new Set(adminNameSnapshot.docs.map(d => d.id));
      const newDocs = docs.filter(d => !existingIds.has(d.id));
      
      for (let i = 0; i < newDocs.length; i += batchSize) {
        const batch = dbInstance.batch();
        const batchDocs = newDocs.slice(i, i + batchSize);
        
        batchDocs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        deletedCount += batchDocs.length;
      }
      
      console.log('handleDeleteAdminMessages: Deleted', newDocs.length, 'additional admin system messages');
    }
    
    console.log('handleDeleteAdminMessages: Total deleted:', deletedCount);
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `Usunięto ${deletedCount} wiadomości od Administrator`
    });
  } catch (error) {
    console.error('Error deleting admin messages:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error.message || 'Unknown error')
    });
  }
}