# Bezpieczeństwo endpointu `/api/firebase-config`

## 🔒 Co zostało zabezpieczone

Endpoint `/api/firebase-config` został zaktualizowany z dodatkowymi zabezpieczeniami:

### 1. Weryfikacja Origin (CORS)
- Endpoint sprawdza nagłówek `Origin` dla requestów CORS
- Tylko domeny `*.strzelca.pl` są dozwolone
- Blokuje requesty z innych domen

### 2. Weryfikacja Referer
- Endpoint sprawdza nagłówek `Referer` jako dodatkowe zabezpieczenie
- Blokuje bezpośrednie wpisanie URL w przeglądarce (gdy nie ma ani Origin ani Referer)
- Pozwala na requesty z JavaScript (które mają Origin lub Referer)

### 3. Nagłówki cache
- Dodano nagłówki zapobiegające cache'owaniu odpowiedzi:
  - `Cache-Control: no-store, no-cache, must-revalidate, private`
  - `Pragma: no-cache`
  - `Expires: 0`

## ⚠️ Ważne informacje o Firebase Web API Key

### Czy klucz API Firebase jest sekretem?

**NIE** - Firebase Web API Key (`apiKey`) jest przeznaczony do użycia w kodzie klienckim (frontend). Jest widoczny w JavaScript w przeglądarce użytkownika.

### Dlaczego to jest bezpieczne?

1. **Firebase Security Rules** - Prawdziwe zabezpieczenie odbywa się przez reguły bezpieczeństwa Firestore/Storage
2. **Ograniczenia domeny** - W Firebase Console można ustawić ograniczenia, które domeny mogą używać klucza API
3. **Autoryzacja użytkowników** - Firebase Authentication kontroluje, kto może się zalogować

### Co jest prawdziwym sekretem?

**Service Account Keys** (`FIREBASE_SERVICE_ACCOUNT_KEY`) - to są prawdziwe sekrety, które:
- Są używane tylko po stronie serwera (w funkcjach API)
- NIGDY nie powinny być widoczne w kodzie klienckim
- Dają pełny dostęp do Firebase projektu

## ✅ Co jeszcze powinieneś sprawdzić

### 1. Firebase Console - Ograniczenia API Key

1. Przejdź do [Firebase Console](https://console.firebase.google.com/)
2. Wybierz projekt `strzelca-pl`
3. Przejdź do **Settings** → **General** → **Your apps**
4. Kliknij na aplikację web
5. W sekcji **API restrictions** upewnij się, że:
   - ✅ Ograniczenia są włączone
   - ✅ Tylko dozwolone API są aktywne (np. Firebase Authentication, Firestore, Storage)
   - ✅ **Application restrictions** są ustawione na:
     - **HTTP referrers (web sites)**
     - Dodaj domeny: `*.strzelca.pl/*`, `strzelca.pl/*`

### 2. Firestore Security Rules

Upewnij się, że masz odpowiednie reguły bezpieczeństwa w `firestore.rules`:
- ✅ Wszystkie wrażliwe kolekcje wymagają autoryzacji
- ✅ Użytkownicy mogą odczytywać tylko swoje dane
- ✅ Admin ma pełny dostęp tylko do określonych kolekcji

### 3. Storage Security Rules

Sprawdź `storage.rules` - upewnij się, że:
- ✅ Pliki są chronione przez reguły bezpieczeństwa
- ✅ Użytkownicy mogą uploadować tylko swoje pliki
- ✅ Publiczne pliki (np. avatary) mają odpowiednie ograniczenia

## 🧪 Testowanie zabezpieczeń

### Test 1: Bezpośredni dostęp w przeglądarce
```
❌ Powinno zwrócić 403 Forbidden:
https://strzelca.pl/api/firebase-config
```

### Test 2: Request z JavaScript (z dozwolonej domeny)
```javascript
// ✅ Powinno działać:
fetch('https://strzelca.pl/api/firebase-config')
  .then(r => r.json())
  .then(console.log);
```

### Test 3: Request z innej domeny
```javascript
// ❌ Powinno zwrócić 403 Forbidden:
// (wykonane z innej domeny, np. evil.com)
```

## 📝 Podsumowanie

- ✅ Endpoint jest teraz zabezpieczony przed bezpośrednim dostępem
- ✅ Requesty z JavaScript z dozwolonych domen działają normalnie
- ⚠️ Firebase Web API Key jest publiczny (to normalne), ale zabezpieczenia są na poziomie Security Rules
- 🔒 Prawdziwe sekrety (Service Account Keys) są bezpieczne w zmiennych środowiskowych

## 🔄 Co dalej?

1. Sprawdź ustawienia API Key w Firebase Console (ograniczenia domeny)
2. Przetestuj endpoint - bezpośredni dostęp powinien zwrócić 403
3. Upewnij się, że wszystkie strony działają normalnie (requesty z JavaScript powinny działać)
