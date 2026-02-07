# Zmienne środowiskowe Vercel - Lista kontrolna

## ⚠️ WAŻNE: Weryfikacja zmiennych środowiskowych

Upewnij się, że wszystkie poniższe zmienne są ustawione zarówno w środowisku **Production** jak i **Preview** w panelu Vercel.

## Wymagane zmienne środowiskowe

### Firebase - Konfiguracja podstawowa
- **FIREBASE_PROJECT_ID** - ID projektu Firebase (domyślnie: `strzelca-pl`)
- **FIREBASE_WEB_API_KEY** - Klucz API Firebase dla aplikacji web (wymagany przez `/api/firebase-config`)

### Firebase - Uwierzytelnianie (wybierz jedną z opcji)

**Opcja 1 (zalecana):**
- **FIREBASE_SERVICE_ACCOUNT_KEY** - JSON string z kluczem konta serwisowego Firebase

**Opcja 2:**
- **GOOGLE_APPLICATION_CREDENTIALS_JSON** - JSON string z credentials Google

**Opcja 3:**
- **GOOGLE_APPLICATION_CREDENTIALS** - Ścieżka do pliku credentials (rzadko używane w Vercel)

### Google Analytics
- **GA_PROPERTY_ID** - ID właściwości Google Analytics (wymagany przez `/api/ga-stats`)

### SSO (Single Sign-On) - Opcjonalne (mają wartości domyślne)
- **SSO_COOKIE_NAME** - Nazwa ciasteczka SSO (domyślnie: `__session`)
- **SSO_COOKIE_DOMAIN** - Domena ciasteczka SSO (domyślnie: `.strzelca.pl`)
- **SSO_COOKIE_DAYS** - Liczba dni ważności ciasteczka (domyślnie: `14`)

### Development - Opcjonalne
- **ALLOW_LOCALHOST** - Czy pozwolić na localhost (domyślnie: `false`, ustaw na `true` tylko dla developmentu)

## Instrukcja weryfikacji w Vercel

1. Zaloguj się do [Vercel Dashboard](https://vercel.com/dashboard)
2. Wybierz projekt `strzelca.pl`
3. Przejdź do **Settings** → **Environment Variables**
4. Sprawdź, czy wszystkie powyższe zmienne są ustawione dla:
   - ✅ **Production**
   - ✅ **Preview**
   - ✅ **Development** (opcjonalnie)

## Jak porównać zmienne między środowiskami

1. W panelu Vercel, w sekcji Environment Variables, możesz zobaczyć listę wszystkich zmiennych
2. Upewnij się, że zmienne w **Production** są identyczne z tymi w **Preview**
3. Zwróć szczególną uwagę na:
   - `FIREBASE_SERVICE_ACCOUNT_KEY` lub `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - `FIREBASE_WEB_API_KEY`
   - `GA_PROPERTY_ID`

## Rozwiązywanie problemu "Produkcja: Przygotowane"

Jeśli wdrożenia utknęły w statusie "Produkcja: Przygotowane":

### Krok 1: Sprawdź ustawienia gałęzi produkcyjnej w Vercel Dashboard
1. Przejdź do **Settings** → **Git**
2. Upewnij się, że **Production Branch** jest ustawiona na `main`
3. Jeśli nie, zmień ją na `main` i zapisz

### Krok 2: Zweryfikuj zmienne środowiskowe
1. Przejdź do **Settings** → **Environment Variables**
2. Sprawdź, czy wszystkie wymagane zmienne są ustawione w **Production**
3. Porównaj zmienne między **Production** i **Preview** - muszą być identyczne
4. Zwróć szczególną uwagę na:
   - `FIREBASE_SERVICE_ACCOUNT_KEY` lub `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - `FIREBASE_WEB_API_KEY`
   - `GA_PROPERTY_ID`

### Krok 3: Sprawdź logi wdrożenia
1. Przejdź do **Deployments** → wybierz najnowsze wdrożenie
2. Sprawdź **Logs** - poszukaj błędów związanych z:
   - Brakującymi zmiennymi środowiskowymi
   - Błędami kompilacji
   - Błędami w funkcjach API

### Krok 4: Wymuś ponowne wdrożenie
1. Jeśli wszystko wygląda dobrze, spróbuj:
   - Zrobić pusty commit i push do `main`: `git commit --allow-empty -m "Trigger redeploy" && git push`
   - Lub w Vercel Dashboard: **Deployments** → **Redeploy** (dla najnowszego wdrożenia)

### Krok 5: Sprawdź status wdrożenia
1. Po ponownym wdrożeniu, sprawdź czy status zmienia się z "Produkcja: Przygotowane" na "Bieżące"
2. Jeśli problem nadal występuje, sprawdź **Build Logs** i **Function Logs** w Vercel Dashboard

## Uwagi

- Zmienne środowiskowe są wrażliwe - nie commituj ich do repozytorium
- JSON strings (np. `FIREBASE_SERVICE_ACCOUNT_KEY`) muszą być poprawnie sformatowane jako jeden ciąg
- Po dodaniu/zmianie zmiennych środowiskowych, może być konieczne ponowne wdrożenie
