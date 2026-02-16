// =============================================================================
// API SZABLONÓW MAILI - Firestore dla Strzelca.pl (Vercel Serverless)
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

async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

async function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieName = getCookieName();
    const sessionCookie = cookies[cookieName];
    
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        if (decoded?.uid) {
          return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
        }
      } catch (e) {
        console.debug('getSessionUser: Cookie SSO verification failed', e?.message);
      }
    }
    
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
    
    return null;
  } catch (e) {
    console.debug('getSessionUser error:', e?.message || e);
    return null;
  }
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  
  try {
    initAdmin();
    const db = admin.firestore();
    const profileDoc = await db.collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    const profile = profileDoc.data();
    return profile?.role === 'admin';
  } catch (e) {
    console.error('Error checking admin status:', e);
    return false;
  }
}

// Domyślne szablony
const defaultTemplates = {
  'order_created': {
    name: 'Utworzenie zamówienia',
    subject: 'Zamówienie {{orderNumber}} zostało utworzone - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zamówienie zostało utworzone</h2>
  <p>Dzień dobry,</p>
  <p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało utworzone.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> {{status}}</li>
    <li><strong>Data utworzenia:</strong> {{createdAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    {{#if notes}}<li><strong>Uwagi:</strong> {{notes}}</li>{{/if}}
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'status', 'createdAt', 'orderDetails', 'notes', 'total']
  },
  'order_status_zlozone': {
    name: 'Status: Złożone',
    subject: 'Status zamówienia {{orderNumber}} został zmieniony - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Status zamówienia został zmieniony</h2>
  <p>Dzień dobry,</p>
  <p>Status Twojego zamówienia <strong>{{orderNumber}}</strong> został zmieniony na <strong>Złożone</strong>.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> Złożone</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'updatedAt', 'orderDetails', 'total']
  },
  'order_status_realizacja': {
    name: 'Status: W realizacji',
    subject: 'Status zamówienia {{orderNumber}} został zmieniony - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Status zamówienia został zmieniony</h2>
  <p>Dzień dobry,</p>
  <p>Status Twojego zamówienia <strong>{{orderNumber}}</strong> został zmieniony na <strong>W realizacji</strong>.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> W realizacji</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'updatedAt', 'orderDetails', 'total']
  },
  'order_status_wyslane': {
    name: 'Status: Wysłane',
    subject: 'Status zamówienia {{orderNumber}} został zmieniony - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Status zamówienia został zmieniony</h2>
  <p>Dzień dobry,</p>
  <p>Status Twojego zamówienia <strong>{{orderNumber}}</strong> został zmieniony na <strong>Wysłane</strong>.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> Wysłane</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'updatedAt', 'orderDetails', 'total']
  },
  'order_status_zakonczone': {
    name: 'Status: Zakończone',
    subject: 'Zamówienie {{orderNumber}} zostało zakończone - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zamówienie zostało zakończone</h2>
  <p>Dzień dobry,</p>
  <p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało zakończone.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> Zakończone</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  {{#if invoiceFile}}
  <p><strong>Faktura:</strong> <a href="{{invoiceFile}}">Pobierz fakturę</a></p>
  {{/if}}
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'updatedAt', 'orderDetails', 'total', 'invoiceFile']
  },
  'contact_form_auto_reply': {
    name: 'Automatyczna odpowiedź - Formularz kontaktowy',
    subject: 'Dziękujemy za wiadomość - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Dziękujemy za wiadomość</h2>
  <p>Dzień dobry {{senderName}},</p>
  <p>Dziękujemy za kontakt. Otrzymaliśmy Twoją wiadomość i odpowiemy najszybciej jak to możliwe.</p>
  <h3>Twoja wiadomość:</h3>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
    <p><strong>Temat:</strong> {{topic}}</p>
    <p><strong>Treść:</strong></p>
    <p>{{message}}</p>
  </div>
  <p>Jeśli masz pilne pytania, możesz skontaktować się z nami bezpośrednio: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['senderName', 'topic', 'message']
  }
};

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,POST,PUT,OPTIONS' });
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    await initDatabase();
    const sessionUser = await getSessionUser(req);
    
    if (!sessionUser) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isUserAdmin = await isAdmin(sessionUser.uid);
    
    if (!isUserAdmin) {
      res.status(403).json({ success: false, error: 'Forbidden - admin only' });
      return;
    }

    const db = admin.firestore();

    // GET - lista szablonów
    if (req.method === 'GET') {
      const templatesRef = db.collection('emailTemplates');
      const snapshot = await templatesRef.get();
      
      const templates = {};
      
      // Załaduj istniejące szablony
      snapshot.forEach(doc => {
        templates[doc.id] = { id: doc.id, ...doc.data() };
      });

      // Utwórz domyślne szablony jeśli nie istnieją
      for (const [key, template] of Object.entries(defaultTemplates)) {
        if (!templates[key]) {
          const templateRef = templatesRef.doc(key);
          await templateRef.set({
            ...template,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          templates[key] = { id: key, ...template };
        }
      }

      res.status(200).json({ success: true, data: templates });
      return;
    }

    // PUT - aktualizacja szablonu
    if (req.method === 'PUT') {
      const body = readJsonBody(req);
      if (!body || !body.id) {
        res.status(400).json({ success: false, error: 'Template ID is required' });
        return;
      }

      const { id, name, subject, html } = body;

      if (!name || !subject || !html) {
        res.status(400).json({ success: false, error: 'name, subject, and html are required' });
        return;
      }

      const templateRef = db.collection('emailTemplates').doc(id);
      await templateRef.set({
        name,
        subject,
        html,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const updatedTemplate = await templateRef.get();
      res.status(200).json({ 
        success: true, 
        data: { id: updatedTemplate.id, ...updatedTemplate.data() } 
      });
      return;
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in email-templates API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + (error.message || 'Unknown error') 
    });
  }
};
