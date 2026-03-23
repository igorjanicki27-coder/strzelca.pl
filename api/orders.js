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

let dbManager = null;

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

// Generowanie numeru zamówienia: X/RRRR/STRZELCA.PL
async function generateOrderNumber() {
  try {
    initAdmin();
    const db = admin.firestore();
    const currentYear = new Date().getFullYear();
    
    // Znajdź ostatni numer zamówienia z tego roku
    const ordersRef = db.collection('orders');
    const yearOrders = await ordersRef
      .where('orderNumber', '>=', `1/${currentYear}/STRZELCA.PL`)
      .where('orderNumber', '<=', `99999/${currentYear}/STRZELCA.PL`)
      .orderBy('orderNumber', 'desc')
      .limit(1)
      .get();
    
    let nextNumber = 1;
    if (!yearOrders.empty) {
      const lastOrderNumber = yearOrders.docs[0].data().orderNumber;
      const match = lastOrderNumber.match(/^(\d+)\/\d+\/STRZELCA\.PL$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }
    
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
  let orderEmailFailureLogged = false;
  try {
    recipientEmail = order.email;
    if (!recipientEmail) {
      // Jeśli nie ma emaila, spróbuj pobrać z profilu użytkownika
      if (order.userId) {
        try {
          initAdmin();
          const db = admin.firestore();
          const userProfile = await db.collection('userProfiles').doc(order.userId).get();
          if (userProfile.exists()) {
            const profileData = userProfile.data();
            if (profileData.email) {
              recipientEmail = profileData.email;
            }
          }
        } catch (e) {
          console.error('Error fetching user email:', e);
          return; // Nie można wysłać maila bez adresu
        }
      } else {
        return; // Nie można wysłać maila bez adresu
      }
    }

    if (!recipientEmail) return;

    // Pobierz szablon z Firestore
    initAdmin();
    const db = admin.firestore();

    if (eventType === 'created') {
      templateId = 'order_created';
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

    // Jeśli nie ma szablonu, użyj domyślnego
    if (!template) {
      if (eventType === 'created') {
        template = {
          subject: `Zamówienie {{orderNumber}} zostało utworzone - strzelca.pl`,
          html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało utworzone</h2><p>Dzień dobry,</p><p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało utworzone.</p><h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data utworzenia:</strong> {{createdAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li>{{#if notes}}<li><strong>Uwagi:</strong> {{notes}}</li>{{/if}}<li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`
        };
      } else if (eventType === 'status_changed') {
        if (order.status === 'anulowane') {
          template = {
            subject: `Zamówienie {{orderNumber}} zostało anulowane - strzelca.pl`,
            html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Zamówienie zostało anulowane</h2><p>Dzień dobry,</p><p>Twoje zamówienie <strong>{{orderNumber}}</strong> zostało anulowane.</p>{{#if cancellationReason}}<p><strong>Powód:</strong> {{cancellationReason}}</p>{{/if}}<h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul><p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
          };
        } else {
          template = {
            subject: `Status zamówienia {{orderNumber}} został zmieniony - strzelca.pl`,
            html: `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><h2 style="color: #c19a6b;">Status zamówienia został zmieniony</h2><p>Dzień dobry,</p><p>Status Twojego zamówienia <strong>{{orderNumber}}</strong> został zmieniony na <strong>{{status}}</strong>.</p><h3>Szczegóły zamówienia:</h3><ul><li><strong>Numer zamówienia:</strong> {{orderNumber}}</li><li><strong>Status:</strong> {{status}}</li><li><strong>Data aktualizacji:</strong> {{updatedAt}}</li><li><strong>Zamówienie:</strong> {{orderDetails}}</li><li><strong>Wartość:</strong> {{total}} zł</li></ul>{{#if invoiceFile}}<p><strong>Faktura:</strong> <a href="{{invoiceFile}}">Pobierz fakturę</a></p>{{/if}}<p>Jeśli masz pytania, skontaktuj się z nami przez system wiadomości lub mailowo: kontakt@strzelca.pl</p><p>Pozdrawiamy,<br>Zespół strzelca.pl</p></body></html>`,
          };
        }
      }
    }

    if (!template) return;

    // Przygotuj zmienne
    const variables = {
      orderNumber: order.orderNumber || '',
      status: getStatusName(order.status),
      createdAt: order.createdAtFormatted || '',
      updatedAt: order.updatedAtFormatted || '',
      orderDetails: order.orderDetails || '',
      notes: order.notes || '',
      total: (order.total || 0).toFixed(2),
      invoiceFile: order.invoiceFile || '',
      cancellationReason: order.cancellationReason || '',
    };

    // Zamień zmienne w szablonie
    subject = replaceTemplateVariables(template.subject || '', variables);
    const html = replaceTemplateVariables(template.html || '', variables);

    // Przygotuj załączniki (faktura jeśli jest)
    const attachments = [];
    if (order.invoiceFile && order.status === 'zakonczone') {
      // TODO: Pobierz plik z Storage i dodaj jako załącznik
      // Na razie link w treści maila
    }

    // Wywołaj API wysyłania maila
    const emailResponse = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: recipientEmail,
        subject,
        html,
        attachments,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      const errText = errorData.error || `HTTP ${emailResponse.status}`;
      if (
        (emailResponse.status === 401 || emailResponse.status === 403) &&
        recipientEmail &&
        subject
      ) {
        try {
          const { logEmailDeliveryFailure } = require('./_activity-email-log');
          await logEmailDeliveryFailure({
            category: 'order_notification',
            to: recipientEmail,
            subject,
            errorMessage: errText,
            meta: {
              orderNumber: String(order.orderNumber || ''),
              templateId: String(templateId || ''),
              httpStatus: String(emailResponse.status),
              hint: 'Backend wywołuje /api/send-email bez tokenu admina — błąd konfiguracji.',
            },
          });
        } catch (logErr) {
          console.error('logEmailDeliveryFailure (order 401/403):', logErr);
        }
        orderEmailFailureLogged = true;
      }
      throw new Error(errText);
    }
  } catch (error) {
    console.error('Error in sendOrderEmail:', error);
    try {
      const msg = error.message || String(error);
      const smtpAlreadyLogged = /Failed to send email/i.test(msg);
      if (recipientEmail && subject && !smtpAlreadyLogged && !orderEmailFailureLogged) {
        const { logEmailDeliveryFailure } = require('./_activity-email-log');
        await logEmailDeliveryFailure({
          category: 'order_notification',
          to: recipientEmail,
          subject,
          errorMessage: msg,
          meta: {
            orderNumber: String(order.orderNumber || ''),
            templateId: String(templateId || ''),
            via: 'orders_sendOrderEmail',
          },
        });
      }
    } catch (logErr) {
      console.error('logEmailDeliveryFailure (order):', logErr);
    }
  }
}

function getStatusName(status) {
  const names = {
    zlozone: 'Złożone',
    realizacja: 'W realizacji',
    wyslane: 'Wysłane',
    zakonczone: 'Zakończone',
    anulowane: 'Anulowane',
  };
  return names[status] || status;
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

      // Lekkie statystyki na dashboard (bez pobierania całej listy zamówień)
      if (isUserAdmin && isOrdersSummaryRequest(req)) {
        const statuses = ['zlozone', 'realizacja', 'wyslane', 'zakonczone', 'anulowane'];
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
        
        // Użytkownik nie-admin widzi tylko swoje zamówienia
        if (!isUserAdmin) {
          query = query.where('userId', '==', sessionUser.uid);
          hasWhereClause = true;
        }
        
        if (status && status !== 'all') {
          query = query.where('status', '==', status);
          hasWhereClause = true;
        }
        
        if (isUserAdmin && userId) {
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
        
        res.status(200).json({ success: true, data: orders });
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
        notes,
        price,
        shipping,
        additionalCosts,
        status = 'zlozone',
        parcelLocker,
        address,
        phone,
        invoiceFile,
        cancellationReason,
      } = body;

      if (!orderDetails || !orderDetails.trim()) {
        res.status(400).json({ success: false, error: 'Order details are required' });
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

      // Oblicz razem
      const total = (parseFloat(price) || 0) + 
                   (parseFloat(shipping) || 0) + 
                   (parseFloat(additionalCosts) || 0);

      const orderNumber = await generateOrderNumber();
      const now = admin.firestore.FieldValue.serverTimestamp();

      const orderData = {
        orderNumber,
        userId: userId || null,
        email: email || null,
        orderDetails: orderDetails.trim(),
        notes: notes || '',
        price: parseFloat(price) || 0,
        shipping: parseFloat(shipping) || 0,
        additionalCosts: parseFloat(additionalCosts) || 0,
        total,
        status,
        parcelLocker: parcelLocker || '',
        address: address || {},
        phone: phone || '',
        invoiceFile: null,
        createdAt: now,
        updatedAt: now,
        createdBy: sessionUser.uid,
      };

      if (status === 'anulowane') {
        orderData.cancellationReason =
          typeof cancellationReason === 'string' ? cancellationReason.trim() : '';
      }

      const orderRef = await db.collection('orders').add(orderData);

      if (isUserAdmin && invoiceFile) {
        await orderRef.update({
          invoiceFile: `/api/download-invoice?orderId=${orderRef.id}`,
        });
      }
      
      // Pobierz utworzone zamówienie
      const createdOrder = await orderRef.get();
      const orderDataWithId = {
        id: createdOrder.id,
        ...createdOrder.data(),
        createdAtFormatted: formatDate(createdOrder.data().createdAt),
        updatedAtFormatted: formatDate(createdOrder.data().updatedAt),
      };

      // Wysyłanie maila o utworzeniu zamówienia (asynchronicznie, nie blokuje odpowiedzi)
      sendOrderEmail(orderDataWithId, 'created').catch(err => {
        console.error('Error sending order creation email:', err);
      });

      res.status(201).json({ success: true, data: orderDataWithId });
      return;
    }

    // PUT - aktualizacja zamówienia (tylko admin)
    if (req.method === 'PUT') {
      if (!isUserAdmin) {
        res.status(403).json({ success: false, error: 'Forbidden - admin only' });
        return;
      }

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
        notes,
        price,
        shipping,
        additionalCosts,
        status,
        parcelLocker,
        address,
        phone,
        invoiceFile,
        cancellationReason,
      } = body;

      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (orderDetails !== undefined) updateData.orderDetails = orderDetails.trim();
      if (notes !== undefined) updateData.notes = notes;
      if (price !== undefined) updateData.price = parseFloat(price) || 0;
      if (shipping !== undefined) updateData.shipping = parseFloat(shipping) || 0;
      if (additionalCosts !== undefined) updateData.additionalCosts = parseFloat(additionalCosts) || 0;
      if (status !== undefined) {
        updateData.status = status;
        const prevStatus = orderDoc.data().status;
        const crIn =
          typeof cancellationReason === 'string' ? cancellationReason.trim() : '';

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
      if (address !== undefined) updateData.address = address;
      if (phone !== undefined) updateData.phone = phone;
      if (invoiceFile !== undefined) updateData.invoiceFile = invoiceFile;

      // Przelicz razem
      const currentData = orderDoc.data();
      const finalPrice = updateData.price !== undefined ? updateData.price : currentData.price;
      const finalShipping = updateData.shipping !== undefined ? updateData.shipping : currentData.shipping;
      const finalAdditionalCosts = updateData.additionalCosts !== undefined ? updateData.additionalCosts : currentData.additionalCosts;
      updateData.total = finalPrice + finalShipping + finalAdditionalCosts;

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

      res.status(200).json({ success: true, data: orderDataWithId });
      return;
    }

    // DELETE - usunięcie zamówienia (tylko admin)
    if (req.method === 'DELETE') {
      if (!isUserAdmin) {
        res.status(403).json({ success: false, error: 'Forbidden - admin only' });
        return;
      }

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

      await orderRef.delete();
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
