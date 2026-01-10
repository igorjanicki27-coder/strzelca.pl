// Przykłady użycia funkcji logowania aktywności (activityLogs)
// Ten plik pokazuje jak używać funkcji logActivity w różnych miejscach aplikacji

// =============================================================================
// FUNKCJA POMOCNICZA - należy dodać do każdej strony korzystającej z logowania
// =============================================================================

async function logActivity(type, userId, userName, details, timestamp = null) {
    try {
        const activityData = {
            type: type,
            userId: userId,
            userName: userName,
            details: details,
            timestamp: timestamp || new Date()
        };

        const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        // Zakładamy że 'db' jest już zainicjalizowane w głównym kodzie strony
        await addDoc(collection(db, "activityLogs"), activityData);

        console.log('Aktywność zalogowana:', activityData);
    } catch (error) {
        console.error('Błąd podczas logowania aktywności:', error);
    }
}

// =============================================================================
// PRZYKŁADY UŻYCIA W RÓŻNYCH CZĘŚCIACH APLIKACJI
// =============================================================================

// 1. WYSTAWIENIE PRZEDMIOTU NA BAZARZE (kiedy bazar zostanie zaimplementowany)
async function createBazarListing(itemData, user) {
    try {
        // Kod tworzenia ogłoszenia...
        const listingId = await createListingInFirestore(itemData);

        // Zaloguj aktywność
        await logActivity(
            'BAZAR-LISTING-CREATED',
            user.uid,
            user.displayName || user.email.split('@')[0],
            `Wystawiono przedmiot: ${itemData.title} - Cena: ${itemData.price} PLN`
        );

        return listingId;
    } catch (error) {
        console.error('Błąd tworzenia ogłoszenia:', error);
    }
}

// 2. EDYCJA OGŁOSZENIA NA BAZARZE
async function updateBazarListing(listingId, updatedData, user) {
    try {
        // Kod aktualizacji ogłoszenia...
        await updateListingInFirestore(listingId, updatedData);

        // Zaloguj aktywność
        await logActivity(
            'BAZAR-LISTING-UPDATED',
            user.uid,
            user.displayName || user.email.split('@')[0],
            `Zaktualizowano ogłoszenie: ${updatedData.title} - Nowa cena: ${updatedData.price} PLN`
        );
    } catch (error) {
        console.error('Błąd aktualizacji ogłoszenia:', error);
    }
}

// 3. SKOMENTOWANIE POSTU NA BLOGu (kiedy blog zostanie zaimplementowany)
async function addBlogComment(postId, commentData, user) {
    try {
        // Kod dodawania komentarza...
        const commentId = await addCommentToFirestore(postId, commentData);

        // Zaloguj aktywność
        await logActivity(
            'BLOG-COMMENT-ADDED',
            user.uid,
            user.displayName || user.email.split('@')[0],
            `Skomentowano post: ${commentData.content.substring(0, 100)}${commentData.content.length > 100 ? '...' : ''}`
        );

        return commentId;
    } catch (error) {
        console.error('Błąd dodawania komentarza:', error);
    }
}

// 4. POLIKOWANIE (głosowanie) - jeśli zostanie zaimplementowane
async function voteOnContent(contentId, contentType, voteType, user) {
    try {
        // Kod głosowania...
        await registerVote(contentId, voteType);

        // Zaloguj aktywność
        await logActivity(
            'CONTENT-VOTE',
            user.uid,
            user.displayName || user.email.split('@')[0],
            `${voteType === 'up' ? 'Polikowano' : 'Minusy'} ${contentType}: ${contentId}`
        );
    } catch (error) {
        console.error('Błąd głosowania:', error);
    }
}

// 5. WYSTAWIONE OPINII DLA UŻYTKOWNIKÓW (już zaimplementowane w profil.html)
async function submitUserReview(ratedUserId, rating, comment, currentUser) {
    try {
        // Kod dodawania opinii...
        await addReviewToFirestore(ratedUserId, { rating, comment });

        // Zaloguj aktywność
        await logActivity(
            'USER-REVIEW',
            currentUser.uid,
            currentUser.displayName || currentUser.email.split('@')[0],
            `Ocena użytkownika ${ratedUserId}: ${rating} gwiazdek - ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`
        );
    } catch (error) {
        console.error('Błąd dodawania opinii:', error);
    }
}

// =============================================================================
// LISTA WSZYSTKICH TYPÓW AKTYWNOŚCI DO LOGOWANIA
// =============================================================================

const ACTIVITY_TYPES = {
    // Komunikacja
    'NEW-MESSAGE': 'Wysłanie nowej wiadomości/czatu',
    'MESSAGE-REPLY': 'Odpowiedź na wiadomość',

    // Zakupy i zamówienia
    'ORDER-PLACED': 'Składanie zamówienia w sklepie',
    'ORDER-CANCELLED': 'Anulowanie zamówienia',
    'ORDER-COMPLETED': 'Ukończenie zamówienia',

    // Bazar
    'BAZAR-LISTING-CREATED': 'Wystawienie przedmiotu na bazarze',
    'BAZAR-LISTING-UPDATED': 'Edycja ogłoszenia na bazarze',
    'BAZAR-LISTING-DELETED': 'Usunięcie ogłoszenia z bazaru',
    'BAZAR-LISTING-SOLD': 'Oznaczenie przedmiotu jako sprzedanego',

    // Blog/Social media
    'BLOG-POST-CREATED': 'Utworzenie nowego postu na blogu',
    'BLOG-COMMENT-ADDED': 'Dodanie komentarza do postu',
    'BLOG-POST-LIKED': 'Polikowanie postu',

    // Społeczność
    'USER-REVIEW': 'Wystawienie opinii dla innego użytkownika',
    'USER-PROFILE-UPDATED': 'Aktualizacja profilu użytkownika',
    'USER-REGISTERED': 'Rejestracja nowego użytkownika',

    // Inne aktywności
    'CONTENT-VOTE': 'Głosowanie na treści',
    'NEWSLETTER-SUBSCRIBED': 'Zapisz się do newslettera',
    'NEWSLETTER-UNSUBSCRIBED': 'Wypisz się z newslettera'
};

// =============================================================================
// STRUKTURA DANYCH W FIRESTORE
// =============================================================================

/*
Dokument w kolekcji "activityLogs":

{
    type: "NEW-MESSAGE",           // Typ aktywności (z powyższej listy)
    userId: "user123",             // ID użytkownika wykonującego akcję
    userName: "Jan Kowalski",      // Nazwa wyświetlana użytkownika
    details: "Temat: Zamówienie - Treść wiadomości...", // Szczegóły aktywności
    timestamp: Timestamp           // Czas wykonania (serverTimestamp)
}
*/

// =============================================================================
// JAK UŻYWAĆ W PRAKTYCE
// =============================================================================

/*
1. Zaimportuj funkcję logActivity do swojego modułu
2. Wywołaj ją w odpowiednim miejscu w kodzie po wykonaniu akcji
3. Przekaż odpowiednie parametry:
   - type: jeden z ACTIVITY_TYPES
   - userId: ID aktualnie zalogowanego użytkownika
   - userName: wyświetlana nazwa użytkownika
   - details: opis tego co się stało
   - timestamp: opcjonalny, domyślnie aktualny czas

Przykład:
await logActivity('BAZAR-LISTING-CREATED', user.uid, user.displayName, 'Wystawiono karabin XYZ za 1500 PLN');
*/
