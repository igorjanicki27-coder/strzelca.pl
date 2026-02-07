# Diagnoza problemu z panelem admina

## Co sprawdzić:

### 1. Konsola przeglądarki (F12)
Otwórz konsolę i sprawdź:
- Czy są błędy CORS z Firestore?
- Czy endpoint `/api/firebase-config` zwraca błąd?
- Czy Firebase jest poprawnie zainicjalizowany?
- Jakie dokładne komunikaty błędów się pojawiają?

### 2. Firebase Console
Sprawdź w Firebase Console:
- **Settings → General → Your apps → Web app**
- Czy domena `strzelca.pl` jest dodana do **Authorized domains**?
- Czy API Key ma odpowiednie ograniczenia?

### 3. Vercel - Zmienne środowiskowe
Sprawdź w Vercel:
- Czy zmienna `FIREBASE_WEB_API_KEY` jest ustawiona?
- Czy wartość jest poprawna?

### 4. Firestore Security Rules
Sprawdź reguły Firestore:
- Czy użytkownik ma uprawnienia do odczytu `userProfiles`?
- Czy reguły pozwalają na sprawdzenie roli admin?

### 5. Test endpointu
Przetestuj endpoint:
```bash
curl -H "Origin: https://strzelca.pl" https://strzelca.pl/api/firebase-config
```

Powinien zwrócić JSON z `apiKey` (lub błąd 403 jeśli otwierasz bezpośrednio).

## Najczęstsze problemy:

1. **Błędy CORS z Firestore** - domena nie jest dodana w Firebase Console
2. **Brak API Key** - zmienna środowiskowa nie jest ustawiona w Vercel
3. **Reguły Firestore** - użytkownik nie ma uprawnień do odczytu profilu
4. **Problem z autoryzacją** - użytkownik nie jest zalogowany lub token wygasł

## Co zrobić:

1. **Otwórz konsolę przeglądarki** i skopiuj wszystkie błędy
2. **Sprawdź Firebase Console** - czy domena jest dodana
3. **Sprawdź Vercel** - czy zmienne środowiskowe są ustawione
4. **Przetestuj endpoint** `/api/firebase-config`

Po zebraniu tych informacji będziemy mogli dokładnie zdiagnozować problem.
