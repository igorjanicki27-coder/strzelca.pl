# Konfiguracja Firestore dla strzelca.pl

## Instrukcja konfiguracji reguł bezpieczeństwa Firestore

### Krok 1: Skopiuj reguły do Firebase Console

1. Otwórz [Firebase Console](https://console.firebase.google.com/)
2. Wybierz projekt **strzelca-pl**
3. Przejdź do **Firestore Database** → **Rules**
4. Skopiuj zawartość pliku `firestore.rules` i wklej do edytora reguł
5. Kliknij **Publish** aby zapisać zmiany

### Krok 2: Utwórz wymagane indeksy Firestore

Firebase automatycznie wyświetli linki do utworzenia brakujących indeksów, gdy będą potrzebne. Możesz też utworzyć je ręcznie:

#### Indeks dla activityLogs (action + timestamp)

1. Przejdź do **Firestore Database** → **Indexes**
2. Kliknij **Create Index**
3. Ustaw:
   - **Collection ID**: `activityLogs`
   - **Fields to index**:
     - `action` (Ascending)
     - `timestamp` (Descending)
   - **Query scope**: Collection
4. Kliknij **Create**

#### Indeks dla messages (recipientId + timestamp)

1. Kliknij **Create Index**
2. Ustaw:
   - **Collection ID**: `messages`
   - **Fields to index**:
     - `recipientId` (Ascending)
     - `timestamp` (Descending)
   - **Query scope**: Collection
3. Kliknij **Create**

#### Indeks dla messages (recipientId + status)

1. Kliknij **Create Index**
2. Ustaw:
   - **Collection ID**: `messages`
   - **Fields to index**:
     - `recipientId` (Ascending)
     - `status` (Ascending)
   - **Query scope**: Collection
3. Kliknij **Create**

#### Indeks dla messages (recipientId + timestamp)

**WAŻNE**: Ten indeks jest wymagany dla funkcji `loadContactFormsCount`.

1. Kliknij **Create Index**
2. Ustaw:
   - **Collection ID**: `messages`
   - **Fields to index**:
     - `recipientId` (Ascending)
     - `timestamp` (Descending)
   - **Query scope**: Collection
3. Kliknij **Create**

**LUB** kliknij link z błędu w konsoli przeglądarki, aby automatycznie utworzyć ten indeks.

### Krok 3: Weryfikacja

Po skonfigurowaniu reguł i indeksów:

1. **WAŻNE**: Poczekaj 1-2 minuty, aż reguły się zaktualizują w całym systemie Firebase
2. Odśwież panel administratora (Ctrl+F5 lub Cmd+Shift+R)
3. Sprawdź konsolę przeglądarki - nie powinno być błędów `permission-denied`
4. Wszystkie funkcje panelu powinny działać poprawnie

### Uwaga o błędach CORS

Jeśli widzisz błędy CORS związane z Firestore:
- To może być spowodowane przez długie połączenia (long polling)
- Błędy CORS zwykle znikają po opublikowaniu reguł i odświeżeniu strony
- Jeśli problem się utrzymuje, sprawdź czy domena jest dodana w Firebase Console → Authentication → Settings → Authorized domains

## Struktura reguł bezpieczeństwa

Reguły zapewniają:

- **Użytkownicy** mogą:
  - Czytać i aktualizować swoje własne profile
  - Tworzyć i czytać swoje własne wiadomości
  - Czytać swoje własne logi aktywności

- **Administratorzy** mogą:
  - Czytać i modyfikować wszystkie dane
  - Zarządzać kategoriami wiadomości
  - Zarządzać szablonami odpowiedzi
  - Przeglądać wszystkie logi aktywności i zdarzenia systemowe

- **Super Admin** (UID: `nCMUz2fc8MM9WhhMVBLZ1pdR7O43`) ma pełny dostęp do wszystkiego

## Rozwiązywanie problemów

### Błąd: "Missing or insufficient permissions"

1. Sprawdź, czy reguły zostały opublikowane w Firebase Console
2. Sprawdź, czy użytkownik ma rolę `admin` w dokumencie `userProfiles/{uid}`
3. Sprawdź, czy użytkownik jest zalogowany (sprawdź `request.auth.uid` w konsoli)

### Błąd: "The query requires an index"

1. Kliknij link z błędu w konsoli przeglądarki
2. Lub utwórz indeks ręcznie w Firebase Console → Firestore → Indexes

### Testowanie reguł

Możesz przetestować reguły w Firebase Console → Firestore → Rules → **Rules Playground**
