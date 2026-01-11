# Przechowywanie Danych - Strzelca.pl

## ⚠️ WAŻNE: Bezpieczeństwo Danych

Wiadomości użytkowników są przechowywane w **bazie danych SQLite** poza repozytorium Git dla maksymalnego bezpieczeństwa i prywatności.

## 🗄️ Struktura Bazy Danych

### SQLite Database: `strzelca.db`

#### Tabela `messages`
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  senderId TEXT NOT NULL,
  senderName TEXT NOT NULL,
  senderEmail TEXT,
  senderType TEXT DEFAULT 'user',
  recipientId TEXT NOT NULL,
  recipientType TEXT DEFAULT 'admin',
  topic TEXT,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  isRead BOOLEAN DEFAULT 0,
  status TEXT DEFAULT 'in_progress',
  hash TEXT,
  conversationType TEXT DEFAULT 'support_chat',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Indeksy dla wydajności
- `idx_messages_recipient` - szybkie wyszukiwanie po odbiorcy
- `idx_messages_timestamp` - sortowanie po czasie
- `idx_messages_status` - filtrowanie po statusie
- `idx_messages_sender` - wyszukiwanie po nadawcy
- `idx_messages_conversation` - rozmowy między użytkownikami

## 📁 Lokalizacja Bazy Danych

### Lokalnie (development)
```
strzelca-data/
└── strzelca.db              # Baza danych SQLite
```

### Na produkcji (Vercel/GitHub)
Ustaw zmienną środowiskową:
```bash
DATA_DIR=/path/to/data/directory
```

Baza danych zostanie automatycznie utworzona w podanej ścieżce.

## 🔒 Bezpieczeństwo

- **Poza repozytorium Git** - baza danych nie jest śledzona przez Git
- **.gitignore** wyklucza wszystkie pliki `.db`
- **Hashowanie wiadomości** - dodatkowa warstwa bezpieczeństwa
- **SQL Injection protection** - parametryzowane zapytania

## 🚀 Deployment

### Na Vercel:
1. Skonfiguruj persistent storage
2. Ustaw `DATA_DIR=/data` lub podobną ścieżkę
3. Upewnij się, że katalog ma uprawnienia do zapisu

### Na innych platformach:
```bash
# Dla Heroku
DATA_DIR=/app/data

# Dla Railway  
DATA_DIR=/data

# Dla własnego serwera
DATA_DIR=/var/data/strzelca
```

## 📊 Statystyki i Wydajność

### Obliczenia dla 2000 użytkowników:
- **Średnio 1 wiadomość dziennie** = 730,000 wiadomości rocznie
- **Rozmiar bazy**: ~50-100 MB rocznie (skompresowane)
- **Czas odpowiedzi**: <100ms dla typowych zapytań
- **Współbieżność**: SQLite obsługuje wielu użytkowników

### Indeksy zapewniają:
- Szybkie wyszukiwanie po użytkowniku: `<50ms`
- Filtrowanie po dacie: `<100ms`
- Sortowanie po czasie: `<200ms`

## 🔄 Migracja z Plików JSON

Jeśli masz istniejące dane w plikach JSON:

```javascript
// Skrypt migracyjny
const fs = require('fs');
const DatabaseManager = require('./database');

async function migrateFromJSON() {
  const db = new DatabaseManager();
  await db.initDatabase();

  // Wczytaj wszystkie pliki JSON
  const messageFiles = fs.readdirSync('./old-data/')
    .filter(file => file.endsWith('.json'));

  for (const file of messageFiles) {
    const messages = JSON.parse(fs.readFileSync(`./old-data/${file}`, 'utf8'));
    
    for (const message of messages) {
      await db.addMessage(message);
    }
  }

  console.log('Migracja zakończona pomyślnie');
}
```

## 🔍 Monitoring

Sprawdzaj regularnie:
- Rozmiar pliku `strzelca.db`
- Wydajność zapytań
- Użycie indeksów
- Backup bazy danych

## 🛠️ Narzędzia

### GUI dla SQLite:
- **DB Browser for SQLite** - darmowe, wieloplatformowe
- **SQLiteStudio** - zaawansowane funkcje
- **DBeaver** - uniwersalne narzędzie bazodanowe

### Backup:
```bash
# Codzienny backup
cp strzelca-data/strzelca.db backup/$(date +%Y%m%d)_strzelca.db
```

### Optymalizacja:
```sql
-- Przebudowa indeksów
REINDEX;

-- Vacuum (kompresja)  
VACUUM;
```

