// =============================================================================
// FIRESTORE DATABASE MANAGER - strzelca.pl
// =============================================================================
// System bazy danych Firestore zastępujący SQLite dla aplikacji strzelca.pl
// =============================================================================

const admin = require('firebase-admin');

// Inicjalizacja Firebase Admin SDK
if (!admin.apps.length) {
  // W środowisku produkcyjnym użyj zmiennych środowiskowych Vercel
  // W development użyj service account key jeśli dostępny
  try {
    // Kod będzie szukał klucza najpierw w jednej, potem w drugiej zmiennej
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    }
    
    const projectId = process.env.FIREBASE_PROJECT_ID || 'strzelca-pl';
    const storageBucket =
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET_NAME ||
      process.env.GCLOUD_STORAGE_BUCKET ||
      `${projectId}.appspot.com`;

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
        storageBucket,
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
        storageBucket,
      });
    } else {
      // Fallback dla developmentu - wymagane skonfigurowanie credentials
      console.warn('Firebase credentials not found. Please set FIREBASE_SERVICE_ACCOUNT_KEY, GOOGLE_APPLICATION_CREDENTIALS_JSON, or GOOGLE_APPLICATION_CREDENTIALS');
      admin.initializeApp({
        projectId,
        storageBucket,
      });
    }
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    throw error;
  }
}

const db = admin.firestore();

/** Ogranicza czas agregacji count() — wiszące zapytania do Firestore kończyły się 504 na Vercel. */
function withFirestoreDeadline(promise, ms, label = 'firestore') {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), deadline]);
}

async function safeMessageCount(query, ms = 14000) {
  try {
    const snap = await withFirestoreDeadline(query.count().get(), ms, 'messages-count');
    return snap.data().count;
  } catch (e) {
    console.warn('safeMessageCount:', e?.message || e);
    return 0;
  }
}

class FirestoreDatabaseManager {
  constructor() {
    this.db = db;
    this.isInitialized = false;
  }

  async initializeFirebase() {
    if (this.isInitialized) return this.db;

    // Nie wywołuj listCollections() przy starcie — na Vercel potrafi zawiesić żądanie
    // do końca limitu czasu funkcji (brak odpowiedzi HTTP → 504 / „Load failed” w Safari).
    // Admin SDK jest już zainicjalizowane przy ładowaniu modułu; pierwsze realne zapytanie
    // i tak zweryfikuje połączenie.
    this.isInitialized = true;
    return this.db;
  }

  // =============================================================================
  // MESSAGES METHODS (zastępują SQLite messages table)
  // =============================================================================

  async addMessage(messageData) {
    try {
      const db = await this.initializeFirebase();

      const message = {
        content: messageData.content,
        senderId: messageData.senderId || 'anonymous',
        senderName: messageData.senderName,
        recipientId: messageData.recipientId || 'admin',
        status: messageData.status || 'pending',
        categoryId: messageData.categoryId || 'general',
        isRead: false,
        timestamp: admin.firestore.Timestamp.fromDate(new Date(messageData.timestamp || Date.now())),
        metadata: messageData.metadata || {}
      };

      if (
        messageData.imageAttachment &&
        typeof messageData.imageAttachment.mimeType === 'string' &&
        typeof messageData.imageAttachment.dataBase64 === 'string'
      ) {
        message.imageAttachment = {
          mimeType: messageData.imageAttachment.mimeType,
          dataBase64: messageData.imageAttachment.dataBase64,
        };
      }

      // Dodaj wiadomość do kolekcji messages
      const contentPreview = (message.content || '').toString();
      console.log('addMessage: Adding message to Firestore:', {
        senderId: message.senderId,
        senderName: message.senderName,
        recipientId: message.recipientId,
        content: contentPreview.substring(0, 50) + (contentPreview.length > 50 ? '...' : ''),
        hasImage: !!message.imageAttachment,
        status: message.status,
        collection: 'messages'
      });
      
      let messageId;
      try {
        const messageRef = await db.collection('messages').add(message);
        messageId = messageRef.id;
        console.log('addMessage: Message added successfully with ID:', messageId, 'to collection: messages');
        
        // Weryfikuj, czy wiadomość rzeczywiście została zapisana
        const verifyRef = db.collection('messages').doc(messageId);
        const verifySnap = await verifyRef.get();
        if (verifySnap.exists) {
          console.log('addMessage: Verification - message exists in Firestore');
        } else {
          console.error('addMessage: Verification FAILED - message does not exist in Firestore!');
        }
      } catch (addError) {
        console.error('addMessage: Error adding message to Firestore:', addError);
        throw addError;
      }

      // Zaktualizuj lub utwórz dokument konwersacji (opcjonalnie - nie blokuj zapisu wiadomości)
      try {
        await this.updateConversation(message.senderId, message.categoryId, message);
      } catch (convError) {
        console.warn('addMessage: Error updating conversation (non-critical):', convError);
        // Nie rzucamy błędu - wiadomość została zapisana, to jest tylko dodatkowa funkcjonalność
      }

      return {
        id: messageId,
        ...message,
        timestamp: message.timestamp.toDate().getTime()
      };
    } catch (error) {
      console.error('Error adding message:', error);
      throw error;
    }
  }

  async getMessages(options = {}) {
    try {
      console.log('getMessages: Called with options:', JSON.stringify(options, null, 2));
      const db = await this.initializeFirebase();
      let query = db.collection('messages');

      // Filtry
      if (options.recipientId) {
        query = query.where('recipientId', '==', options.recipientId);
      }

      if (options.senderId) {
        query = query.where('senderId', '==', options.senderId);
      }

      if (options.status) {
        query = query.where('status', '==', options.status);
      }

      if (options.categoryId) {
        query = query.where('categoryId', '==', options.categoryId);
      }

      if (typeof options.isRead === 'boolean') {
        query = query.where('isRead', '==', options.isRead);
      }

      // Zakres dat (timestamp jest Firestore Timestamp)
      if (options.dateFrom) {
        const fromMs = typeof options.dateFrom === 'string' ? Date.parse(options.dateFrom) : Number(options.dateFrom);
        if (Number.isFinite(fromMs)) {
          query = query.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(new Date(fromMs)));
        }
      }
      if (options.dateTo) {
        const toMs = typeof options.dateTo === 'string' ? Date.parse(options.dateTo) : Number(options.dateTo);
        if (Number.isFinite(toMs)) {
          query = query.where('timestamp', '<=', admin.firestore.Timestamp.fromDate(new Date(toMs)));
        }
      }

      // Sortowanie i paginacja
      // Uwaga: orderBy z wieloma where może wymagać złożonego indeksu
      // Najpierw spróbuj bez orderBy, żeby sprawdzić czy wiadomości w ogóle istnieją
      let snapshot;
      let needsInMemorySort = true; // Zawsze sortuj w pamięci, żeby uniknąć problemów z indeksami
      
      const hasExtraFilters = !!(
        options.senderId ||
        options.status ||
        options.categoryId ||
        typeof options.isRead === 'boolean' ||
        options.dateFrom ||
        options.dateTo
      );
      // Indeks recipientId + timestamp — tylko dla „skrzynki admina” bez dodatkowych where
      const canOrderByTimestamp = !!options.recipientId && !hasExtraFilters;

      let baseQuery = db.collection('messages');
      if (options.recipientId) baseQuery = baseQuery.where('recipientId', '==', options.recipientId);
      if (options.senderId) baseQuery = baseQuery.where('senderId', '==', options.senderId);
      if (options.status) baseQuery = baseQuery.where('status', '==', options.status);
      if (options.categoryId) baseQuery = baseQuery.where('categoryId', '==', options.categoryId);
      if (typeof options.isRead === 'boolean') baseQuery = baseQuery.where('isRead', '==', options.isRead);

      if (canOrderByTimestamp) {
        baseQuery = baseQuery.orderBy('timestamp', 'desc');
        needsInMemorySort = false;
      }

      const fetchLimit = canOrderByTimestamp
        ? (options.limit || 50)
        : (options.limit ? options.limit * 2 : 200);
      baseQuery = baseQuery.limit(fetchLimit);

      function isFirestoreIndexError(err) {
        if (!err) return false;
        const c = err.code;
        const msg = String(err.message || '');
        return (
          c === 9 ||
          c === 'failed-precondition' ||
          /FAILED_PRECONDITION/i.test(msg) ||
          /requires an index/i.test(msg)
        );
      }

      try {
        snapshot = await baseQuery.get();
        console.log('getMessages: Fetched', snapshot.size, 'documents from Firestore (size)');
        console.log('getMessages: Fetched', snapshot.docs.length, 'documents from Firestore (docs.length)');
        console.log('getMessages: Query filters:', {
          recipientId: options.recipientId,
          senderId: options.senderId,
          status: options.status,
          categoryId: options.categoryId,
          isRead: options.isRead,
          limit: fetchLimit
        });
      } catch (queryError) {
        if (canOrderByTimestamp && isFirestoreIndexError(queryError)) {
          console.warn(
            'getMessages: orderBy+limit failed (brak indeksu?), fallback bez orderBy:',
            queryError.message
          );
          needsInMemorySort = true;
          let fb = db.collection('messages');
          if (options.recipientId) fb = fb.where('recipientId', '==', options.recipientId);
          if (options.senderId) fb = fb.where('senderId', '==', options.senderId);
          if (options.status) fb = fb.where('status', '==', options.status);
          if (options.categoryId) fb = fb.where('categoryId', '==', options.categoryId);
          if (typeof options.isRead === 'boolean') {
            fb = fb.where('isRead', '==', options.isRead);
          }
          const cap = Math.min(2000, Math.max(fetchLimit * 5, (options.limit || 50) * 10, 200));
          snapshot = await fb.limit(cap).get();
        } else {
          console.error('getMessages: Error fetching messages:', queryError);
          throw queryError;
        }
      }
      let messages = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = null;
        try {
          if (data.timestamp) {
            if (typeof data.timestamp.toDate === 'function') {
              timestamp = data.timestamp.toDate().getTime();
            } else if (typeof data.timestamp === 'number') {
              timestamp = data.timestamp;
            } else if (typeof data.timestamp === 'string') {
              timestamp = Date.parse(data.timestamp);
            }
          }
        } catch (e) {
          console.warn('Error parsing timestamp for message', doc.id, e);
          timestamp = Date.now();
        }
        return {
          id: doc.id,
          ...data,
          timestamp: timestamp || Date.now()
        };
      });

      if (needsInMemorySort && messages.length > 0) {
        messages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
      if (options.limit && messages.length > options.limit) {
        messages = messages.slice(0, options.limit);
      }

      // Debug: sprawdź czy w ogóle są wiadomości w kolekcji
      if (messages.length === 0 && options.recipientId === 'admin') {
        try {
          const allMessagesSnapshot = await db.collection('messages').limit(5).get();
          console.log('getMessages: DEBUG - Total messages in collection:', allMessagesSnapshot.size);
          if (allMessagesSnapshot.size > 0) {
            allMessagesSnapshot.forEach((doc) => {
              const data = doc.data();
              console.log('getMessages: DEBUG - Sample message:', {
                id: doc.id,
                senderId: data.senderId,
                recipientId: data.recipientId,
                content: data.content?.substring(0, 30)
              });
            });
          }
        } catch (debugError) {
          console.warn('getMessages: DEBUG - Error checking all messages:', debugError.message);
        }
      }

      console.log('getMessages: Returning', messages.length, 'messages for options:', {
        recipientId: options.recipientId,
        senderId: options.senderId,
        status: options.status,
        isRead: options.isRead,
        categoryId: options.categoryId
      });

      // Pobierz całkowitą liczbę (bez limitów)
      let countQuery = db.collection('messages');
      if (options.recipientId) {
        countQuery = countQuery.where('recipientId', '==', options.recipientId);
      }
      if (options.senderId) {
        countQuery = countQuery.where('senderId', '==', options.senderId);
      }
      if (options.status) {
        countQuery = countQuery.where('status', '==', options.status);
      }
      if (options.categoryId) {
        countQuery = countQuery.where('categoryId', '==', options.categoryId);
      }
      if (typeof options.isRead === 'boolean') {
        countQuery = countQuery.where('isRead', '==', options.isRead);
      }
      if (options.dateFrom) {
        const fromMs = typeof options.dateFrom === 'string' ? Date.parse(options.dateFrom) : Number(options.dateFrom);
        if (Number.isFinite(fromMs)) {
          countQuery = countQuery.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(new Date(fromMs)));
        }
      }
      if (options.dateTo) {
        const toMs = typeof options.dateTo === 'string' ? Date.parse(options.dateTo) : Number(options.dateTo);
        if (Number.isFinite(toMs)) {
          countQuery = countQuery.where('timestamp', '<=', admin.firestore.Timestamp.fromDate(new Date(toMs)));
        }
      }

      let total = messages.length;
      try {
        const countSnapshot = await withFirestoreDeadline(
          countQuery.count().get(),
          14000,
          'getMessages-total-count'
        );
        total = countSnapshot.data().count;
      } catch (countError) {
        console.warn('getMessages: count timeout/error, using messages length:', countError.message);
        total = messages.length;
      }

      return {
        messages,
        total,
        limit: options.limit,
        offset: options.offset
      };
    } catch (error) {
      console.error('Error getting messages:', error);
      throw error;
    }
  }

  async updateMessageStatus(id, status) {
    try {
      const db = await this.initializeFirebase();
      await db.collection('messages').doc(id).update({ status });
      return true;
    } catch (error) {
      console.error('Error updating message status:', error);
      throw error;
    }
  }

  async markAsRead(id) {
    try {
      const db = await this.initializeFirebase();
      await db.collection('messages').doc(id).update({ isRead: true });
      return true;
    } catch (error) {
      console.error('Error marking message as read:', error);
      throw error;
    }
  }

  async markAsUnread(id) {
    try {
      const db = await this.initializeFirebase();
      await db.collection('messages').doc(id).update({ isRead: false });
      return true;
    } catch (error) {
      console.error('Error marking message as unread:', error);
      throw error;
    }
  }

  async markConversationAsRead(senderId, recipientId) {
    try {
      const db = await this.initializeFirebase();
      const messagesRef = db.collection('messages');
      const snapshot = await messagesRef
        .where('senderId', '==', senderId)
        .where('recipientId', '==', recipientId)
        .where('isRead', '==', false)
        .get();
      
      if (snapshot.empty) {
        return { updated: 0 };
      }

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { isRead: true });
      });
      await batch.commit();
      
      return { updated: snapshot.size };
    } catch (error) {
      console.error('Error marking conversation as read:', error);
      throw error;
    }
  }

  async markConversationAsUnread(senderId, recipientId) {
    try {
      const db = await this.initializeFirebase();
      const messagesRef = db.collection('messages');
      const snapshot = await messagesRef
        .where('senderId', '==', senderId)
        .where('recipientId', '==', recipientId)
        .where('isRead', '==', true)
        .get();
      
      if (snapshot.empty) {
        return { updated: 0 };
      }

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { isRead: false });
      });
      await batch.commit();
      
      return { updated: snapshot.size };
    } catch (error) {
      console.error('Error marking conversation as unread:', error);
      throw error;
    }
  }

  async updateMessageCategory(id, categoryId) {
    try {
      const db = await this.initializeFirebase();

      // Pobierz wiadomość żeby znać senderId
      const messageDoc = await db.collection('messages').doc(id).get();
      if (!messageDoc.exists) {
        throw new Error('Message not found');
      }

      const messageData = messageDoc.data();

      // Zaktualizuj kategorię wiadomości
      await db.collection('messages').doc(id).update({ categoryId });

      // Zaktualizuj kategorię całej konwersacji
      await this.updateConversation(messageData.senderId, categoryId);

      return true;
    } catch (error) {
      console.error('Error updating message category:', error);
      throw error;
    }
  }

  async getStats() {
    try {
      const db = await this.initializeFirebase();

      // Agregacje count() — bez pobierania całej kolekcji (przy dużej liczbie wiadomości
      // pełne .get() powodowało FUNCTION_INVOCATION_TIMEOUT na Vercel).
      const base = () => db.collection('messages').where('recipientId', '==', 'admin');

      const [total, pending, in_progress, completed, read] = await Promise.all([
        safeMessageCount(base()),
        safeMessageCount(base().where('status', '==', 'pending')),
        safeMessageCount(base().where('status', '==', 'in_progress')),
        safeMessageCount(base().where('status', '==', 'completed')),
        safeMessageCount(base().where('isRead', '==', true)),
      ]);

      return {
        total,
        pending,
        in_progress,
        completed,
        unread: Math.max(0, total - read),
      };
    } catch (error) {
      console.error('Error getting message stats:', error);
      throw error;
    }
  }

  // =============================================================================
  // CONVERSATIONS METHODS (nowa kolekcja dla grupowania wiadomości)
  // =============================================================================

  async updateConversation(userId, categoryId, lastMessage = null) {
    try {
      const db = await this.initializeFirebase();
      // Użyj conversationId zamiast userId dla spójności z pinConversation/unpinConversation
      // Jeśli lastMessage ma recipientId, użyj go do utworzenia conversationId
      let conversationId = userId;
      if (lastMessage && lastMessage.recipientId) {
        const participants = [userId, lastMessage.recipientId].filter(id => id).sort();
        conversationId = participants.join('_');
      } else if (lastMessage && lastMessage.senderId && lastMessage.recipientId) {
        // Alternatywnie, użyj senderId i recipientId z lastMessage
        const participants = [lastMessage.senderId, lastMessage.recipientId].filter(id => id).sort();
        conversationId = participants.join('_');
      }
      const conversationRef = db.collection('conversations').doc(conversationId);

      // Sprawdź czy konwersacja już istnieje
      const conversationDoc = await conversationRef.get();

      if (conversationDoc.exists) {
        // Zaktualizuj istniejącą konwersację
        const updateData = {
          categoryId: categoryId || 'general',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (lastMessage) {
          updateData.lastMessage = {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp || admin.firestore.FieldValue.serverTimestamp()
          };
        }

        await conversationRef.update(updateData);
        console.log('updateConversation: Updated existing conversation:', conversationId);
      } else {
        // Utwórz nową konwersację
        const participants = lastMessage && lastMessage.recipientId 
          ? [userId, lastMessage.recipientId].filter(id => id).sort()
          : [userId, 'admin'].filter(id => id).sort();
        
        const conversationData = {
          categoryId: categoryId || 'general',
          participantA: participants[0],
          participantB: participants[1] || 'admin',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          messageCount: 1,
          isPinned: false
        };

        if (lastMessage) {
          conversationData.lastMessage = {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp || admin.firestore.FieldValue.serverTimestamp()
          };
        }

        await conversationRef.set(conversationData);
        console.log('updateConversation: Created new conversation:', conversationId);
      }
    } catch (error) {
      console.error('Error updating conversation:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        userId,
        conversationId: conversationId || userId,
        categoryId
      });
      // Nie rzucaj błędu - to nie powinno blokować zapisywania wiadomości
      // throw error;
    }
  }

  async getConversation(userId) {
    try {
      const db = await this.initializeFirebase();
      const conversationDoc = await db.collection('conversations').doc(userId).get();

      if (conversationDoc.exists) {
        return {
          id: conversationDoc.id,
          ...conversationDoc.data(),
          createdAt: conversationDoc.data().createdAt?.toDate()?.getTime(),
          updatedAt: conversationDoc.data().updatedAt?.toDate()?.getTime(),
          lastMessage: conversationDoc.data().lastMessage ? {
            ...conversationDoc.data().lastMessage,
            timestamp: conversationDoc.data().lastMessage.timestamp?.toDate()?.getTime()
          } : null
        };
      }

      return null;
    } catch (error) {
      console.error('Error getting conversation:', error);
      throw error;
    }
  }

  async pinConversation(senderId, recipientId) {
    try {
      const db = await this.initializeFirebase();
      // Upewnij się, że conversationId jest tworzony tak samo jak w displayMessages
      const participants = [senderId, recipientId].filter(id => id).sort();
      const conversationId = participants.join('_');
      const conversationRef = db.collection('conversations').doc(conversationId);

      console.log('pinConversation: Pinning conversation', {
        senderId,
        recipientId,
        conversationId,
        participants
      });

      const conversationDoc = await conversationRef.get();
      
      if (conversationDoc.exists) {
        await conversationRef.update({
          isPinned: true,
          participantA: participants[0],
          participantB: participants[1] || 'admin',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('pinConversation: Updated existing conversation');
      } else {
        // Utwórz konwersację jeśli nie istnieje
        await conversationRef.set({
          participantA: participants[0],
          participantB: participants[1] || 'admin',
          isPinned: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('pinConversation: Created new conversation');
      }

      return { success: true };
    } catch (error) {
      console.error('Error pinning conversation:', error);
      throw error;
    }
  }

  async unpinConversation(senderId, recipientId) {
    try {
      const db = await this.initializeFirebase();
      // Upewnij się, że conversationId jest tworzony tak samo jak w displayMessages
      const participants = [senderId, recipientId].filter(id => id).sort();
      const conversationId = participants.join('_');
      const conversationRef = db.collection('conversations').doc(conversationId);

      console.log('unpinConversation: Unpinning conversation', {
        senderId,
        recipientId,
        conversationId,
        participants
      });

      const conversationDoc = await conversationRef.get();
      
      if (conversationDoc.exists) {
        await conversationRef.update({
          isPinned: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('unpinConversation: Updated conversation');
      }

      return { success: true };
    } catch (error) {
      console.error('Error unpinning conversation:', error);
      throw error;
    }
  }

  // =============================================================================
  // MESSAGE CATEGORIES METHODS (zastępują SQLite message_categories table)
  // =============================================================================

  async addDefaultCategories() {
    try {
      const db = await this.initializeFirebase();

      const defaultCategories = [
        { id: 'orders', name: 'Zamówienia', color: '#3B82F6', icon: 'fa-shopping-cart' },
        { id: 'offers', name: 'Oferty', color: '#10B981', icon: 'fa-tag' },
        { id: 'other', name: 'Inne', color: '#6B7280', icon: 'fa-circle' }
      ];

      const batch = db.batch();

      for (const category of defaultCategories) {
        const categoryRef = db.collection('messageCategories').doc(category.id);
        const categoryData = {
          ...category,
          createdAt: admin.firestore.Timestamp.fromDate(new Date())
        };
        batch.set(categoryRef, categoryData);
      }

      await batch.commit();
    } catch (error) {
      console.error('Error adding default categories:', error);
      throw error;
    }
  }

  async getCategories() {
    try {
      const db = await this.initializeFirebase();
      const snapshot = await db.collection('messageCategories').orderBy('name').get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.getTime()
      }));
    } catch (error) {
      console.error('Error getting categories:', error);
      throw error;
    }
  }

  async addCategory(categoryData) {
    try {
      const db = await this.initializeFirebase();

      const category = {
        name: categoryData.name,
        color: categoryData.color || '#6B7280',
        icon: categoryData.icon || 'fa-tag',
        createdAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const categoryRef = await db.collection('messageCategories').add(category);
      return categoryRef.id;
    } catch (error) {
      console.error('Error adding category:', error);
      throw error;
    }
  }

  async updateCategory(id, categoryData) {
    try {
      const db = await this.initializeFirebase();
      await db.collection('messageCategories').doc(id).update(categoryData);
      return true;
    } catch (error) {
      console.error('Error updating category:', error);
      throw error;
    }
  }

  async deleteCategory(id) {
    try {
      const db = await this.initializeFirebase();
      await db.collection('messageCategories').doc(id).delete();
      return true;
    } catch (error) {
      console.error('Error deleting category:', error);
      throw error;
    }
  }

  // =============================================================================
  // SYSTEM EVENTS METHODS (zastępują JSON pliki)
  // =============================================================================

  async addSystemEvent(eventData) {
    try {
      const db = await this.initializeFirebase();

      const event = {
        type: eventData.type,
        category: eventData.category || 'system',
        site: eventData.site,
        service: eventData.service,
        status: eventData.status,
        details: eventData.details,
        severity: eventData.severity || 'info',
        timestamp: admin.firestore.Timestamp.fromDate(new Date(eventData.timestamp || Date.now()))
      };

      const eventRef = await db.collection('system_events').add(event);
      return {
        id: eventRef.id,
        ...event,
        timestamp: event.timestamp.toDate().toISOString()
      };
    } catch (error) {
      console.error('Error adding system event:', error);
      throw error;
    }
  }

  async getSystemEvents(limit = 100) {
    try {
      const db = await this.initializeFirebase();
      const snapshot = await db.collection('system_events')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate().toISOString()
      }));
    } catch (error) {
      console.error('Error getting system events:', error);
      return [];
    }
  }

  async clearSystemEvents() {
    try {
      const db = await this.initializeFirebase();

      // Pobierz wszystkie dokumenty
      const snapshot = await db.collection('system_events').get();

      // Usuń w partiach
      const batchSize = 10;
      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = db.batch();
        snapshot.docs.slice(i, i + batchSize).forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }

      return true;
    } catch (error) {
      console.error('Error clearing system events:', error);
      throw error;
    }
  }

  // =============================================================================
  // USER EVENTS METHODS (zastępują JSON pliki)
  // =============================================================================

  async addUserEvent(eventData) {
    try {
      const db = await this.initializeFirebase();

      const event = {
        type: eventData.type,
        category: eventData.category || 'user',
        userId: eventData.userId,
        userName: eventData.userName,
        action: eventData.action,
        targetId: eventData.targetId,
        targetType: eventData.targetType,
        details: eventData.details,
        metadata: eventData.metadata || {},
        timestamp: admin.firestore.Timestamp.fromDate(new Date(eventData.timestamp || Date.now()))
      };

      const eventRef = await db.collection('user_events').add(event);
      return {
        id: eventRef.id,
        ...event,
        timestamp: event.timestamp.toDate().toISOString()
      };
    } catch (error) {
      console.error('Error adding user event:', error);
      throw error;
    }
  }

  async getUserEvents(limit = 100) {
    try {
      const db = await this.initializeFirebase();
      const snapshot = await db.collection('user_events')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate().toISOString()
      }));
    } catch (error) {
      console.error('Error getting user events:', error);
      return [];
    }
  }

  async clearUserEvents() {
    try {
      const db = await this.initializeFirebase();

      const snapshot = await db.collection('user_events').get();

      const batchSize = 10;
      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = db.batch();
        snapshot.docs.slice(i, i + batchSize).forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }

      return true;
    } catch (error) {
      console.error('Error clearing user events:', error);
      throw error;
    }
  }

  // =============================================================================
  // USER ACTIVITY METHODS (zastępują JSON pliki)
  // =============================================================================

    async addUserActivity(activityData) {
    try {
      const db = await this.initializeFirebase();

      const activity = {
        userId: activityData.userId || 'anonymous',
        userEmail: activityData.userEmail,
        action: activityData.action,
        path: activityData.path,
        userAgent: activityData.userAgent,
        ip: activityData.ip,
        sessionType: activityData.sessionType || 'standard',
        timestamp: admin.firestore.Timestamp.fromDate(new Date(activityData.timestamp || Date.now())),
        lastActivity: admin.firestore.Timestamp.fromDate(new Date(activityData.lastActivity || Date.now()))
      };

      const activityRef = await db.collection('activityLogs').add(activity);
      return {
        id: activityRef.id,
        ...activity,
        timestamp: activity.timestamp.toDate().toISOString(),
        lastActivity: activity.lastActivity.toDate().toISOString()
      };
    } catch (error) {
      console.error('Error adding user activity:', error);
      throw error;
    }
  }

    async getUserActivity(limit = 50) {
    try {
      const db = await this.initializeFirebase();
      const snapshot = await db.collection('activityLogs')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate().toISOString(),
        lastActivity: doc.data().lastActivity.toDate().toISOString()
      }));
    } catch (error) {
      console.error('Error getting user activity:', error);
      return [];
    }
  }

  // =============================================================================
  // QUICK REPLIES METHODS (zastępują przyszłe metody SQLite)
  // =============================================================================

  async getQuickReplies() {
    try {
      const db = await this.initializeFirebase();
      const snapshot = await db.collection('quick_replies').orderBy('createdAt', 'desc').get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.getTime()
      }));
    } catch (error) {
      console.error('Error getting quick replies:', error);
      throw error;
    }
  }

  async addQuickReply(replyData) {
    try {
      const db = await this.initializeFirebase();

      const reply = {
        title: replyData.title,
        content: replyData.content,
        createdAt: admin.firestore.Timestamp.fromDate(new Date())
      };

      const replyRef = await db.collection('quick_replies').add(reply);
      return {
        id: replyRef.id,
        ...reply,
        createdAt: reply.createdAt.toDate().getTime()
      };
    } catch (error) {
      console.error('Error adding quick reply:', error);
      throw error;
    }
  }

  async updateQuickReply(id, replyData) {
    try {
      const db = await this.initializeFirebase();
      const replyRef = db.collection('quick_replies').doc(id);
      const replyDoc = await replyRef.get();

      if (!replyDoc.exists) {
        throw new Error('Quick reply not found');
      }

      await replyRef.update(replyData);
      return {
        id: id,
        ...replyData,
        createdAt: replyDoc.data().createdAt?.toDate()?.getTime()
      };
    } catch (error) {
      console.error('Error updating quick reply:', error);
      throw error;
    }
  }

  async deleteQuickReply(id) {
    try {
      const db = await this.initializeFirebase();
      const replyRef = db.collection('quick_replies').doc(id);
      const replyDoc = await replyRef.get();

      if (!replyDoc.exists) {
        return false;
      }

      await replyRef.delete();
      return true;
    } catch (error) {
      console.error('Error deleting quick reply:', error);
      throw error;
    }
  }

  // =============================================================================
  // CONVERSATION CATEGORY METHODS (for updating entire conversation category)
  // =============================================================================

  async updateConversationCategory(userId, categoryId) {
    try {
      const db = await this.initializeFirebase();

      // Zaktualizuj kategorię konwersacji
      await db.collection('conversations').doc(userId).update({
        categoryId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return true;
    } catch (error) {
      console.error('Error updating conversation category:', error);
      throw error;
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  close() {
    // Firebase Admin SDK nie wymaga jawnego zamykania połączenia
    console.log('Firestore connection closed.');
  }
}

module.exports = FirestoreDatabaseManager;