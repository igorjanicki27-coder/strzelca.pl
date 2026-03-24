// =============================================================================
// API SZABLONÓW MAILI - Firestore dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const FirestoreDatabaseManager = require('../firestore-db');
const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
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
  'order_status_anulowane': {
    name: 'Status: Anulowane',
    subject: 'Zamówienie {{orderNumber}} zostało anulowane - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zamówienie zostało anulowane</h2>
  <p>Dzień dobry,</p>
  <p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało anulowane.</p>
  {{#if cancellationReason}}
  <p><strong>Powód anulowania:</strong> {{cancellationReason}}</p>
  {{/if}}
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> Anulowane</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
    </body>
</html>`,
    variables: ['orderNumber', 'cancellationReason', 'updatedAt', 'orderDetails', 'total']
  },
  'order_status_wycena_zlozona': {
    name: 'Status: Wycena złożona',
    subject: 'Wycena dla zamówienia {{orderNumber}} jest gotowa - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Wycena jest gotowa</h2>
  <p>Dzień dobry,</p>
  <p>Dla zamówienia <strong>{{orderNumber}}</strong> przygotowaliśmy wycenę.</p>
  <p>W swoim profilu możesz ją teraz <strong>zaakceptować</strong> albo <strong>odrzucić</strong>.</p>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> Wycena złożona</li>
    <li><strong>Kwota:</strong> {{total}} zł</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
  </ul>
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Przejdź do profilu</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'total', 'updatedAt', 'dashboardUrl']
  },
  'order_status_wycena_zaakceptowana': {
    name: 'Status: Wycena zaakceptowana',
    subject: 'Wycena dla zamówienia {{orderNumber}} została zaakceptowana - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #16a34a;">Wycena zaakceptowana</h2>
  <p>Dzień dobry,</p>
  <p>Potwierdziliśmy akceptację wyceny dla zamówienia <strong>{{orderNumber}}</strong>.</p>
  <p>Akceptacja wyceny jest wiążąca i oznacza zobowiązanie do opłacenia zamówienia.</p>
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'dashboardUrl']
  },
  'order_status_wycena_odrzucona': {
    name: 'Status: Wycena odrzucona',
    subject: 'Wycena dla zamówienia {{orderNumber}} została odrzucona - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #dc2626;">Wycena odrzucona</h2>
  <p>Dzień dobry,</p>
  <p>Wycena dla zamówienia <strong>{{orderNumber}}</strong> została odrzucona.</p>
  {{#if quoteRejectedReason}}
  <p><strong>Powód odrzucenia:</strong> {{quoteRejectedReason}}</p>
  {{/if}}
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'quoteRejectedReason', 'dashboardUrl']
  },
  'order_status_oczekuje_na_platnosc': {
    name: 'Status: Oczekuje na płatność',
    subject: 'Zamówienie {{orderNumber}} oczekuje na płatność - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Oczekiwanie na płatność</h2>
  <p>Dzień dobry,</p>
  <p>Dla zamówienia <strong>{{orderNumber}}</strong> możesz już przejść do opłacenia zamówienia w swoim profilu.</p>
  {{#if paymentUrl}}
  <p><a href="{{paymentUrl}}" style="color:#c19a6b;">Przejdź do płatności</a></p>
  {{/if}}
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Otwórz profil</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'paymentUrl', 'dashboardUrl']
  },
  'order_status_weryfikowanie_platnosci': {
    name: 'Status: Weryfikowanie płatności',
    subject: 'Płatność za zamówienie {{orderNumber}} jest weryfikowana - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Weryfikowanie płatności</h2>
  <p>Dzień dobry,</p>
  <p>Otrzymaliśmy informację o próbie opłacenia zamówienia <strong>{{orderNumber}}</strong>.</p>
  <p>Administrator zweryfikuje płatność i zaktualizuje status zamówienia.</p>
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'dashboardUrl']
  },
  'order_status_platnosc_zakonczona_niepowodzeniem': {
    name: 'Status: Płatność zakończona niepowodzeniem',
    subject: 'Płatność za zamówienie {{orderNumber}} nie została potwierdzona - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #dc2626;">Płatność zakończona niepowodzeniem</h2>
  <p>Dzień dobry,</p>
  <p>Nie udało się potwierdzić płatności dla zamówienia <strong>{{orderNumber}}</strong>.</p>
  <p>W profilu możesz ponowić płatność, klikając przycisk <strong>Opłać</strong>.</p>
  <p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p>
</body>
</html>`,
    variables: ['orderNumber', 'dashboardUrl']
  },
  'order_edited_by_user': {
    name: 'Zamówienia — edycja przez klienta',
    subject: 'Zamówienie {{orderNumber}} zostało zaktualizowane - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zamówienie zostało zaktualizowane</h2>
  <p>Dzień dobry,</p>
  <p>W zamówieniu <strong>{{orderNumber}}</strong> zapisano zmiany.</p>
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> {{status}}</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    {{#if notes}}<li><strong>Uwagi:</strong> {{notes}}</li>{{/if}}
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'status', 'updatedAt', 'orderDetails', 'notes', 'total']
  },
  'order_cancelled_by_user': {
    name: 'Zamówienia — anulowanie przez klienta',
    subject: 'Zamówienie {{orderNumber}} zostało anulowane przez klienta - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zamówienie zostało anulowane</h2>
  <p>Dzień dobry,</p>
  <p>Zamówienie <strong>{{orderNumber}}</strong> zostało anulowane przez klienta.</p>
  {{#if cancellationReason}}
  <p><strong>Powód anulowania:</strong> {{cancellationReason}}</p>
  {{/if}}
  <h3>Szczegóły zamówienia:</h3>
  <ul>
    <li><strong>Numer zamówienia:</strong> {{orderNumber}}</li>
    <li><strong>Status:</strong> {{status}}</li>
    <li><strong>Data aktualizacji:</strong> {{updatedAt}}</li>
    <li><strong>Zamówienie:</strong> {{orderDetails}}</li>
    <li><strong>Wartość:</strong> {{total}} zł</li>
  </ul>
  <p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p>
  <p>Pozdrawiamy,<br>Zespół strzelca.pl</p>
</body>
</html>`,
    variables: ['orderNumber', 'status', 'cancellationReason', 'updatedAt', 'orderDetails', 'total']
  },
  'order_admin_created_by_user': {
    name: 'Administrator — nowe zamówienie od użytkownika',
    subject: 'Nowe zamówienie {{orderNumber}} zostało złożone',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color:#c19a6b;">Nowe zamówienie</h2>
  <p>Użytkownik złożył nowe zamówienie <strong>{{orderNumber}}</strong>.</p>
  <ul>
    <li><strong>Klient:</strong> {{customerName}}</li>
    <li><strong>E-mail:</strong> {{customerEmail}}</li>
    <li><strong>Status:</strong> {{status}}</li>
    <li><strong>Kwota:</strong> {{total}} zł</li>
  </ul>
  <p><strong>Zamówienie:</strong><br>{{orderDetails}}</p>
</body>
</html>`,
    variables: ['orderNumber', 'customerName', 'customerEmail', 'status', 'total', 'orderDetails']
  },
  'order_admin_quote_accepted': {
    name: 'Administrator — klient zaakceptował wycenę',
    subject: 'Klient zaakceptował wycenę zamówienia {{orderNumber}}',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color:#16a34a;">Wycena zaakceptowana</h2>
  <p>Klient zaakceptował wycenę zamówienia <strong>{{orderNumber}}</strong>.</p>
  <ul>
    <li><strong>Klient:</strong> {{customerName}}</li>
    <li><strong>E-mail:</strong> {{customerEmail}}</li>
    <li><strong>Kwota:</strong> {{total}} zł</li>
  </ul>
</body>
</html>`,
    variables: ['orderNumber', 'customerName', 'customerEmail', 'total']
  },
  'order_admin_quote_rejected': {
    name: 'Administrator — klient odrzucił wycenę',
    subject: 'Klient odrzucił wycenę zamówienia {{orderNumber}}',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color:#dc2626;">Wycena odrzucona</h2>
  <p>Klient odrzucił wycenę dla zamówienia <strong>{{orderNumber}}</strong>.</p>
  <ul>
    <li><strong>Klient:</strong> {{customerName}}</li>
    <li><strong>E-mail:</strong> {{customerEmail}}</li>
  </ul>
  {{#if quoteRejectedReason}}
  <p><strong>Powód odrzucenia:</strong> {{quoteRejectedReason}}</p>
  {{/if}}
</body>
</html>`,
    variables: ['orderNumber', 'customerName', 'customerEmail', 'quoteRejectedReason']
  },
  'order_admin_payment_started': {
    name: 'Administrator — użytkownik rozpoczął płatność',
    subject: 'Zamówienie {{orderNumber}} oczekuje na weryfikację płatności',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color:#c19a6b;">Weryfikowanie płatności</h2>
  <p>Użytkownik kliknął „Opłać” dla zamówienia <strong>{{orderNumber}}</strong>.</p>
  <ul>
    <li><strong>Klient:</strong> {{customerName}}</li>
    <li><strong>E-mail:</strong> {{customerEmail}}</li>
    <li><strong>Kwota:</strong> {{total}} zł</li>
  </ul>
  <p>Sprawdź płatność i ustaw status na <strong>W realizacji</strong> albo <strong>Płatność zakończona niepowodzeniem</strong>.</p>
</body>
</html>`,
    variables: ['orderNumber', 'customerName', 'customerEmail', 'total']
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
  },
  'return_claim_created_verified': {
    name: 'Zwroty/Reklamacje — utworzenie zgłoszenia zweryfikowanego',
    subject: 'Zgłoszenie {{claimNumber}} zostało przesłane - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zgłoszenie zostało przesłane</h2>
  <p>Dzień dobry {{firstName}} {{lastName}},</p>
  <p>Otrzymaliśmy formularz <strong>{{claimType}}</strong> o numerze <strong>{{claimNumber}}</strong>.</p>
  <p>Status początkowy: <strong>{{statusLabel}}</strong>.</p>
  <p>Wgląd do zgłoszenia znajdziesz w swoim profilu: <a href="{{dashboardUrl}}" style="color: #c19a6b;">otwórz profil</a>.</p>
  <p>Zwykle odpowiadamy w ciągu 7 dni.</p>
  <p>Kontakt: {{supportEmail}}</p>
</body>
</html>`,
    variables: ['claimNumber', 'claimType', 'firstName', 'lastName', 'statusLabel', 'dashboardUrl', 'supportEmail']
  },
  'return_claim_created_unverified': {
    name: 'Zwroty/Reklamacje — utworzenie zgłoszenia niezweryfikowanego',
    subject: 'Formularz {{claimNumber}} został zapisany - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Formularz został zapisany</h2>
  <p>Dzień dobry,</p>
  <p>Wygenerowano formularz <strong>{{claimType}}</strong> o numerze <strong>{{claimNumber}}</strong>.</p>
  <p>To zgłoszenie jest oznaczone jako <strong>{{verificationLabel}}</strong>.</p>
  <p>Dołącz formularz do przesyłki zwrotnej i zachowaj numer sprawy do kontaktu.</p>
  <p>Kontakt: {{supportEmail}}</p>
</body>
</html>`,
    variables: ['claimNumber', 'claimType', 'verificationLabel', 'supportEmail']
  },
  'return_claim_edited_by_user': {
    name: 'Zwroty/Reklamacje — edycja zgłoszenia przez klienta',
    subject: 'Zgłoszenie {{claimNumber}} zostało zaktualizowane - strzelca.pl',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Zgłoszenie zostało zaktualizowane</h2>
  <p>Dzień dobry {{firstName}} {{lastName}},</p>
  <p>W formularzu <strong>{{claimNumber}}</strong> zapisano zmiany.</p>
  {{#if adminComment}}<p><strong>Opis zmian:</strong> {{adminComment}}</p>{{/if}}
  <p><a href="{{dashboardUrl}}" style="color: #c19a6b;">Zobacz szczegóły zgłoszenia</a></p>
</body>
</html>`,
    variables: ['claimNumber', 'firstName', 'lastName', 'adminComment', 'dashboardUrl']
  },
  'return_claim_w_trakcie_realizacji': {
    name: 'Zwroty/Reklamacje — status: W trakcie realizacji',
    subject: 'Zgłoszenie {{claimNumber}} jest w trakcie realizacji - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#c19a6b;">Zgłoszenie w trakcie realizacji</h2><p>Status sprawy <strong>{{claimNumber}}</strong> został zmieniony na <strong>{{statusLabel}}</strong>.</p>{{#if adminComment}}<p><strong>Opis:</strong> {{adminComment}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'statusLabel', 'adminComment', 'dashboardUrl']
  },
  'return_claim_zaproponowano_rozwiazanie': {
    name: 'Zwroty/Reklamacje — status: Zaproponowano rozwiązanie',
    subject: 'Nowa propozycja rozwiązania dla zgłoszenia {{claimNumber}} - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#c19a6b;">Zaproponowano rozwiązanie</h2><p>Dla zgłoszenia <strong>{{claimNumber}}</strong> przygotowaliśmy propozycję rozwiązania.</p><p><strong>Treść propozycji:</strong> {{solutionText}}</p>{{#if adminComment}}<p><strong>Dodatkowy opis:</strong> {{adminComment}}</p>{{/if}}<p>W profilu możesz ją zaakceptować lub odrzucić: <a href="{{dashboardUrl}}" style="color:#c19a6b;">otwórz zgłoszenie</a>.</p></body></html>`,
    variables: ['claimNumber', 'solutionText', 'adminComment', 'dashboardUrl']
  },
  'return_claim_propozycja_zaakceptowana': {
    name: 'Zwroty/Reklamacje — status: Propozycja zaakceptowana',
    subject: 'Propozycja dla zgłoszenia {{claimNumber}} została zaakceptowana - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#16a34a;">Propozycja zaakceptowana</h2><p>Zgłoszenie <strong>{{claimNumber}}</strong> ma status <strong>{{statusLabel}}</strong>.</p><p>Dalsze informacje pojawią się w historii zgłoszenia.</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'statusLabel', 'dashboardUrl']
  },
  'return_claim_propozycja_odrzucona': {
    name: 'Zwroty/Reklamacje — status: Propozycja odrzucona',
    subject: 'Propozycja dla zgłoszenia {{claimNumber}} została odrzucona - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#dc2626;">Propozycja odrzucona</h2><p>Zgłoszenie <strong>{{claimNumber}}</strong> ma status <strong>{{statusLabel}}</strong>.</p>{{#if userResponseReason}}<p><strong>Powód odrzucenia:</strong> {{userResponseReason}}</p>{{/if}}{{#if userResponseExpectations}}<p><strong>Oczekiwania klienta:</strong> {{userResponseExpectations}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'statusLabel', 'userResponseReason', 'userResponseExpectations', 'dashboardUrl']
  },
  'return_claim_oczekiwanie_na_zwrot': {
    name: 'Zwroty/Reklamacje — status: Oczekiwanie na zwrot',
    subject: 'Zgłoszenie {{claimNumber}} oczekuje na zwrot towaru - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#7c3aed;">Oczekiwanie na zwrot</h2><p>Zgłoszenie <strong>{{claimNumber}}</strong> ma status <strong>{{statusLabel}}</strong>.</p>{{#if adminComment}}<p><strong>Opis:</strong> {{adminComment}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'statusLabel', 'adminComment', 'dashboardUrl']
  },
  'return_claim_rozpatrzono_pozytywnie': {
    name: 'Zwroty/Reklamacje — status: Rozpatrzono pozytywnie',
    subject: 'Zgłoszenie {{claimNumber}} rozpatrzono pozytywnie - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#16a34a;">Zgłoszenie rozpatrzono pozytywnie</h2><p>Sprawa <strong>{{claimNumber}}</strong> została rozpatrzona pozytywnie.</p><p><strong>Uzasadnienie:</strong> {{justification}}</p><p><strong>Forma zwrotu:</strong> {{refundMethod}}</p>{{#if refundExtra}}<p><strong>Szczegóły formy zwrotu:</strong> {{refundExtra}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'justification', 'refundMethod', 'refundExtra', 'dashboardUrl']
  },
  'return_claim_rozpatrzono_negatywnie': {
    name: 'Zwroty/Reklamacje — status: Rozpatrzono negatywnie',
    subject: 'Zgłoszenie {{claimNumber}} rozpatrzono negatywnie - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#dc2626;">Zgłoszenie rozpatrzono negatywnie</h2><p>Sprawa <strong>{{claimNumber}}</strong> została rozpatrzona negatywnie.</p><p><strong>Uzasadnienie:</strong> {{justification}}</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'justification', 'dashboardUrl']
  },
  'return_claim_anulowano_przez_administratora': {
    name: 'Zwroty/Reklamacje — status: Anulowano przez administratora',
    subject: 'Zgłoszenie {{claimNumber}} zostało anulowane - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#dc2626;">Zgłoszenie anulowane</h2><p>Zgłoszenie <strong>{{claimNumber}}</strong> zostało anulowane przez administratora.</p>{{#if adminComment}}<p><strong>Powód:</strong> {{adminComment}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'adminComment', 'dashboardUrl']
  },
  'return_claim_anulowano_przez_klienta': {
    name: 'Zwroty/Reklamacje — status: Anulowano przez klienta',
    subject: 'Zgłoszenie {{claimNumber}} zostało anulowane przez klienta - strzelca.pl',
    html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#dc2626;">Zgłoszenie anulowane przez klienta</h2><p>Zgłoszenie <strong>{{claimNumber}}</strong> zostało anulowane przez klienta.</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zgłoszenie</a></p></body></html>`,
    variables: ['claimNumber', 'dashboardUrl']
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
