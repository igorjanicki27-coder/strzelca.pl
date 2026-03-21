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
  },
  'bazar_offer_submitted': {
    name: 'Bazar — oferta wystawiona (oczekuje na akceptację)',
    subject: 'Twoja oferta „{{offerTitle}}” została przesłana do moderacji — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Oferta przesłana do weryfikacji</h2>
  <p>Dzień dobry{{sellerGreeting}},</p>
  <p>Dziękujemy za wystawienie ogłoszenia w bazarku strzelca.pl. Twoja oferta <strong>{{offerTitle}}</strong> oczekuje na akceptację przez moderatora.</p>
  <p>Po zatwierdzeniu otrzymasz osobny e-mail. Status możesz też sprawdzić na stronie bazaru.</p>
  <p><a href="{{bazarUrl}}" style="color: #c19a6b;">Przejdź do bazaru</a></p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['sellerGreeting', 'offerTitle', 'bazarUrl', 'offerUrl']
  },
  'bazar_offer_approved': {
    name: 'Bazar — oferta zaakceptowana i opublikowana',
    subject: 'Twoja oferta „{{offerTitle}}” jest już widoczna — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Oferta została zaakceptowana</h2>
  <p>Dzień dobry{{sellerGreeting}},</p>
  <p>Twoje ogłoszenie <strong>{{offerTitle}}</strong> zostało zatwierdzone i jest widoczne na bazarku.</p>
  <p><a href="{{offerUrl}}" style="color: #c19a6b;">Zobacz ogłoszenie</a></p>
  <p>Oferta wygaśnie dnia <strong>{{expiresAt}}</strong> — przed tym terminem możesz ją odświeżyć w panelu „Moje oferty”.</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['sellerGreeting', 'offerTitle', 'offerUrl', 'expiresAt', 'bazarUrl']
  },
  'bazar_offer_expiring_soon': {
    name: 'Bazar — zbliża się koniec widoczności ogłoszenia',
    subject: 'Zbliża się wygaśnięcie oferty „{{offerTitle}}” — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Twoje ogłoszenie wkrótce wygaśnie</h2>
  <p>Dzień dobry{{sellerGreeting}},</p>
  <p>Oferta <strong>{{offerTitle}}</strong> przestanie być widoczna około <strong>{{expiresAt}}</strong> (za ok. {{daysLeft}} dni).</p>
  <p>Możesz przedłużyć widoczność, odświeżając ofertę w bazarku (po upływie wymaganego czasu od ostatniego odświeżenia).</p>
  <p><a href="{{offerUrl}}" style="color: #c19a6b;">Zobacz ogłoszenie</a> · <a href="{{bazarUrl}}" style="color: #c19a6b;">Moje oferty</a></p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['sellerGreeting', 'offerTitle', 'offerUrl', 'expiresAt', 'daysLeft', 'bazarUrl']
  },
  'bazar_offer_rejected': {
    name: 'Bazar — odrzucenie publikacji oferty',
    subject: 'Oferta „{{offerTitle}}” nie została opublikowana — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Oferta nie została zaakceptowana</h2>
  <p>Dzień dobry{{sellerGreeting}},</p>
  <p>Niestety ogłoszenie <strong>{{offerTitle}}</strong> nie spełnia obecnie wymagań regulaminu i nie zostało opublikowane.</p>
  <p><strong>Uzasadnienie:</strong> {{rejectionReason}}</p>
  <p>Możesz wystawić poprawioną ofertę lub skontaktować się z nami: kontakt@strzelca.pl</p>
  <p><a href="{{bazarUrl}}" style="color: #c19a6b;">Przejdź do bazaru</a></p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['sellerGreeting', 'offerTitle', 'rejectionReason', 'bazarUrl']
  },
  'bazar_offer_refreshed': {
    name: 'Bazar — pomyślne odświeżenie oferty',
    subject: 'Przedłużono widoczność oferty „{{offerTitle}}” — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Oferta została odświeżona</h2>
  <p>Dzień dobry{{sellerGreeting}},</p>
  <p>Widoczność ogłoszenia <strong>{{offerTitle}}</strong> została przedłużona. Nowy orientacyjny termin wygaśnięcia: <strong>{{expiresAt}}</strong>.</p>
  <p><a href="{{offerUrl}}" style="color: #c19a6b;">Zobacz ogłoszenie</a></p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['sellerGreeting', 'offerTitle', 'offerUrl', 'expiresAt', 'bazarUrl']
  },
  'newsletter_broadcast': {
    name: 'Newsletter — ramka HTML (treść z edytora)',
    subject: 'Aktualności strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto;">
  <div style="border-bottom: 2px solid #c19a6b; padding-bottom: 12px; margin-bottom: 20px;">
    <h1 style="color: #c19a6b; font-size: 22px; margin: 0;">strzelca.pl</h1>
    <p style="margin: 8px 0 0; color: #666; font-size: 13px;">Newsletter</p>
  </div>
  <div style="margin-bottom: 28px;">{{newsletterBody}}</div>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="font-size: 12px; color: #888;">Otrzymujesz tę wiadomość, ponieważ zapisałeś się na newsletter strzelca.pl.</p>
  <p style="font-size: 12px; color: #888;">Rezygnacja: <a href="{{unsubscribeUrl}}" style="color: #c19a6b;">wypisz się z newslettera</a></p>
  <p style="font-size: 12px; color: #888;">Kontakt: kontakt@strzelca.pl</p>
</body>
</html>`,
    variables: ['newsletterBody', 'unsubscribeUrl']
  },
  'account_blocked': {
    name: 'Konto — informacja o blokadzie',
    subject: 'Twoje konto na strzelca.pl zostało zablokowane',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Konto zablokowane</h2>
  <p>Dzień dobry{{userGreeting}},</p>
  <p>Twoje konto w serwisie strzelca.pl zostało zablokowane przez administratora.</p>
  <p><strong>Powód:</strong> {{blockReason}}</p>
  <p><strong>Zakres blokady:</strong> {{blockedUntilText}}</p>
  <p>W sprawie odwołania napisz na kontakt@strzelca.pl (podaj adres e-mail konta).</p>
  <p>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['userGreeting', 'blockReason', 'blockedUntilText', 'supportEmail']
  },
  'account_unblocked': {
    name: 'Konto — informacja o odblokowaniu',
    subject: 'Twoje konto na strzelca.pl zostało odblokowane',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Konto odblokowane</h2>
  <p>Dzień dobry{{userGreeting}},</p>
  <p>Twoje konto w serwisie strzelca.pl jest ponownie aktywne i możesz się zalogować.</p>
  <p>{{unblockContext}}</p>
  <p>Jeśli masz pytania: kontakt@strzelca.pl</p>
  <p>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['userGreeting', 'unblockContext', 'supportEmail']
  },
  'account_review_received': {
    name: 'Konto — nowa opinia na profilu',
    subject: 'Nowa opinia na Twoim profilu — strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Ktoś wystawił Ci opinię</h2>
  <p>Dzień dobry{{userGreeting}},</p>
  <p>Użytkownik <strong>{{raterName}}</strong> dodał opinię na Twoim profilu w serwisie strzelca.pl.</p>
  <p><strong>Ocena:</strong> {{ratingLabel}} <span style="letter-spacing:2px;color:#c19a6b;">{{ratingStars}}</span></p>
  <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #c19a6b;">
    <p style="margin:0 0 8px;font-size:12px;color:#666;">Treść opinii</p>
    <p style="margin:0;white-space:pre-wrap;">{{comment}}</p>
  </div>
  <p><a href="{{profileUrl}}" style="color: #c19a6b;">Zobacz swój profil</a></p>
  <p style="font-size:13px;color:#666;">W razie pytań: {{supportEmail}}</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['userGreeting', 'raterName', 'ratingLabel', 'ratingStars', 'comment', 'profileUrl', 'supportEmail']
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
