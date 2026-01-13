// =============================================================================
// SKRYPT MIGRACYJNY - Przeniesienie danych z plików JSON do bazy danych SQLite
// =============================================================================
// Ten skrypt przenosi istniejące dane z plików JSON do tabel bazy danych:
// - logi_zdarzen.json → tabela system_events
// - user-activity.json → tabela user_activity
// =============================================================================

const fs = require('fs');
const DatabaseManager = require('./database');

async function migrateData() {
  console.log('🔄 Rozpoczynam migrację danych...');

  const db = new DatabaseManager();

  try {
    // Czekaj na inicjalizację bazy danych
    await db.initDatabase();
    console.log('✅ Baza danych zainicjalizowana');

    // Migracja logów zdarzeń systemowych
    await migrateSystemEvents(db);

    // Migracja aktywności użytkowników
    await migrateUserActivity(db);

    console.log('✅ Migracja zakończona pomyślnie!');

  } catch (error) {
    console.error('❌ Błąd podczas migracji:', error);
  } finally {
    // Zamknij połączenie z bazą danych
    db.close();
  }
}

async function migrateSystemEvents(db) {
  const eventsFile = './logi_zdarzen.json';

  if (!fs.existsSync(eventsFile)) {
    console.log('⚠️ Plik logi_zdarzen.json nie istnieje, pomijam migrację zdarzeń systemowych');
    return;
  }

  console.log('📋 Migruję logi zdarzeń systemowych...');

  try {
    const events = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
    console.log(`📊 Znaleziono ${events.length} zdarzeń do migracji`);

    let migrated = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        // Mapowanie pól z formatu JSON na format bazy danych
        const eventData = {
          id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: event.timestamp,
          type: mapEventType(event.type),
          site: event.site || 'System',
          details: event.details || '',
          severity: mapSeverity(event.type),
          resolved: false // domyślnie nie rozwiązane
        };

        await db.logSystemEvent(eventData);
        migrated++;

        if (migrated % 10 === 0) {
          console.log(`📈 Zmigrowano ${migrated} zdarzeń...`);
        }
      } catch (error) {
        console.warn(`⚠️ Błąd migracji zdarzenia ${event.id}:`, error.message);
        skipped++;
      }
    }

    console.log(`✅ Migracja zdarzeń systemowych zakończona: ${migrated} zmigrowanych, ${skipped} pominiętych`);

  } catch (error) {
    console.error('❌ Błąd podczas migracji zdarzeń systemowych:', error);
  }
}

async function migrateUserActivity(db) {
  const activityFile = './user-activity.json';

  if (!fs.existsSync(activityFile)) {
    console.log('⚠️ Plik user-activity.json nie istnieje, pomijam migrację aktywności użytkowników');
    return;
  }

  console.log('👥 Migruję aktywność użytkowników...');

  try {
    const activities = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
    console.log(`📊 Znaleziono ${activities.length} wpisów aktywności do migracji`);

    let migrated = 0;
    let skipped = 0;

    for (const activity of activities) {
      try {
        // Mapowanie pól z formatu JSON na format bazy danych
        const activityData = {
          userId: activity.userId || 'anonymous',
          userEmail: activity.userEmail || null,
          timestamp: activity.timestamp,
          action: activity.action || 'page_view',
          path: activity.path || '/',
          userAgent: activity.userAgent || null,
          ip: activity.ip || activity.ipAddress || null,
          sessionType: activity.sessionType || 'standard',
          lastActivity: activity.lastActivity || activity.timestamp
        };

        await db.logUserActivity(activityData);
        migrated++;

        if (migrated % 10 === 0) {
          console.log(`📈 Zmigrowano ${migrated} wpisów aktywności...`);
        }
      } catch (error) {
        console.warn(`⚠️ Błąd migracji aktywności ${activity.userId}:`, error.message);
        skipped++;
      }
    }

    console.log(`✅ Migracja aktywności użytkowników zakończona: ${migrated} zmigrowanych, ${skipped} pominiętych`);

  } catch (error) {
    console.error('❌ Błąd podczas migracji aktywności użytkowników:', error);
  }
}

function mapEventType(oldType) {
  // Mapowanie starych typów zdarzeń na nowe
  const typeMapping = {
    'service_offline': 'service_offline',
    'service_online': 'service_online',
    'error': 'error',
    'warning': 'warning',
    'info': 'info'
  };

  return typeMapping[oldType] || 'info';
}

function mapSeverity(eventType) {
  // Mapowanie typu zdarzenia na poziom ważności
  const severityMapping = {
    'service_offline': 'critical',
    'service_online': 'info',
    'error': 'error',
    'warning': 'warning',
    'info': 'info'
  };

  return severityMapping[eventType] || 'info';
}

// Uruchom migrację jeśli skrypt jest uruchamiany bezpośrednio
if (require.main === module) {
  migrateData().then(() => {
    console.log('🏁 Migracja zakończona');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Błąd krytyczny:', error);
    process.exit(1);
  });
}

module.exports = { migrateData, migrateSystemEvents, migrateUserActivity };


