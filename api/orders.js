// =============================================================================
// API ZAMÓWIEŃ - Firestore dla Strzelca.pl (Vercel Serverless)
// =============================================================================

const FirestoreDatabaseManager = require('../firestore-db');
const {
  initAdmin,
  admin,
  setCors,
  getSessionUser,
  readJsonBody,
} = require('./_sso-utils');
const { firestoreValueToJsonable } = require('./_serialize-firestore');
const { sendTransactionalEmail } = require('./_transactional-mail');
const {
  evaluatePromoCodeForOrder,
  redeemPromoCodeForOrder,
  sendPromoCodeUsageNotification,
} = require('./_promo-codes');
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require('./_moderation');

let dbManager = null;
const USER_EDITABLE_ORDER_STATUS = 'zlozone';
const USER_QUOTE_RESPONDABLE_ORDER_STATUS = 'wycena_zlozona';
const USER_PAYMENT_RETRYABLE_ORDER_STATUSES = new Set([
  'oczekuje_na_platnosc',
  'platnosc_zakonczona_niepowodzeniem',
]);
const ORDER_ADMIN_NOTIFICATION_EMAIL = 'kontakt@strzelca.pl';
const ORDER_STATUSES = [
  'zlozone',
  'wycena_zlozona',
  'wycena_zaakceptowana',
  'wycena_odrzucona',
  'oczekuje_na_platnosc',
  'weryfikowanie_platnosci',
  'platnosc_zakonczona_niepowodzeniem',
  'realizacja',
  'wyslane',
  'zakonczone',
  'anulowane',
];

async function initDatabase() {
  if (!dbManager) {
    dbManager = new FirestoreDatabaseManager();
    await dbManager.initializeFirebase();
  }
  return dbManager;
}

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

/** Vercel czasem nie wypełnia req.query — łączymy z parsowaniem URL (np. summary=1 na dashboardzie). */
function readOrdersQueryParam(req, name) {
  const rq = req.query && typeof req.query === 'object' && !Array.isArray(req.query) ? req.query : {};
  const raw = rq[name];
  if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
    return Array.isArray(raw) ? raw[0] : raw;
  }
  try {
    const host = req.headers?.host || 'localhost';
    const urlObj = new URL(req.url || '/', `http://${host}`);
    const s = urlObj.searchParams.get(name);
    return s === null ? undefined : s;
  } catch {
    return undefined;
  }
}

function isOrdersSummaryRequest(req) {
  const v = readOrdersQueryParam(req, 'summary');
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || v === 1 || v === true;
}

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    initAdmin();
    const db = admin.firestore();
    const profile = await getUserRoleProfile(db, uid);
    return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, 'shop');
  } catch (e) {
    console.error('Error checking admin status:', e);
    return false;
  }
}

function extractOrderSequence(orderNumber, year) {
  const match = String(orderNumber || '').match(/^(\d+)\/(\d{4})\/STRZELCA\.PL$/);
  if (!match) return 0;
  if (Number(match[2]) !== Number(year)) return 0;
  return parseInt(match[1], 10) || 0;
}

async function findExistingMaxOrderSequenceForYear(tx, db, year) {
  const snapshot = await tx.get(db.collection('orders').select('orderNumber'));
  let max = 0;
  snapshot.forEach((doc) => {
    const value = extractOrderSequence(doc.data()?.orderNumber, year);
    if (value > max) {
      max = value;
    }
  });
  return max;
}

// Generowanie numeru zamówienia: X/RRRR/STRZELCA.PL
async function generateOrderNumber() {
  try {
    initAdmin();
    const db = admin.firestore();
    const currentYear = new Date().getFullYear();
    const counterRef = db.collection('systemCounters').doc(`orders-${currentYear}`);

    const nextNumber = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      let current = counterSnap.exists ? Number(counterSnap.data()?.value || 0) : 0;

      if (!Number.isInteger(current) || current < 0) {
        current = 0;
      }

      if (!counterSnap.exists) {
        current = await findExistingMaxOrderSequenceForYear(tx, db, currentYear);
      }

      const next = current + 1;
      tx.set(
        counterRef,
        {
          value: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return next;
    });

    return `${nextNumber}/${currentYear}/STRZELCA.PL`;
  } catch (e) {
    console.error('Error generating order number:', e);
    // Fallback: użyj timestamp
    const timestamp = Date.now();
    return `${timestamp}/${new Date().getFullYear()}/STRZELCA.PL`;
  }
}

// Formatowanie daty DD.MM.RRRR
function formatDate(date) {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

function normalizeOrderText(value) {
  return String(value || '').trim();
}

function normalizeOrderCustomerType(customerType, isCompany) {
  const normalizedType = normalizeOrderText(customerType).toLowerCase();
  if (normalizedType === 'company') return 'company';
  if (normalizedType === 'private') return 'private';
  if (isCompany === true || String(isCompany).toLowerCase() === 'true') return 'company';
  return 'private';
}

function normalizeOptionalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeMoney(value) {
  return Math.round((Math.max(0, Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function blankPlainAddress() {
  return {
    street: '',
    buildingNumber: '',
    postalCode: '',
    city: '',
  };
}

function clonePlainAddress(address) {
  return {
    street: String(address?.street || '').trim(),
    buildingNumber: String(address?.buildingNumber || '').trim(),
    postalCode: String(address?.postalCode || '').trim(),
    city: String(address?.city || '').trim(),
  };
}

function isPlainAddressComplete(address) {
  const normalized = clonePlainAddress(address);
  return Boolean(
    normalized.street &&
      normalized.buildingNumber &&
      normalized.postalCode &&
      normalized.city
  );
}

function isQuoteStatus(status) {
  return (
    status === 'wycena_zlozona' ||
    status === 'wycena_zaakceptowana' ||
    status === 'wycena_odrzucona'
  );
}

function isIndividualPricingOrder(order) {
  return order?.isIndividualPricing === true || order?.pricingMode === 'individual';
}

function getOrdersDashboardUrl() {
  return 'https://konto.strzelca.pl/profil.html';
}

function toOrderResponse(orderDoc) {
  const data = orderDoc.data() || {};
  return {
    id: orderDoc.id,
    ...data,
    createdAtFormatted: formatDate(data.createdAt),
    updatedAtFormatted: formatDate(data.updatedAt),
  };
}

async function resolveOrderPricingMode({
  db,
  orderContext,
  orderItemId,
  rawPrice,
  explicitIndividualPricing,
}) {
  const normalizedContext = orderContext === 'training' ? 'training' : 'shop';
  const collectionName = normalizedContext === 'training' ? 'trainings' : 'products';

  const normalizedOrderItemId = normalizeOrderText(orderItemId);
  if (!normalizedOrderItemId) {
    return {
      pricingMode: explicitIndividualPricing ? 'individual' : 'fixed',
      isIndividualPricing: explicitIndividualPricing === true,
      productPrice: normalizeMoney(rawPrice),
    };
  }

  try {
    const itemSnap = await db.collection(collectionName).doc(normalizedOrderItemId).get();
    if (!itemSnap.exists) {
      return {
        pricingMode: explicitIndividualPricing ? 'individual' : 'fixed',
        isIndividualPricing: explicitIndividualPricing === true,
        productPrice: normalizeMoney(rawPrice),
      };
    }
    const item = itemSnap.data() || {};
    const individualPricing = item.individualPricing === true;
    return {
      pricingMode: individualPricing ? 'individual' : 'fixed',
      isIndividualPricing: individualPricing,
      productPrice: individualPricing ? 0 : normalizeMoney(item.price || rawPrice),
    };
  } catch (error) {
    console.error('resolveOrderPricingMode:', error);
    return {
      pricingMode: explicitIndividualPricing ? 'individual' : 'fixed',
      isIndividualPricing: explicitIndividualPricing === true,
      productPrice: normalizeMoney(rawPrice),
    };
  }
}

async function resolveOrderRecipientEmail(order, db) {
  const directEmail = String(order?.email || '').trim();
  if (directEmail) return directEmail;
  if (!order?.userId) return '';
  try {
    const userProfile = await db.collection('userProfiles').doc(order.userId).get();
    const profileData = userProfile.exists ? userProfile.data() : null;
    return String(profileData?.email || '').trim();
  } catch (e) {
    console.error('Error fetching user email:', e);
    return '';
  }
}

async function resolveOrderCustomerDisplay(order, db) {
  if (!order?.userId) {
    return {
      customerName: '',
      customerEmail: String(order?.email || '').trim(),
    };
  }
  try {
    const snap = await db.collection('userProfiles').doc(order.userId).get();
    const profile = snap.exists ? snap.data() : null;
    return {
      customerName: String(profile?.displayName || '').trim(),
      customerEmail: String(profile?.email || order?.email || '').trim(),
    };
  } catch (e) {
    console.error('resolveOrderCustomerDisplay:', e);
    return {
      customerName: '',
      customerEmail: String(order?.email || '').trim(),
    };
  }
}

function getOrderUserFallbackTemplate(eventType, order) {
  if (eventType === 'created') {
    return {
      subject: 'Zamówienie {{orderNumber}} zostało utworzone - strzelca.pl',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało utworzone</h2><p>Dzień dobry,</p><p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało utworzone.</p><h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data utworzenia:</strong> {{createdAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li>{{#if notes}}<li><strong>Uwagi:</strong> {{notes}}</li>{{/if}}<li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
    };
  }

  if (eventType === 'edited_by_user') {
    return {
      subject: 'Zamówienie {{orderNumber}} zostało zaktualizowane - strzelca.pl',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało zaktualizowane</h2><p>Dzień dobry,</p><p>W zamówieniu <strong>{{orderNumber}}</strong> zapisano zmiany.</p>{{#if notes}}<p><strong>Uwagi:</strong> {{notes}}</p>{{/if}}<h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
    };
  }

  if (eventType === 'cancelled_by_user') {
    return {
      subject: 'Zamówienie {{orderNumber}} zostało anulowane przez klienta - strzelca.pl',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało anulowane</h2><p>Dzień dobry,</p><p>Zamówienie <strong>{{orderNumber}}</strong> zostało anulowane przez klienta.</p>{{#if cancellationReason}}<p><strong>Powód anulowania:</strong> {{cancellationReason}}</p>{{/if}}<h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
    };
  }

  if (eventType === 'status_changed') {
    if (order.status === 'wycena_zlozona') {
      return {
        subject: 'Wycena dla zamówienia {{orderNumber}} jest gotowa - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Wycena jest gotowa</h2><p>Dzień dobry,</p><p>Dla zamówienia <strong>{{orderNumber}}</strong> przygotowaliśmy wycenę.</p><p>W swoim profilu możesz ją teraz <strong>zaakceptować</strong> albo <strong>odrzucić</strong>.</p><h3>Szczegóły:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Kwota:</strong> {{total}} zł</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li></ul><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Przejdź do profilu</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'wycena_zaakceptowana') {
      return {
        subject: 'Wycena dla zamówienia {{orderNumber}} została zaakceptowana - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #16a34a;">Wycena zaakceptowana</h2><p>Dzień dobry,</p><p>Potwierdziliśmy akceptację wyceny dla zamówienia <strong>{{orderNumber}}</strong>.</p><p>Akceptacja wyceny jest wiążąca i oznacza zobowiązanie do opłacenia zamówienia.</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'wycena_odrzucona') {
      return {
        subject: 'Wycena dla zamówienia {{orderNumber}} została odrzucona - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #dc2626;">Wycena odrzucona</h2><p>Dzień dobry,</p><p>Wycena dla zamówienia <strong>{{orderNumber}}</strong> została oznaczona jako odrzucona.</p>{{#if quoteRejectedReason}}<p><strong>Powód odrzucenia:</strong> {{quoteRejectedReason}}</p>{{/if}}<p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'oczekuje_na_platnosc') {
      return {
        subject: 'Zamówienie {{orderNumber}} oczekuje na płatność - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Oczekiwanie na płatność</h2><p>Dzień dobry,</p><p>Dla zamówienia <strong>{{orderNumber}}</strong> możesz już przejść do opłacenia zamówienia w swoim profilu.</p><p>{{#if paymentUrl}}<a href="{{paymentUrl}}" style="color:#c19a6b;">Przejdź do płatności</a><br><br>{{/if}}<a href="{{dashboardUrl}}" style="color:#c19a6b;">Otwórz profil</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'weryfikowanie_platnosci') {
      return {
        subject: 'Płatność za zamówienie {{orderNumber}} jest weryfikowana - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Weryfikowanie płatności</h2><p>Dzień dobry,</p><p>Otrzymaliśmy informację o próbie opłacenia zamówienia <strong>{{orderNumber}}</strong>.</p><p>Administrator zweryfikuje płatność i zaktualizuje status zamówienia.</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Zobacz zamówienie w profilu</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'platnosc_zakonczona_niepowodzeniem') {
      return {
        subject: 'Płatność za zamówienie {{orderNumber}} nie została potwierdzona - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #dc2626;">Płatność zakończona niepowodzeniem</h2><p>Dzień dobry,</p><p>Nie udało się potwierdzić płatności dla zamówienia <strong>{{orderNumber}}</strong>.</p><p>W profilu możesz ponowić płatność, klikając przycisk <strong>Opłać</strong>.</p><p><a href="{{dashboardUrl}}" style="color:#c19a6b;">Przejdź do profilu</a></p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    if (order.status === 'anulowane') {
      return {
        subject: 'Zamówienie {{orderNumber}} zostało anulowane - strzelca.pl',
        html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało anulowane</h2><p>Dzień dobry,</p><p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało anulowane.</p>{{#if cancellationReason}}<p><strong>Powód:</strong> {{cancellationReason}}</p>{{/if}}<h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
      };
    }

    return {
      subject: 'Status zamówienia {{orderNumber}} został zmieniony - strzelca.pl',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Status zamówienia został zmieniony</h2><p>Dzień dobry,</p><p>Status Twojego zamówienia <strong>{{orderNumber}}</strong> został zmieniony na <strong>{{status}}</strong>.</p><h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul>{{#if invoiceFile}}<p><strong>Faktura:</strong> <a href="{{invoiceFile}}">Pobierz fakturę</a></p>{{/if}}<p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
    };
  }

  return null;
}

function getOrderAdminFallbackTemplate(kind) {
  if (kind === 'created_by_user') {
    return {
      subject: 'Nowe zamówienie {{orderNumber}} zostało złożone',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#c19a6b;">Nowe zamówienie</h2><p>Użytkownik złożył nowe zamówienie <strong>{{orderNumber}}</strong>.</p><ul><li><strong>Klient:</strong> {{customerName}}</li><li><strong>E-mail:</strong> {{customerEmail}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Kwota:</strong> {{total}} zł</li></ul><p><strong>Zamówienie:</strong><br>{{orderDetails}}</p></body></html>`,
    };
  }

  if (kind === 'quote_accepted') {
    return {
      subject: 'Klient zaakceptował wycenę zamówienia {{orderNumber}}',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#16a34a;">Wycena zaakceptowana</h2><p>Klient zaakceptował wycenę zamówienia <strong>{{orderNumber}}</strong>.</p><ul><li><strong>Klient:</strong> {{customerName}}</li><li><strong>E-mail:</strong> {{customerEmail}}</li><li><strong>Kwota:</strong> {{total}} zł</li></ul></body></html>`,
    };
  }

  if (kind === 'quote_rejected') {
    return {
      subject: 'Klient odrzucił wycenę zamówienia {{orderNumber}}',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#dc2626;">Wycena odrzucona</h2><p>Klient odrzucił wycenę dla zamówienia <strong>{{orderNumber}}</strong>.</p><ul><li><strong>Klient:</strong> {{customerName}}</li><li><strong>E-mail:</strong> {{customerEmail}}</li></ul>{{#if quoteRejectedReason}}<p><strong>Powód odrzucenia:</strong> {{quoteRejectedReason}}</p>{{/if}}</body></html>`,
    };
  }

  if (kind === 'payment_started') {
    return {
      subject: 'Zamówienie {{orderNumber}} oczekuje na weryfikację płatności',
      html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color:#c19a6b;">Weryfikowanie płatności</h2><p>Użytkownik kliknął „Opłać” dla zamówienia <strong>{{orderNumber}}</strong>.</p><ul><li><strong>Klient:</strong> {{customerName}}</li><li><strong>E-mail:</strong> {{customerEmail}}</li><li><strong>Kwota:</strong> {{total}} zł</li></ul><p>Sprawdź płatność i ustaw status na <strong>W realizacji</strong> albo <strong>Płatność zakończona niepowodzeniem</strong>.</p></body></html>`,
    };
  }

  return null;
}

// Zamiana zmiennych w szablonie (prosta implementacja)
function replaceTemplateVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // Zamień {{#if variable}}...{{/if}}
    const ifRegex = new RegExp(`{{\\s*#if\\s+${key}\\s*}}([\\s\\S]*?){{\\s*/if\\s*}}`, 'g');
    if (value) {
      result = result.replace(ifRegex, '$1');
    } else {
      result = result.replace(ifRegex, '');
    }
    // Zamień {{variable}}
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value || ''));
  }
  return result;
}

// Wysyłanie maila o zamówieniu
async function sendOrderEmail(order, eventType, oldStatus = null) {
  let recipientEmail = '';
  let subject = '';
  let templateId = '';
  try {
    initAdmin();
    const db = admin.firestore();
    recipientEmail = await resolveOrderRecipientEmail(order, db);
    if (!recipientEmail) return;

    if (eventType === 'created') {
      templateId = 'order_created';
    } else if (eventType === 'edited_by_user') {
      templateId = 'order_edited_by_user';
    } else if (eventType === 'cancelled_by_user') {
      templateId = 'order_cancelled_by_user';
    } else if (eventType === 'status_changed') {
      templateId = `order_status_${order.status}`;
    }

    let template = null;
    if (templateId) {
      try {
        const templateDoc = await db.collection('emailTemplates').doc(templateId).get();
        if (templateDoc.exists()) {
          template = templateDoc.data();
        }
      } catch (e) {
        console.error('Error loading template:', e);
      }
    }

    if (!template) {
      template = getOrderUserFallbackTemplate(eventType, order);
    }

    if (!template) return;

    const variables = {
      orderNumber: order.orderNumber || '',
      status: getStatusName(order.status),
      previousStatus: getStatusName(oldStatus),
      createdAt: order.createdAtFormatted || '',
      updatedAt: order.updatedAtFormatted || '',
      orderDetails: order.orderDetails || '',
      notes: order.notes || '',
      total: (order.total || 0).toFixed(2),
      invoiceFile: order.invoiceFile || '',
      cancellationReason: order.cancellationReason || '',
      dashboardUrl: getOrdersDashboardUrl(),
      paymentUrl: order.paymentLinkUrl || '',
      quoteRejectedReason: order.quoteRejectedReason || '',
    };

    subject = replaceTemplateVariables(template.subject || '', variables);
    const html = replaceTemplateVariables(template.html || '', variables);
    await sendTransactionalEmail({
      to: recipientEmail,
      subject,
      html,
      logCategory: 'order_notification',
      logMeta: {
        orderNumber: String(order.orderNumber || ''),
        templateId: String(templateId || ''),
        eventType: String(eventType || ''),
      },
    });
  } catch (error) {
    console.error('Error in sendOrderEmail:', error);
  }
}

async function sendOrderAdminNotification(order, kind) {
  try {
    if (!ORDER_ADMIN_NOTIFICATION_EMAIL) return;
    initAdmin();
    const db = admin.firestore();
    const templateId = `order_admin_${kind}`;
    let template = null;
    try {
      const templateDoc = await db.collection('emailTemplates').doc(templateId).get();
      if (templateDoc.exists()) {
        template = templateDoc.data();
      }
    } catch (e) {
      console.error('Error loading admin order template:', e);
    }
    if (!template) {
      template = getOrderAdminFallbackTemplate(kind);
    }
    if (!template) return;

    const customer = await resolveOrderCustomerDisplay(order, db);
    const variables = {
      orderNumber: order.orderNumber || '',
      status: getStatusName(order.status),
      createdAt: order.createdAtFormatted || '',
      updatedAt: order.updatedAtFormatted || '',
      orderDetails: order.orderDetails || '',
      total: (order.total || 0).toFixed(2),
      customerName: customer.customerName || 'Brak nazwy',
      customerEmail: customer.customerEmail || '',
      quoteRejectedReason: order.quoteRejectedReason || '',
    };
    const subject = replaceTemplateVariables(template.subject || '', variables);
    const html = replaceTemplateVariables(template.html || '', variables);
    await sendTransactionalEmail({
      to: ORDER_ADMIN_NOTIFICATION_EMAIL,
      subject,
      html,
      logCategory: 'order_admin_notification',
      logMeta: {
        orderNumber: String(order.orderNumber || ''),
        templateId,
        kind,
      },
    });
  } catch (error) {
    console.error('sendOrderAdminNotification:', error);
  }
}

function getStatusName(status) {
  const names = {
    zlozone: 'Złożone',
    wycena_zlozona: 'Wycena złożona',
    wycena_zaakceptowana: 'Wycena zaakceptowana',
    wycena_odrzucona: 'Wycena odrzucona',
    oczekuje_na_platnosc: 'Oczekuje na płatność',
    weryfikowanie_platnosci: 'Weryfikowanie płatności',
    platnosc_zakonczona_niepowodzeniem: 'Płatność zakończona niepowodzeniem',
    realizacja: 'W realizacji',
    wyslane: 'Wysłane',
    zakonczone: 'Zakończone',
    anulowane: 'Anulowane',
  };
  return names[status] || status;
}

async function logOrderActivity(action, details, actorUserId, req, targetUserId = null) {
  try {
    const payload = {
      action,
      userId: actorUserId || 'system',
      details: details || {},
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
    };
    if (targetUserId) {
      payload.targetUserId = targetUserId;
    }
    await admin.firestore().collection('activityLogs').add(payload);
  } catch (error) {
    console.warn('logOrderActivity failed:', error);
  }
}

/** Batch getAll zamiast N osobnych .get() — przy setkach zamówień poprzednia wersja przekraczała limit czasu Vercel. */
const INVOICE_DOC_BATCH = 40;

async function fetchInvoicesMetadataByOrderIds(db, orderIds) {
  const invoicesMap = {};
  const invoiceFileNameMap = {};
  if (!orderIds.length) {
    return { invoicesMap, invoiceFileNameMap };
  }
  for (let i = 0; i < orderIds.length; i += INVOICE_DOC_BATCH) {
    const chunk = orderIds.slice(i, i + INVOICE_DOC_BATCH);
    const refs = chunk.map((id) => db.collection('invoices').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const invData = snap.exists ? snap.data() : null;
      const fileName =
        invData && typeof invData.fileName === 'string' ? invData.fileName.trim() : '';
      invoicesMap[snap.id] = snap.exists;
      invoiceFileNameMap[snap.id] = fileName;
    }
  }
  return { invoicesMap, invoiceFileNameMap };
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET,POST,PUT,DELETE,OPTIONS' });
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    initAdmin();
    await initDatabase();
    const sessionUser = await getSessionUser(req);
    
    if (!sessionUser) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isUserAdmin = await isAdmin(sessionUser.uid);
    const db = admin.firestore();

    // GET - lista zamówień
    if (req.method === 'GET') {
      const status = readOrdersQueryParam(req, 'status');
      const userId = readOrdersQueryParam(req, 'userId');
      const scope = String(readOrdersQueryParam(req, 'scope') || '').toLowerCase();
      const forceMineScope = scope === 'mine';

      // Lekkie statystyki na dashboard (bez pobierania całej listy zamówień)
      if (isUserAdmin && isOrdersSummaryRequest(req)) {
        const statuses = ORDER_STATUSES;
        const safeCount = async (q) => {
          try {
            const snap = await Promise.race([
              q.count().get(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('count-timeout')), 16000)),
            ]);
            return snap.data().count;
          } catch {
            return 0;
          }
        };
        const col = db.collection('orders');
        const countPairs = await Promise.all(
          statuses.map(async (s) => [s, await safeCount(col.where('status', '==', s))])
        );
        const counts = Object.fromEntries(countPairs);
        let total;
        try {
          total = (
            await Promise.race([
              col.count().get(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('count-timeout')), 16000)),
            ])
          ).data().count;
        } catch {
          total = statuses.reduce((acc, s) => acc + (counts[s] || 0), 0);
        }
        res.status(200).json({ success: true, data: { counts, total } });
        return;
      }
      
      try {
        let query = db.collection('orders');
        let hasWhereClause = false;

        const maxOrders = Math.min(
          Math.max(parseInt(readOrdersQueryParam(req, 'limit'), 10) || 1500, 1),
          2500
        );
        
        // Użytkownik nie-admin (lub żądanie scope=mine) widzi tylko swoje zamówienia.
        if (!isUserAdmin || forceMineScope) {
          query = query.where('userId', '==', sessionUser.uid);
          hasWhereClause = true;
        }
        
        if (status && status !== 'all') {
          query = query.where('status', '==', status);
          hasWhereClause = true;
        }
        
        if (isUserAdmin && userId && !forceMineScope) {
          query = query.where('userId', '==', userId);
          hasWhereClause = true;
        }
        
        // Używaj orderBy tylko gdy nie ma where (wymaga indeksu złożonego)
        // W przeciwnym razie sortuj po stronie serwera
        let snapshot;
        if (!hasWhereClause) {
          // Brak filtrów - można użyć orderBy
          query = query.orderBy('createdAt', 'desc').limit(maxOrders);
          snapshot = await query.get();
        } else {
          // Są filtry - pobierz bez orderBy i posortuj po stronie serwera
          query = query.limit(maxOrders);
          snapshot = await query.get();
        }
        
        const orderIds = snapshot.docs.map(doc => doc.id);
        const { invoicesMap, invoiceFileNameMap } = await fetchInvoicesMetadataByOrderIds(
          db,
          orderIds
        );

        let orders = snapshot.docs.map(doc => {
          const data = doc.data();
          // Sprawdź czy faktura istnieje w kolekcji invoices lub w polu invoiceFile
          const hasInvoice = invoicesMap[doc.id] || !!data.invoiceFile;
          const invName = invoiceFileNameMap[doc.id] || '';
          const invNameNoExt = invName.replace(/\.pdf$/i, '').trim();
          return {
            id: doc.id,
            ...data,
            // URL do pobrania faktury (jeśli istnieje)
            invoiceFile: hasInvoice ? `/api/download-invoice?orderId=${doc.id}` : null,
            /** Nazwa pliku faktury z kolekcji invoices (bez ścieżki), do podpowiedzi w formularzach */
            invoiceDocumentLabel: invNameNoExt || null,
            createdAtFormatted: formatDate(data.createdAt),
            updatedAtFormatted: formatDate(data.updatedAt),
          };
        });
        
        // Sortuj po stronie serwera (zawsze, dla spójności)
        orders.sort((a, b) => {
          const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds || 0) * 1000;
          const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds || 0) * 1000;
          return bTime - aTime; // desc
        });
        
        const ordersSafe = orders.map((o) =>
          o && typeof o === 'object' ? firestoreValueToJsonable(o) : o
        );
        res.status(200).json({ success: true, data: ordersSafe });
        return;
      } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to load orders',
          details: error.message 
        });
        return;
      }
    }

    // POST — utworzenie zamówienia (admin dowolny klient; zalogowany użytkownik tylko dla siebie, status złożone)
    if (req.method === 'POST') {
      const body = readJsonBody(req);
      if (!body) {
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
      }

      if (!isUserAdmin) {
        if (body.userId !== sessionUser.uid) {
          res.status(403).json({ success: false, error: 'Forbidden' });
          return;
        }
        body.status = 'zlozone';
        body.invoiceFile = null;
      }

      const {
        userId,
        email,
        orderDetails,
        firstName,
        lastName,
        customerType,
        isCompany,
        companyName,
        taxId,
        notes,
        price,
        shipping,
        additionalCosts,
        status = 'zlozone',
        parcelLocker,
        address,
        deliveryMethod,
        deliverySameAsBilling,
        deliveryAddress,
        phone,
        invoiceFile,
        cancellationReason,
        paymentLinkUrl,
        promoCode,
        orderContext,
        orderItemId,
        orderItemTitle,
        individualPricing,
      } = body;

      if (!orderDetails || !orderDetails.trim()) {
        res.status(400).json({ success: false, error: 'Order details are required' });
        return;
      }

      if (!ORDER_STATUSES.includes(status)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowy status zamówienia.' });
        return;
      }

      const normalizedPaymentLinkUrl =
        paymentLinkUrl === undefined ? '' : normalizeOptionalUrl(paymentLinkUrl);
      if (normalizedPaymentLinkUrl === null) {
        res.status(400).json({ success: false, error: 'Link do płatności musi być prawidłowym adresem URL.' });
        return;
      }

      if (status === 'oczekuje_na_platnosc' && !normalizedPaymentLinkUrl) {
        res.status(400).json({ success: false, error: 'Dla statusu "Oczekuje na płatność" podaj link do płatności.' });
        return;
      }

      if (status === 'anulowane') {
        const cr =
          typeof cancellationReason === 'string' ? cancellationReason.trim() : '';
        if (!cr) {
          res.status(400).json({
            success: false,
            error: 'Podaj powód anulowania zamówienia',
          });
          return;
        }
      }

      const normalizedOrderContext = orderContext === 'training' ? 'training' : 'shop';
      const normalizedOrderItemId = normalizeOrderText(orderItemId);
      const normalizedOrderItemTitle =
        normalizeOrderText(orderItemTitle) || normalizeOrderText(orderDetails);
      const normalizedPromoCode = normalizeOrderText(promoCode);
      const redemptionUserId = normalizeOrderText(userId) || sessionUser.uid;
      const shippingAmount = normalizeMoney(shipping);
      const additionalCostsAmount = normalizeMoney(additionalCosts);
      const normalizedCustomerType = normalizeOrderCustomerType(customerType, isCompany);
      const rawDeliveryMethod =
        normalizedOrderContext === 'shop'
          ? String(deliveryMethod || '').trim().toLowerCase()
          : '';
      const normalizedDeliveryMethod =
        rawDeliveryMethod === 'courier' || rawDeliveryMethod === 'inpost' ? rawDeliveryMethod : '';
      const normalizedDeliveryAddress = clonePlainAddress(deliveryAddress);

      if (normalizedOrderContext === 'shop' && !normalizedDeliveryMethod && !isUserAdmin) {
        res.status(400).json({ success: false, error: 'Wybierz sposób dostawy.' });
        return;
      }
      if (normalizedDeliveryMethod === 'courier' && !isPlainAddressComplete(normalizedDeliveryAddress)) {
        res.status(400).json({ success: false, error: 'Uzupełnij pełny adres dostawy dla kuriera.' });
        return;
      }
      if (normalizedDeliveryMethod === 'inpost' && !normalizeOrderText(parcelLocker)) {
        res.status(400).json({ success: false, error: 'Podaj numer paczkomatu InPost.' });
        return;
      }

      const pricingModeData = await resolveOrderPricingMode({
        db,
        orderContext: normalizedOrderContext,
        orderItemId: normalizedOrderItemId,
        rawPrice: price,
        explicitIndividualPricing: individualPricing === true,
      });
      const basePrice = pricingModeData.productPrice;

      if (isQuoteStatus(status) && !pricingModeData.isIndividualPricing) {
        res.status(400).json({
          success: false,
          error: 'Status wyceny można zastosować tylko dla zamówień z ceną ustalaną indywidualnie.',
        });
        return;
      }

      const orderNumber = await generateOrderNumber();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const orderRef = db.collection('orders').doc();
      let promoEvaluation = null;
      let promoRedemption = null;

      try {
        await db.runTransaction(async (tx) => {
          if (normalizedPromoCode) {
            promoEvaluation = await evaluatePromoCodeForOrder({
              db,
              tx,
              rawCode: normalizedPromoCode,
              userId: redemptionUserId,
              context: normalizedOrderContext,
              trainingId: normalizedOrderItemId,
              basePrice,
            });

            if (!promoEvaluation.ok) {
              const error = new Error(promoEvaluation.message || 'Nie udało się zastosować kodu.');
              error.code = 'PROMO_CODE_INVALID';
              error.promo = promoEvaluation;
              throw error;
            }
          }

          const effectivePrice = promoEvaluation
            ? normalizeMoney(promoEvaluation.finalPrice)
            : normalizeMoney(basePrice);
          const discountAmount = promoEvaluation ? normalizeMoney(promoEvaluation.discountAmount) : 0;
          const total = normalizeMoney(effectivePrice + shippingAmount + additionalCostsAmount);
          const effectiveStatus =
            promoEvaluation?.application === 'training_access' ? 'zakonczone' : status;
          const promoNotes = [];
          if (notes) promoNotes.push(String(notes).trim());
          if (promoEvaluation?.application === 'discount') {
            promoNotes.push(promoEvaluation.customerMessage);
          }
          if (promoEvaluation?.application === 'training_access') {
            promoNotes.push(
              `Kupon: dostęp do szkolenia ${String(
                promoEvaluation.codeData?.targetTrainingTitle || normalizedOrderItemTitle || '',
              ).trim()}.`,
            );
          }

          const orderData = {
            orderNumber,
            userId: userId || null,
            email: email || null,
            orderDetails:
              promoEvaluation?.application === 'training_access'
                ? `Kupon rabatowy. Dostęp do szkolenia: ${String(
                    promoEvaluation.codeData?.targetTrainingTitle ||
                      normalizedOrderItemTitle ||
                      normalizedOrderItemId ||
                      '',
                  ).trim()}`
                : orderDetails.trim(),
            firstName: normalizeOrderText(firstName),
            lastName: normalizeOrderText(lastName),
            customerType: normalizedCustomerType,
            isCompany: normalizedCustomerType === 'company',
            companyName:
              normalizedCustomerType === 'company' ? normalizeOrderText(companyName) : '',
            taxId: normalizedCustomerType === 'company' ? normalizeOrderText(taxId) : '',
            notes: promoNotes.filter(Boolean).join('\n'),
            price: effectivePrice,
            basePrice,
            discountAmount,
            shipping: shippingAmount,
            additionalCosts: additionalCostsAmount,
            total,
            status: effectiveStatus,
            parcelLocker: parcelLocker || '',
            address: clonePlainAddress(address),
            deliveryMethod: normalizedDeliveryMethod,
            deliverySameAsBilling:
              normalizedDeliveryMethod === 'courier' ? deliverySameAsBilling === true : false,
            deliveryAddress:
              normalizedDeliveryMethod === 'courier' ? normalizedDeliveryAddress : blankPlainAddress(),
            phone: phone || '',
            invoiceFile: null,
            paymentLinkUrl: normalizedPaymentLinkUrl || '',
            pricingMode: pricingModeData.pricingMode,
            isIndividualPricing: pricingModeData.isIndividualPricing,
            orderContext: normalizedOrderContext,
            orderItemId: normalizedOrderItemId || '',
            orderItemTitle: normalizedOrderItemTitle || '',
            createdAt: now,
            updatedAt: now,
            createdBy: sessionUser.uid,
          };

          if (promoEvaluation) {
            orderData.promoCode = {
              codeId: promoEvaluation.codeId,
              maskedCode: promoEvaluation.codeData?.maskedCode || '',
              purpose: promoEvaluation.codeData?.purpose || '',
              application: promoEvaluation.application,
              discountAmount,
              targetTrainingId: promoEvaluation.codeData?.targetTrainingId || '',
              targetTrainingTitle: promoEvaluation.codeData?.targetTrainingTitle || '',
              discountType: promoEvaluation.codeData?.discountType || '',
              discountValue: promoEvaluation.codeData?.discountValue || 0,
            };
          }

          if (effectiveStatus === 'zakonczone' && promoEvaluation?.application === 'training_access') {
            orderData.paymentPaidAt = now;
            orderData.paymentVerificationMethod = 'promo_code';
            orderData.completedVia = 'promo_code';
            orderData.priceDisplay = '0 - kod promocyjny';
            orderData.totalDisplay = '0 - kod promocyjny';
          }

          if (effectiveStatus === 'anulowane') {
            orderData.cancellationReason =
              typeof cancellationReason === 'string' ? cancellationReason.trim() : '';
          }

          tx.set(orderRef, orderData);

          if (promoEvaluation) {
            promoRedemption = await redeemPromoCodeForOrder({
              db,
              tx,
              evaluation: promoEvaluation,
              userId: redemptionUserId,
              orderId: orderRef.id,
              orderNumber,
              orderContext: normalizedOrderContext,
              orderItemTitle: normalizedOrderItemTitle,
              grantedBy: sessionUser.uid,
            });
          }
        });
      } catch (error) {
        if (error?.code === 'PROMO_CODE_INVALID') {
          res.status(400).json({
            success: false,
            error: error.message || 'Nie udało się zastosować kodu.',
            promoCodeError: error.promo || null,
          });
          return;
        }
        throw error;
      }

      if (isUserAdmin && invoiceFile) {
        await orderRef.update({
          invoiceFile: `/api/download-invoice?orderId=${orderRef.id}`,
        });
      }
      
      // Pobierz utworzone zamówienie
      const createdOrder = await orderRef.get();
      const orderDataWithId = toOrderResponse(createdOrder);

      // Wysyłanie maila o utworzeniu zamówienia (asynchronicznie, nie blokuje odpowiedzi)
      sendOrderEmail(orderDataWithId, 'created').catch(err => {
        console.error('Error sending order creation email:', err);
      });
      if (!isUserAdmin) {
        sendOrderAdminNotification(orderDataWithId, 'created_by_user').catch((err) => {
          console.error('Error sending admin order creation email:', err);
        });
      }
      if (promoEvaluation) {
        sendPromoCodeUsageNotification({
          db,
          evaluation: promoEvaluation,
          userId: redemptionUserId,
          orderNumber: orderDataWithId.orderNumber,
          orderContext: normalizedOrderContext,
          orderItemTitle: normalizedOrderItemTitle,
          finalTotal: orderDataWithId.total,
        }).catch((err) => {
          console.error('Error sending promo code usage notification:', err);
        });
      }

      res.status(201).json({ success: true, data: orderDataWithId });
      return;
    }

    // PUT - aktualizacja zamówienia
    if (req.method === 'PUT') {
      const body = readJsonBody(req);
      if (!body || !body.id) {
        res.status(400).json({ success: false, error: 'Order ID is required' });
        return;
      }

      const orderRef = db.collection('orders').doc(body.id);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      const {
        orderDetails,
        firstName,
        lastName,
        customerType,
        isCompany,
        companyName,
        taxId,
        notes,
        price,
        shipping,
        additionalCosts,
        status,
        parcelLocker,
        address,
        deliveryMethod,
        deliverySameAsBilling,
        deliveryAddress,
        phone,
        invoiceFile,
        cancellationReason,
        paymentLinkUrl,
        mode,
        decision,
        rejectionReason,
        paymentVerificationMethod,
      } = body;

      if (!isUserAdmin) {
        const existingOrder = orderDoc.data() || {};
        if (existingOrder.userId !== sessionUser.uid) {
          res.status(403).json({ success: false, error: 'Forbidden' });
          return;
        }

        if (mode === 'user_quote_response') {
          if (!isIndividualPricingOrder(existingOrder)) {
            res.status(409).json({
              success: false,
              error: 'Na wycenę można odpowiedzieć tylko dla zamówień z ceną ustalaną indywidualnie.',
            });
            return;
          }

          if (existingOrder.status !== USER_QUOTE_RESPONDABLE_ORDER_STATUS) {
            res.status(409).json({
              success: false,
              error: 'Na wycenę można odpowiedzieć tylko przy statusie "Wycena złożona".',
            });
            return;
          }

          const updateData = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            quoteDecisionAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedByUser: sessionUser.uid,
          };

          if (decision === 'accept') {
            updateData.status = 'wycena_zaakceptowana';
            updateData.quoteAcceptedAt = admin.firestore.FieldValue.serverTimestamp();
            updateData.quoteRejectedReason = admin.firestore.FieldValue.delete();
          } else if (decision === 'reject') {
            const reason = String(rejectionReason || '').trim();
            if (reason.length < 10) {
              res.status(400).json({
                success: false,
                error: 'Powód odrzucenia wyceny musi mieć co najmniej 10 znaków.',
              });
              return;
            }
            updateData.status = 'wycena_odrzucona';
            updateData.quoteRejectedAt = admin.firestore.FieldValue.serverTimestamp();
            updateData.quoteRejectedReason = reason;
          } else {
            res.status(400).json({ success: false, error: 'Nieprawidłowa decyzja klienta.' });
            return;
          }

          await orderRef.update(updateData);
          const updatedOrder = await orderRef.get();
          const orderDataWithId = {
            id: updatedOrder.id,
            ...updatedOrder.data(),
            createdAtFormatted: formatDate(updatedOrder.data().createdAt),
            updatedAtFormatted: formatDate(updatedOrder.data().updatedAt),
          };

          await logOrderActivity(
            decision === 'accept' ? 'ORDER_QUOTE_ACCEPTED_BY_USER' : 'ORDER_QUOTE_REJECTED_BY_USER',
            {
              orderId: updatedOrder.id,
              orderNumber: orderDataWithId.orderNumber || '',
              oldStatus: existingOrder.status || '',
              newStatus: orderDataWithId.status || '',
              rejectionReason: updateData.quoteRejectedReason || '',
            },
            sessionUser.uid,
            req,
            updatedOrder.data().userId || sessionUser.uid,
          );

          sendOrderEmail(orderDataWithId, 'status_changed', existingOrder.status).catch((err) => {
            console.error('Error sending order quote response email:', err);
          });
          sendOrderAdminNotification(
            orderDataWithId,
            decision === 'accept' ? 'quote_accepted' : 'quote_rejected',
          ).catch((err) => {
            console.error('Error sending admin quote response email:', err);
          });

          res.status(200).json({ success: true, data: orderDataWithId });
          return;
        }

        if (mode === 'user_payment_attempt') {
          if (!USER_PAYMENT_RETRYABLE_ORDER_STATUSES.has(existingOrder.status)) {
            res.status(409).json({
              success: false,
              error:
                'Płatność można rozpocząć tylko dla zamówień oczekujących na płatność lub po nieudanej weryfikacji płatności.',
            });
            return;
          }

          if (!String(existingOrder.paymentLinkUrl || '').trim()) {
            res.status(409).json({
              success: false,
              error: 'Dla tego zamówienia nie ustawiono linku do płatności.',
            });
            return;
          }

          const updateData = {
            status: 'weryfikowanie_platnosci',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedByUser: sessionUser.uid,
            paymentVerificationStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentVerificationFailedAt: admin.firestore.FieldValue.delete(),
          };

          await orderRef.update(updateData);
          const updatedOrder = await orderRef.get();
          const orderDataWithId = {
            id: updatedOrder.id,
            ...updatedOrder.data(),
            createdAtFormatted: formatDate(updatedOrder.data().createdAt),
            updatedAtFormatted: formatDate(updatedOrder.data().updatedAt),
          };

          await logOrderActivity(
            'ORDER_PAYMENT_STARTED_BY_USER',
            {
              orderId: updatedOrder.id,
              orderNumber: orderDataWithId.orderNumber || '',
              oldStatus: existingOrder.status || '',
              newStatus: orderDataWithId.status || '',
            },
            sessionUser.uid,
            req,
            updatedOrder.data().userId || sessionUser.uid,
          );

          sendOrderEmail(orderDataWithId, 'status_changed', existingOrder.status).catch((err) => {
            console.error('Error sending payment started email:', err);
          });
          sendOrderAdminNotification(orderDataWithId, 'payment_started').catch((err) => {
            console.error('Error sending admin payment started email:', err);
          });

          res.status(200).json({ success: true, data: orderDataWithId });
          return;
        }

        if (existingOrder.status !== USER_EDITABLE_ORDER_STATUS) {
          res.status(409).json({
            success: false,
            error: 'Edycja zamowienia mozliwa jest tylko przy statusie zlozone.',
          });
          return;
        }

        const updateData = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedByUser: sessionUser.uid,
        };

        if (orderDetails !== undefined) updateData.orderDetails = String(orderDetails || '').trim();
        if (firstName !== undefined) updateData.firstName = normalizeOrderText(firstName);
        if (lastName !== undefined) updateData.lastName = normalizeOrderText(lastName);
        if (customerType !== undefined || isCompany !== undefined) {
          const normalizedCustomerType = normalizeOrderCustomerType(
            customerType !== undefined ? customerType : existingOrder.customerType,
            isCompany !== undefined ? isCompany : existingOrder.isCompany,
          );
          updateData.customerType = normalizedCustomerType;
          updateData.isCompany = normalizedCustomerType === 'company';
        }
        if (companyName !== undefined) updateData.companyName = normalizeOrderText(companyName);
        if (taxId !== undefined) updateData.taxId = normalizeOrderText(taxId);
        if (notes !== undefined) updateData.notes = notes || '';
        if (price !== undefined) updateData.price = normalizeMoney(price);
        if (shipping !== undefined) updateData.shipping = normalizeMoney(shipping);
        if (additionalCosts !== undefined) updateData.additionalCosts = normalizeMoney(additionalCosts);
        if (parcelLocker !== undefined) updateData.parcelLocker = parcelLocker || '';
        if (address !== undefined) updateData.address = clonePlainAddress(address);
        if (deliveryMethod !== undefined) {
          const normalizedDeliveryMethod = String(deliveryMethod || '').trim().toLowerCase();
          updateData.deliveryMethod =
            normalizedDeliveryMethod === 'courier' || normalizedDeliveryMethod === 'inpost'
              ? normalizedDeliveryMethod
              : '';
          if (updateData.deliveryMethod !== 'courier' && deliveryAddress === undefined) {
            updateData.deliveryAddress = blankPlainAddress();
          }
          if (updateData.deliveryMethod !== 'inpost' && parcelLocker === undefined) {
            updateData.parcelLocker = '';
          }
        }
        if (deliverySameAsBilling !== undefined) {
          updateData.deliverySameAsBilling = deliverySameAsBilling === true;
        }
        if (deliveryAddress !== undefined) {
          updateData.deliveryAddress = clonePlainAddress(deliveryAddress);
        }
        if (phone !== undefined) updateData.phone = phone || '';

        const currentData = orderDoc.data();
        const finalCustomerType = updateData.customerType !== undefined
          ? updateData.customerType
          : normalizeOrderCustomerType(currentData.customerType, currentData.isCompany);
        updateData.customerType = finalCustomerType;
        updateData.isCompany = finalCustomerType === 'company';
        if (finalCustomerType !== 'company') {
          updateData.companyName = '';
          updateData.taxId = '';
        } else {
          if (updateData.companyName === undefined) {
            updateData.companyName = normalizeOrderText(currentData.companyName);
          }
          if (updateData.taxId === undefined) {
            updateData.taxId = normalizeOrderText(currentData.taxId);
          }
        }
        const finalPrice = updateData.price !== undefined ? updateData.price : currentData.price;
        const finalShipping = updateData.shipping !== undefined ? updateData.shipping : currentData.shipping;
        const finalAdditionalCosts = updateData.additionalCosts !== undefined ? updateData.additionalCosts : currentData.additionalCosts;
        updateData.total = normalizeMoney(finalPrice + finalShipping + finalAdditionalCosts);

        await orderRef.update(updateData);

        const updatedOrder = await orderRef.get();
        const orderDataWithId = {
          id: updatedOrder.id,
          ...updatedOrder.data(),
          createdAtFormatted: formatDate(updatedOrder.data().createdAt),
          updatedAtFormatted: formatDate(updatedOrder.data().updatedAt),
        };

        await logOrderActivity(
          'ORDER_EDITED_BY_USER',
          {
            orderId: updatedOrder.id,
            orderNumber: orderDataWithId.orderNumber || '',
            status: orderDataWithId.status || '',
          },
          sessionUser.uid,
          req,
          updatedOrder.data().userId || sessionUser.uid,
        );

        sendOrderEmail(orderDataWithId, 'edited_by_user').catch((err) => {
          console.error('Error sending order edited email:', err);
        });

        res.status(200).json({ success: true, data: orderDataWithId });
        return;
      }

      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const normalizedPaymentLinkUrl =
        paymentLinkUrl === undefined
          ? undefined
          : normalizeOptionalUrl(paymentLinkUrl);
      if (normalizedPaymentLinkUrl === null) {
        res.status(400).json({ success: false, error: 'Link do płatności musi być prawidłowym adresem URL.' });
        return;
      }

      if (orderDetails !== undefined) updateData.orderDetails = orderDetails.trim();
      if (firstName !== undefined) updateData.firstName = normalizeOrderText(firstName);
      if (lastName !== undefined) updateData.lastName = normalizeOrderText(lastName);
      if (customerType !== undefined || isCompany !== undefined) {
        const normalizedCustomerType = normalizeOrderCustomerType(
          customerType !== undefined ? customerType : orderDoc.data().customerType,
          isCompany !== undefined ? isCompany : orderDoc.data().isCompany,
        );
        updateData.customerType = normalizedCustomerType;
        updateData.isCompany = normalizedCustomerType === 'company';
      }
      if (companyName !== undefined) updateData.companyName = normalizeOrderText(companyName);
      if (taxId !== undefined) updateData.taxId = normalizeOrderText(taxId);
      if (notes !== undefined) updateData.notes = notes;
      if (price !== undefined) updateData.price = normalizeMoney(price);
      if (shipping !== undefined) updateData.shipping = normalizeMoney(shipping);
      if (additionalCosts !== undefined) updateData.additionalCosts = normalizeMoney(additionalCosts);
      if (status !== undefined) {
        if (!ORDER_STATUSES.includes(status)) {
          res.status(400).json({ success: false, error: 'Nieprawidłowy status zamówienia.' });
          return;
        }
        updateData.status = status;
        const existingOrder = orderDoc.data();
        const prevStatus = existingOrder.status;
        const crIn =
          typeof cancellationReason === 'string' ? cancellationReason.trim() : '';

        if (isQuoteStatus(status) && !isIndividualPricingOrder(existingOrder)) {
          res.status(400).json({
            success: false,
            error: 'Status wyceny można zastosować tylko dla zamówień z ceną ustalaną indywidualnie.',
          });
          return;
        }

        if (status === 'anulowane') {
          if (prevStatus !== 'anulowane') {
            if (!crIn) {
              res.status(400).json({
                success: false,
                error: 'Podaj powód anulowania zamówienia',
              });
              return;
            }
            updateData.cancellationReason = crIn;
          } else if (crIn) {
            updateData.cancellationReason = crIn;
          }
        } else {
          updateData.cancellationReason = admin.firestore.FieldValue.delete();
        }

        if (status === 'oczekuje_na_platnosc') {
          const finalPaymentLink =
            normalizedPaymentLinkUrl !== undefined
              ? normalizedPaymentLinkUrl
              : String(orderDoc.data().paymentLinkUrl || '').trim();
          if (!finalPaymentLink) {
            res.status(400).json({
              success: false,
              error: 'Dla statusu "Oczekuje na płatność" podaj link do płatności.',
            });
            return;
          }
          updateData.paymentLinkUrl = finalPaymentLink;
        }

        if (status === 'wycena_zlozona') {
          updateData.quoteRejectedReason = admin.firestore.FieldValue.delete();
          updateData.quoteRejectedAt = admin.firestore.FieldValue.delete();
          updateData.quoteAcceptedAt = admin.firestore.FieldValue.delete();
        }

        if (status === 'wycena_zaakceptowana') {
          updateData.quoteRejectedReason = admin.firestore.FieldValue.delete();
          updateData.quoteRejectedAt = admin.firestore.FieldValue.delete();
          if (prevStatus !== 'wycena_zaakceptowana') {
            updateData.quoteAcceptedAt = admin.firestore.FieldValue.serverTimestamp();
          }
        }

        if (status === 'weryfikowanie_platnosci') {
          updateData.paymentVerificationStartedAt = admin.firestore.FieldValue.serverTimestamp();
          updateData.paymentVerificationFailedAt = admin.firestore.FieldValue.delete();
        }

        if (status === 'platnosc_zakonczona_niepowodzeniem') {
          updateData.paymentVerificationFailedAt = admin.firestore.FieldValue.serverTimestamp();
          updateData.paymentPaidAt = admin.firestore.FieldValue.delete();
          updateData.paymentVerifiedAt = admin.firestore.FieldValue.delete();
        }

        if (status === 'realizacja') {
          if (prevStatus === 'weryfikowanie_platnosci') {
            updateData.paymentPaidAt = admin.firestore.FieldValue.serverTimestamp();
            updateData.paymentVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
          }
          updateData.paymentVerificationFailedAt = admin.firestore.FieldValue.delete();
        }

        // Jeśli status zmienia się na "zakonczone", wymagaj faktury
        if (status === 'zakonczone') {
          // Sprawdź czy faktura istnieje w kolekcji invoices lub została przesłana
          const invoiceDoc = await db.collection('invoices').doc(body.id).get();
          const hasInvoice = invoiceDoc.exists || invoiceFile || orderDoc.data().invoiceFile;
          
          if (!hasInvoice) {
            res.status(400).json({ 
              success: false, 
              error: 'Invoice file is required for completed orders' 
            });
            return;
          }
          
          // Ustaw flagę że faktura istnieje (dla kompatybilności)
          if (!updateData.invoiceFile) {
            updateData.invoiceFile = `/api/download-invoice?orderId=${body.id}`;
          }
        }
      }
      if (parcelLocker !== undefined) updateData.parcelLocker = parcelLocker;
      if (address !== undefined) updateData.address = clonePlainAddress(address);
      if (deliveryMethod !== undefined) {
        const normalizedDeliveryMethod = String(deliveryMethod || '').trim().toLowerCase();
        updateData.deliveryMethod =
          normalizedDeliveryMethod === 'courier' || normalizedDeliveryMethod === 'inpost'
            ? normalizedDeliveryMethod
            : '';
        if (updateData.deliveryMethod !== 'courier' && deliveryAddress === undefined) {
          updateData.deliveryAddress = blankPlainAddress();
        }
        if (updateData.deliveryMethod !== 'inpost' && parcelLocker === undefined) {
          updateData.parcelLocker = '';
        }
      }
      if (deliverySameAsBilling !== undefined) {
        updateData.deliverySameAsBilling = deliverySameAsBilling === true;
      }
      if (deliveryAddress !== undefined) {
        updateData.deliveryAddress = clonePlainAddress(deliveryAddress);
      }
      if (phone !== undefined) updateData.phone = phone;
      if (invoiceFile !== undefined) updateData.invoiceFile = invoiceFile;
      if (normalizedPaymentLinkUrl !== undefined) updateData.paymentLinkUrl = normalizedPaymentLinkUrl;

      // Przelicz razem
      const currentData = orderDoc.data();
      const finalCustomerType = updateData.customerType !== undefined
        ? updateData.customerType
        : normalizeOrderCustomerType(currentData.customerType, currentData.isCompany);
      updateData.customerType = finalCustomerType;
      updateData.isCompany = finalCustomerType === 'company';
      if (finalCustomerType !== 'company') {
        updateData.companyName = '';
        updateData.taxId = '';
      } else {
        if (updateData.companyName === undefined) {
          updateData.companyName = normalizeOrderText(currentData.companyName);
        }
        if (updateData.taxId === undefined) {
          updateData.taxId = normalizeOrderText(currentData.taxId);
        }
      }
      const finalPrice = updateData.price !== undefined ? updateData.price : currentData.price;
      const finalShipping = updateData.shipping !== undefined ? updateData.shipping : currentData.shipping;
      const finalAdditionalCosts = updateData.additionalCosts !== undefined ? updateData.additionalCosts : currentData.additionalCosts;
      updateData.total = normalizeMoney(finalPrice + finalShipping + finalAdditionalCosts);

      await orderRef.update(updateData);
      
      const updatedOrder = await orderRef.get();
      const orderDataWithId = {
        id: updatedOrder.id,
        ...updatedOrder.data(),
        createdAtFormatted: formatDate(updatedOrder.data().createdAt),
        updatedAtFormatted: formatDate(updatedOrder.data().updatedAt),
      };

      // Wysyłanie maila o zmianie statusu (jeśli status się zmienił)
      const oldStatus = orderDoc.data().status;
      const newStatus = updateData.status || oldStatus;
      if (oldStatus !== newStatus) {
        sendOrderEmail(orderDataWithId, 'status_changed', oldStatus).catch(err => {
          console.error('Error sending order status change email:', err);
        });
      }

      await logOrderActivity(
        oldStatus !== newStatus ? 'ORDER_STATUS_CHANGED_BY_ADMIN' : 'ORDER_EDITED_BY_ADMIN',
        {
          orderId: updatedOrder.id,
          orderNumber: orderDataWithId.orderNumber || '',
          oldStatus,
          newStatus,
        },
        sessionUser.uid,
        req,
        updatedOrder.data().userId || null,
      );

      res.status(200).json({ success: true, data: orderDataWithId });
      return;
    }

    // DELETE - usunięcie zamówienia (admin) lub anulowanie przez klienta
    if (req.method === 'DELETE') {
      const id = readOrdersQueryParam(req, 'id');
      if (!id) {
        res.status(400).json({ success: false, error: 'Order ID is required' });
        return;
      }

      const orderRef = db.collection('orders').doc(id);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      if (!isUserAdmin) {
        const orderData = orderDoc.data() || {};
        if (orderData.userId !== sessionUser.uid) {
          res.status(403).json({ success: false, error: 'Forbidden' });
          return;
        }
        if (orderData.status !== USER_EDITABLE_ORDER_STATUS) {
          res.status(409).json({
            success: false,
            error: 'Anulowanie zamowienia mozliwe jest tylko przy statusie zlozone.',
          });
          return;
        }

        const cancellationReason =
          String(readOrdersQueryParam(req, 'reason') || 'Anulowano przez klienta.').trim() ||
          'Anulowano przez klienta.';

        await orderRef.update({
          status: 'anulowane',
          cancellationReason,
          cancelledBy: 'client',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const updatedOrder = await orderRef.get();
        const orderDataWithId = {
          id: updatedOrder.id,
          ...updatedOrder.data(),
          createdAtFormatted: formatDate(updatedOrder.data().createdAt),
          updatedAtFormatted: formatDate(updatedOrder.data().updatedAt),
        };

        await logOrderActivity(
          'ORDER_CANCELLED_BY_USER',
          {
            orderId: updatedOrder.id,
            orderNumber: orderDataWithId.orderNumber || '',
            reason: cancellationReason,
          },
          sessionUser.uid,
          req,
          updatedOrder.data().userId || sessionUser.uid,
        );

        sendOrderEmail(orderDataWithId, 'cancelled_by_user').catch((err) => {
          console.error('Error sending order cancelled email:', err);
        });

        res.status(200).json({ success: true, data: orderDataWithId });
        return;
      }

      await orderRef.delete();
      await logOrderActivity(
        'ORDER_HARD_DELETED_BY_ADMIN',
        {
          orderId: id,
          orderNumber: orderDoc.data()?.orderNumber || '',
        },
        sessionUser.uid,
        req,
        orderDoc.data()?.userId || null,
      );
      res.status(200).json({ success: true, message: 'Order deleted' });
      return;
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in orders API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + (error.message || 'Unknown error') 
    });
  }
};
