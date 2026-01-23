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
    
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || 'strzelca-pl'
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || 'strzelca-pl'
      });
    } else {
      // Fallback dla developmentu - wymagane skonfigurowanie credentials
      console.warn('Firebase credentials not found. Please set FIREBASE_SERVICE_ACCOUNT_KEY, GOOGLE_APPLICATION_CREDENTIALS_JSON, or GOOGLE_APPLICATION_CREDENTIALS');
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'strzelca-pl'
      });
    }
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    throw error;
  }
}

const db = admin.firestore();

class FirestoreDatabaseManager {
  constructor() {
    this.db = db;
    this.isInitialized = false;
  }

  async initializeFirebase() {
    if (this.isInitialized) return this.db;

    try {
      // Sprawdź połączenie z Firestore
      await this.db.listCollections();
      console.log('Connected to Firebase Firestore.');
      this.isInitialized = true;
      return this.db;
    } catch (error) {
      console.error('Firestore initialization error:', error);
      throw error;
    }
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

      // Dodaj wiadomość do kolekcji messages
      const messageRef = await db.collection('messages').add(message);
      const messageId = messageRef.id;

      // Zaktualizuj lub utwórz dokument konwersacji
      await this.updateConversation(message.senderId, message.categoryId, message);

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
      const db = await this.initializeFirebase();
      let query = db.collection('messages');

      // Filtry
      if (options.recipientId) {
        query = query.where('recipientId', '==', options.recipientId);
      }

      if (options.status) {
        query = query.where('status', '==', options.status);
      }

      if (options.categoryId) {
        query = query.where('categoryId', '==', options.categoryId);
      }

      if (options.senderId) {
        query = query.where('senderId', '==', options.senderId);
      }

      // Sortowanie i paginacja
      query = query.orderBy('timestamp', 'desc');

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.offset(options.offset);
      }

      const snapshot = await query.get();
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp.toDate().getTime()
      }));

      // Pobierz całkowitą liczbę (bez limitów)
      let countQuery = db.collection('messages');
      if (options.recipientId) {
        countQuery = countQuery.where('recipientId', '==', options.recipientId);
      }
      if (options.status) {
        countQuery = countQuery.where('status', '==', options.status);
      }
      if (options.categoryId) {
        countQuery = countQuery.where('categoryId', '==', options.categoryId);
      }

      const countSnapshot = await countQuery.count().get();
      const total = countSnapshot.data().count;

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

      // Pobierz wszystkie wiadomości
      const snapshot = await db.collection('messages').get();
      const messages = snapshot.docs.map(doc => doc.data());

      const stats = {
        total: messages.length,
        pending: messages.filter(m => m.status === 'pending').length,
        in_progress: messages.filter(m => m.status === 'in_progress').length,
        completed: messages.filter(m => m.status === 'completed').length,
        unread: messages.filter(m => !m.isRead).length
      };

      return stats;
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
      const conversationRef = db.collection('conversations').doc(userId);

      // Sprawdź czy konwersacja już istnieje
      const conversationDoc = await conversationRef.get();

      if (conversationDoc.exists) {
        // Zaktualizuj istniejącą konwersację
        const updateData = {
          categoryId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (lastMessage) {
          updateData.lastMessage = {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp
          };
        }

        await conversationRef.update(updateData);
      } else {
        // Utwórz nową konwersację
        const conversationData = {
          categoryId,
          userId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          messageCount: 1
        };

        if (lastMessage) {
          conversationData.lastMessage = {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp
          };
        }

        await conversationRef.set(conversationData);
      }
    } catch (error) {
      console.error('Error updating conversation:', error);
      throw error;
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