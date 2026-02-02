# Szybka naprawa błędów Firestore

## Problem: Błędy "permission-denied" w panelu administratora

### Rozwiązanie krok po kroku:

1. **Otwórz Firebase Console**
   - Przejdź do: https://console.firebase.google.com/
   - Wybierz projekt: **strzelca-pl**

2. **Skopiuj reguły bezpieczeństwa**
   - Przejdź do: **Firestore Database** → **Rules**
   - Otwórz plik `firestore.rules` z tego projektu
   - Skopiuj całą zawartość pliku
   - Wklej do edytora reguł w Firebase Console
   - Kliknij **Publish**

3. **Utwórz wymagane indeksy**
   
   **Najłatwiej**: Kliknij linki z błędów w konsoli przeglądarki (linie z `create_composite=...`) - Firebase automatycznie utworzy wymagane indeksy.
   
   **Lub ręcznie**:
   
   **Indeks 1 - activityLogs (action + timestamp)**:
   - Przejdź do: **Firestore Database** → **Indexes** → **Create Index**
   - Collection: `activityLogs`
   - Fields: `action` (Ascending), `timestamp` (Descending)
   - Kliknij **Create**
   
   **Indeks 2 - messages (recipientId + timestamp)**:
   - Kliknij **Create Index**
   - Collection: `messages`
   - Fields: `recipientId` (Ascending), `timestamp` (Descending)
   - Kliknij **Create**
   
   **Indeks 3 - messages (recipientId + status)**:
   - Kliknij **Create Index**
   - Collection: `messages`
   - Fields: `recipientId` (Ascending), `status` (Ascending)
   - Kliknij **Create**

4. **Poczekaj i odśwież**
   - Poczekaj 1-2 minuty na aktualizację reguł
   - Odśwież panel administratora (Ctrl+F5)
   - Sprawdź konsolę - błędy powinny zniknąć

## Jeśli nadal są błędy:

### Sprawdź czy użytkownik ma rolę admin:
1. W Firebase Console → Firestore Database → Data
2. Znajdź kolekcję `userProfiles`
3. Znajdź dokument z Twoim UID (możesz sprawdzić UID w konsoli przeglądarki)
4. Sprawdź czy pole `role` ma wartość `"admin"`

### Sprawdź czy reguły zostały opublikowane:
1. W Firebase Console → Firestore Database → Rules
2. Sprawdź czy widzisz reguły z pliku `firestore.rules`
3. Jeśli nie, skopiuj je ponownie i kliknij **Publish**

## Błąd CORS

Błąd CORS z Firestore zwykle znika po:
- Opublikowaniu reguł bezpieczeństwa
- Odświeżeniu strony
- Sprawdzeniu czy domena jest autoryzowana w Firebase Console → Authentication → Settings → Authorized domains

## Uwaga: alert Google o publicznym kluczu API (Firebase Web)

Google potrafi wysyłać alerty, gdy wykryje w publicznym repo klucz w formacie `AIza...`.
W aplikacjach opartych o **Firebase Web SDK** ten klucz **nie jest tajnym sekretem** (musi trafić do przeglądarki),
ale powinien być **ograniczony** i najlepiej **nie trzymany w publicznym kodzie źródłowym**.

W tym repo klucz jest teraz pobierany dynamicznie z endpointu:
- `GET /api/firebase-config`

### Wymagane ENV (Vercel / produkcja)
- `FIREBASE_WEB_API_KEY` — klucz Web API dla Firebase

Po ustawieniu ENV na Vercel wdrożenie nie będzie już zawierało klucza w plikach HTML w repo.
