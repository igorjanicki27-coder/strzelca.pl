# Firebase Storage (avatary) — konfiguracja dla strzelca.pl

Objaw: przy próbie uploadu avatara pojawia się `Preflight response is not successful. Status code: 404` do:
`https://firebasestorage.googleapis.com/v0/b/<bucket>/o?...`

Taki **404 zwykle oznacza, że bucket nie istnieje** (Storage nie został uruchomiony w projekcie) albo w kodzie jest wpisana zła nazwa bucketa.

## 1) Sprawdź czy bucket istnieje (najszybsza diagnostyka)

Wejdź w przeglądarce na (podmień `<bucket>` na to, co masz w `storageBucket`):

`https://firebasestorage.googleapis.com/v0/b/<bucket>/o?maxResults=1`

Interpretacja:
- Jeśli dostaniesz JSON z błędem **401/403** → bucket **istnieje**, problemem są reguły / autoryzacja.
- Jeśli dostaniesz **404** → bucket **nie istnieje** albo Storage nie jest zainicjalizowany w projekcie.

## 2) Włącz Storage w Firebase Console (darmowe)

1. Firebase Console → projekt **strzelca-pl**
2. **Build → Storage**
3. Kliknij **Get started**
4. Wybierz region (najczęściej **europe-west** / Frankfurt lub Warszawa jeśli dostępna)
5. Zapisz — Firebase utworzy domyślny bucket.

Po tej operacji w zakładce Storage zobaczysz nazwę bucketa (np. `strzelca-pl.appspot.com` albo inną wyświetloną przez konsolę).

## 3) Ustaw reguły Storage dla avatarów

W Firebase Console → Storage → **Rules** wklej zawartość pliku `storage.rules` z repo i kliknij **Publish**.

Plik `storage.rules` pozwala:
- zapisywać `avatars/{uid}.jpg` tylko zalogowanemu użytkownikowi o tym samym UID
- czytać avatary publicznie

## 4) Sprawdź `storageBucket` w kodzie

W plikach HTML (np. `konto.strzelca.pl/profil.html`) w konfiguracji Firebase musi być dokładnie nazwa bucketa z konsoli.

Jeśli po włączeniu Storage i ustawieniu rules nadal jest 404 — podeślij nazwę bucketa z Firebase Console (Build → Storage), a dopasuję konfigurację.

