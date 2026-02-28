# Propozycja rozwiązania dla kursów online

## Przegląd rozwiązania

**Darmowe, profesjonalne rozwiązanie** oparte na:
- **Firestore** (już masz) - do przechowywania treści kursów
- **YouTube Embed API** (darmowe) - do osadzania filmów prywatnych
- **Prosty edytor HTML** (już masz w panelu admina) - do tworzenia treści
- **Estetyczny interfejs** - do przeglądania kursów

## Struktura danych w Firestore

### Kolekcja: `courseLessons`
Każda lekcja to dokument z polami:
```javascript
{
  trainingId: "ID_szkolenia",        // Do którego szkolenia należy
  order: 1,                          // Kolejność lekcji
  title: "Tytuł lekcji",             // Tytuł lekcji
  description: "Krótki opis",        // Opcjonalny opis
  content: "<html>...</html>",       // Treść HTML (z edytora)
  videoUrl: "https://youtube.com/...", // Opcjonalnie: URL filmu YouTube
  duration: 15,                      // Opcjonalnie: czas trwania w minutach
  createdAt: Timestamp,              // Data utworzenia
  updatedAt: Timestamp               // Data aktualizacji
}
```

## Funkcjonalności

### 1. Panel Admina - Zarządzanie lekcjami
- **Lista lekcji** dla wybranego szkolenia
- **Dodawanie/edycja lekcji**:
  - Tytuł
  - Opis (opcjonalny)
  - Treść HTML (używa istniejącego edytora)
  - URL filmu YouTube (opcjonalnie)
  - Czas trwania (opcjonalnie)
- **Przeciąganie** do zmiany kolejności
- **Usuwanie lekcji**

### 2. Strona kursu dla użytkownika
- **Sidebar z listą lekcji** (zaznaczona aktualna)
- **Główny obszar** z treścią lekcji:
  - Tytuł
  - Opis
  - Film YouTube (jeśli jest) - osadzony responsywnie
  - Treść HTML
- **Nawigacja**: Poprzednia/Następna lekcja
- **Postęp**: Wizualny wskaźnik ukończenia lekcji
- **Responsywny design** - działa na mobile

## Implementacja

### Krok 1: Panel Admina
Dodaj zakładkę "Lekcje" w sekcji szkoleń:
- Przycisk "Dodaj lekcję" (tylko gdy szkolenie jest wybrane)
- Lista lekcji z możliwością edycji/usuwania
- Formularz edycji lekcji (podobny do formularza szkolenia)

### Krok 2: Strona kursu
Nowa strona: `szkolenia.strzelca.pl/kurs.html?id=TRAINING_ID`
- Sprawdza dostęp użytkownika
- Ładuje lekcje z Firestore
- Wyświetla interfejs kursu

### Krok 3: YouTube Embed
Dla prywatnych filmów YouTube:
- Użyj standardowego embed: `https://www.youtube.com/embed/VIDEO_ID`
- Dla prywatnych filmów: użytkownik musi być zalogowany na YouTube
- Alternatywnie: użyj unlisted (nie wymaga logowania)

## Zalety rozwiązania

✅ **Całkowicie darmowe** - używa tylko Firebase (już masz)
✅ **Proste w użyciu** - używa istniejącego edytora HTML
✅ **Profesjonalne** - estetyczny interfejs
✅ **Elastyczne** - łatwo dodawać/edytować lekcje
✅ **Skalowalne** - obsługuje wiele szkoleń i lekcji
✅ **Responsywne** - działa na wszystkich urządzeniach

## Przykładowy wygląd

```
┌─────────────────────────────────────────┐
│  [← Powrót]  Kurs: Podstawy strzelectwa│
├──────────┬──────────────────────────────┤
│          │  📚 Lekcja 1: Wprowadzenie   │
│  Lekcje  │  ✓ Lekcja 2: Bezpieczeństwo │
│          │  ○ Lekcja 3: Celowanie      │
│  [1] ✓   │  ○ Lekcja 4: Praktyka       │
│  [2] ✓   │                              │
│  [3] →   │  ┌────────────────────────┐ │
│  [4] ○   │  │  [Film YouTube]        │ │
│          │  └────────────────────────┘ │
│          │                              │
│          │  Treść lekcji...             │
│          │                              │
│          │  [← Poprzednia] [Następna →]│
└──────────┴──────────────────────────────┘
```

## Następne kroki

1. ✅ Zmienić system zdjęć szkoleń (już zrobione)
2. ⏳ Dodać panel zarządzania lekcjami w adminie
3. ⏳ Stworzyć stronę przeglądania kursu
4. ⏳ Dodać obsługę YouTube embed
5. ⏳ Dodać śledzenie postępu użytkownika (opcjonalnie)

## Uwagi techniczne

- **YouTube prywatne filmy**: Użyj "Unlisted" zamiast "Private" - wtedy embed działa bez logowania
- **Bezpieczeństwo**: Sprawdzaj dostęp użytkownika przed pokazaniem kursu
- **Performance**: Lazy loading dla lekcji (ładowanie na żądanie)
- **SEO**: Każda lekcja może mieć własny URL (opcjonalnie)
