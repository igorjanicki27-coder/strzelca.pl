# Naprawa błędu CORS z Firestore

## Problem
Błąd: `Fetch API cannot load https://firestore.googleapis.com/... due to access control checks`

Ten błąd występuje, gdy domena nie jest dodana do dozwolonych domen w Firebase Console.

## Rozwiązanie

### Krok 1: Dodaj domenę do Firebase Console

1. Przejdź do [Firebase Console](https://console.firebase.google.com/)
2. Wybierz projekt `strzelca-pl`
3. Przejdź do **Authentication** → **Settings** → **Authorized domains**
4. Dodaj następujące domeny (jeśli ich nie ma):
   - `strzelca.pl`
   - `admin.strzelca.pl` (lub domena, na której działa panel admina)
   - `localhost` (dla lokalnego developmentu)

### Krok 2: Sprawdź ustawienia API Key

1. Przejdź do [Google Cloud Console](https://console.cloud.google.com/)
2. Wybierz projekt `strzelca-pl`
3. Przejdź do **APIs & Services** → **Credentials**
4. Znajdź swój **API Key** (Web API Key)
5. Kliknij na niego i sprawdź:
   - **Application restrictions**: Upewnij się, że są ustawione na **HTTP referrers (web sites)**
   - **Website restrictions**: Dodaj:
     - `*.strzelca.pl/*`
     - `strzelca.pl/*`
     - `localhost:*` (dla developmentu)

### Krok 3: Sprawdź Firestore Security Rules

Upewnij się, że reguły bezpieczeństwa Firestore pozwalają na dostęp dla zalogowanych użytkowników:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Przykład - dostosuj do swoich potrzeb
    match /activityLogs/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Krok 4: Sprawdź czy działa

1. Odśwież stronę panelu admina
2. Sprawdź konsolę przeglądarki (F12) - błąd CORS powinien zniknąć
3. Jeśli nadal występuje, sprawdź:
   - Czy jesteś zalogowany jako admin
   - Czy domena w przeglądarce dokładnie pasuje do domeny w Firebase Console
   - Czy nie ma problemów z certyfikatami SSL

## Dodatkowe informacje

### Co zostało zmienione w kodzie

1. **Wymuszenie long polling** zamiast WebSocket - może pomóc z problemami CORS
2. **Lepsze logowanie błędów** - teraz widać dokładnie, co jest nie tak
3. **Komunikaty dla użytkownika** - gdy wystąpi błąd CORS, użytkownik zobaczy odpowiedni komunikat

### Jeśli problem nadal występuje

1. Sprawdź, czy używasz HTTPS (Firebase wymaga HTTPS dla domen produkcyjnych)
2. Sprawdź, czy nie ma problemów z certyfikatami SSL
3. Sprawdź, czy nie ma blokad w przeglądarce (np. rozszerzenia blokujące CORS)
4. Spróbuj w trybie incognito/privatnym

## Kontakt

Jeśli problem nadal występuje po wykonaniu powyższych kroków, sprawdź:
- Logi w konsoli przeglądarki (F12)
- Logi w Firebase Console → Firestore → Usage
- Ustawienia sieci w przeglądarce
