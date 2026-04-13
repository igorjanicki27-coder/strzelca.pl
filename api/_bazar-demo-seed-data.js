/**
 * Szablony testowych ogłoszeń Bazaru — treści fikcyjne, wyłącznie do środowisk testowych.
 * Zdjęcia: zewnętrzne HTTPS (placeholder), zgodnie z walidacją validateBazarImages w api/bazar.js.
 */

const LOC = {
  warszawa: '756135',
  krakow: '3094802',
  wroclaw: '3081368',
  gdansk: '3099434',
  poznan: '3088171',
  katowice: '3096472',
};

/** Krótkie, różne URL-e obrazów (łącznie << 1 MiB limitu UTF-8). */
function pics(ids) {
  return ids.map((id) => `https://picsum.photos/id/${id}/960/720`);
}

function getBazarDemoOfferTemplates() {
  return [
    // PISTOLET × 3
    {
      title: '[DEMO] Pistolet sportowy — komplet strzelecki (fikcja)',
      description:
        'Ogłoszenie testowe STRZELCA.PL. Broń i dane są przykładowe. Stan wizualny bardzo dobry, strzelane wyłącznie na strzelnicy. W komplecie kabura Kydex, 3 magazynki, oryginalne pudełko (uszkodzone). Sprzedaż wyłącznie osobie z dokumentem.',
      price: 4299,
      category: 'PISTOLET',
      condition: 'UZYWANY',
      locationId: LOC.warszawa,
      images: pics([237, 433]),
    },
    {
      title: '[DEMO] Pistolet defensywny full size — wersja na testy UI',
      description:
        'Treść demonstracyjna. Niski przebieg, regularny serwis smarowania. Lufa w stanie idealnym. Możliwość pokazu na strzelnicy po wcześniejszym uzgodnieniu. Cena do lekkiej negocjacji.',
      price: 3150,
      category: 'PISTOLET',
      condition: 'NOWY',
      locationId: LOC.krakow,
      images: pics([1060, 1074]),
    },
    {
      title: '[DEMO] Pistolet kompaktowy — zestaw na zawody IPSC (mock)',
      description:
        'Zestaw przygotowany pod zawody — szyna pod optykę, spust competition. W opisie wszystko, czego potrzebujesz do testów filtrów i kart na Bazarze. Nie stanowi oferty handlowej w rozumieniu prawa.',
      price: 5590,
      category: 'PISTOLET',
      condition: 'UZYWANY',
      locationId: LOC.wroclaw,
      images: pics([111, 292]),
    },
    // REWOLWER × 3
    {
      title: '[DEMO] Rewolwer .357 — klasyk, egzemplarz kolekcjonerski (test)',
      description:
        'Dane zmyślone. Drewniana okładka chwytu, lekkie ślady użytkowania na cylindrze. Mechanizm suchy i płynny. Idealny do testów wyświetlania długiego tytułu i opisu w widoku szczegółów.',
      price: 6800,
      category: 'REWOLWER',
      condition: 'UZYWANY',
      locationId: LOC.poznan,
      images: pics([593, 582]),
    },
    {
      title: '[DEMO] Rewolwer stalowo-szklisty — nowy, folia (symulacja)',
      description:
        'Produkt fikcyjny. Nigdy nie strzelany, dokumentacja kompletna, numer zgrany z tabliczką. Sprawdź działanie zdjęć i statusu „nowy” w filtrach kategorii.',
      price: 7200,
      category: 'REWOLWER',
      condition: 'NOWY',
      locationId: LOC.gdansk,
      images: pics([1025, 1043]),
    },
    {
      title: '[DEMO] Rewolwer krótki — obrona osobista (placeholder treści)',
      description:
        'Krótki opis + drugie zdanie: lokalizacja Katowice, odbiór osobisty preferowany. Test lokalizacji i mapy w ekosystemie.',
      price: 4100,
      category: 'REWOLWER',
      condition: 'UZYWANY',
      locationId: LOC.katowice,
      images: pics([866, 867]),
    },
    // KARABIN × 3
    {
      title: '[DEMO] Karabin plinking .22 LR — celownik kolimatorowy (demo)',
      description:
        'Konfiguracja pod strzelanie rekreacyjne. Kolimator, szyna Picatinny, regulowany kolba. Ogłoszenie do testów sekcji karabiny i sortowania po cenie.',
      price: 2890,
      category: 'KARABIN',
      condition: 'UZYWANY',
      locationId: LOC.warszawa,
      images: pics([1011, 1012]),
    },
    {
      title: '[DEMO] Karabin sportowy — dwójnóg + pas (dane testowe)',
      description:
        'W zestawie dwójnóg, pas, osłona lufy. Broń zarejestrowana (fikcja). Świetny stan lufy. Sprzedaż po okazaniu zezwoleń — standardowy copy do UI.',
      price: 11200,
      category: 'KARABIN',
      condition: 'UZYWANY',
      locationId: LOC.krakow,
      images: pics([1026, 1036]),
    },
    {
      title: '[DEMO] Karabin myśliwski — drewno orzech (mock ogłoszenia)',
      description:
        'Elegancka kolba, przystrzelony na 100 m. Możliwość dokładki optyki. Tekst demonstracyjny dla długiego opisu i podglądu w karcie oferty.',
      price: 8950,
      category: 'KARABIN',
      condition: 'NOWY',
      locationId: LOC.wroclaw,
      images: pics([1044, 1045]),
    },
    // BRON_GLADKOLUFOWA × 3
    {
      title: '[DEMO] Strzelba myśliwska — over/under (test kategorii)',
      description:
        'Klasyk na dzikiego. Lufy chromowane, chwyt z olejem. Zdjęcia i opis służą wyłącznie testom interfejsu Bazaru STRZELCA.PL.',
      price: 6500,
      category: 'BRON_GLADKOLUFOWA',
      condition: 'UZYWANY',
      locationId: LOC.poznan,
      images: pics([1050, 1051]),
    },
    {
      title: '[DEMO] Strzelba semi-auto — regulowana kolba (symulacja)',
      description:
        'Regulacja LOP, podkładki na stopce, fiber na muszce. Stan techniczny bez zastrzeżeń (tekst przykładowy).',
      price: 5400,
      category: 'BRON_GLADKOLUFOWA',
      condition: 'UZYWANY',
      locationId: LOC.gdansk,
      images: pics([1052, 1053]),
    },
    {
      title: '[DEMO] Strzelba gładkolufowa — zestaw startowy (demo)',
      description:
        'W komplecie sling, kapturek na lufy, karta gwarancyjna (fikcyjna). Cena orientacyjna do testów koszyka kontaktowego i filtrów.',
      price: 4800,
      category: 'BRON_GLADKOLUFOWA',
      condition: 'NOWY',
      locationId: LOC.katowice,
      images: pics([1054, 1055]),
    },
    // BRON_CZARNOPROCHOWA × 3
    {
      title: '[DEMO] Rewolwer czarnoprochowy — replika historyczna (test)',
      description:
        'Czarny proch, kaliber deklarowany w dokumentacji (fikcja). Stan kolekcjonerski, strzelane sporadycznie na strzelnicy BP. Instrukcja konserwacji w zestawie.',
      price: 2200,
      category: 'BRON_CZARNOPROCHOWA',
      condition: 'UZYWANY',
      locationId: LOC.warszawa,
      images: pics([1062, 1063]),
    },
    {
      title: '[DEMO] Pistolet czarnoprochowy — zestaw z przybornikiem (mock)',
      description:
        'Komplet: pas z ładownicami, miarka prochu, szczotki. Wszystko zmyślone — chodzi o pełny przebieg QA widoku oferty.',
      price: 1850,
      category: 'BRON_CZARNOPROCHOWA',
      condition: 'UZYWANY',
      locationId: LOC.krakow,
      images: pics([1064, 1065]),
    },
    {
      title: '[DEMO] Muszkiet ozdobny — na ścianę / kolekcję (dane testowe)',
      description:
        'Dekoracyjny, nie do strzelania (opis przykładowy). Mosiężne okucia, drewno po renowacji. Do testów miniatury zdjęcia i galerii.',
      price: 3200,
      category: 'BRON_CZARNOPROCHOWA',
      condition: 'NOWY',
      locationId: LOC.wroclaw,
      images: pics([1066, 1067]),
    },
    // AMUNICJA × 3
    {
      title: '[DEMO] Amunicja 9×19 — 1000 szt. FMJ (tylko test UI)',
      description:
        'Partia zamknięta, sucha, oryginalne opakowanie. Dane wymyślone — nie kupujesz niczego przez to ogłoszenie. Test kategorii amunicja.',
      price: 890,
      category: 'AMUNICJA',
      condition: 'NOWY',
      locationId: LOC.poznan,
      images: pics([1070, 1071]),
    },
    {
      title: '[DEMO] Amunicja .223 Rem — pudełka 200 szt. (symulacja)',
      description:
        'Trzy pudełka po 200 szt. Termin ważności w przyszłości (fikcja). Sprzedaż tylko na okazane legitymacje — standardowy disclaimer w treści.',
      price: 1240,
      category: 'AMUNICJA',
      condition: 'NOWY',
      locationId: LOC.gdansk,
      images: pics([1072, 1073]),
    },
    {
      title: '[DEMO] Śrut 12/70 — mix rozmiarów (placeholder)',
      description:
        'Zestaw testowy: 250 sztuk mix 7 i 9. Suchość gwarantowana (tekst przykładowy). Sprawdź wyświetlanie niższej ceny w PLN.',
      price: 420,
      category: 'AMUNICJA',
      condition: 'UZYWANY',
      locationId: LOC.katowice,
      images: pics([1074, 1075]),
    },
    // AKCESORIA × 3
    {
      title: '[DEMO] Kabura OWB + pas strzelecki — rozmiar uniwersalny (demo)',
      description:
        'Skóra naturalna, regulacja kąta nachylenia. Pas z klamrą COBRA (fikcja). Do testów kategorii akcesoria i wielu zdjęć.',
      price: 450,
      category: 'AKCESORIA',
      condition: 'NOWY',
      locationId: LOC.warszawa,
      images: pics([1080, 1081, 1082]),
    },
    {
      title: '[DEMO] Latarka taktyczna 1000 lm — montaż na szynę (test)',
      description:
        'Akumulator 18650, USB-C, momentary tailcap. IPX8 (opis przykładowy). Sprawdź drugie ogłoszenie w akcesoriach.',
      price: 320,
      category: 'AKCESORIA',
      condition: 'UZYWANY',
      locationId: LOC.krakow,
      images: pics([1083, 1084]),
    },
    {
      title: '[DEMO] Zestaw narzędzi do czyszczenia — kal. uniwersalny (mock)',
      description:
        'Szczotki mosiężne, mata, oliwka, patyczki. Nowe, nieużywane. Treść do QA listy i wyszukiwarki (np. „czyszczenie”).',
      price: 189,
      category: 'AKCESORIA',
      condition: 'NOWY',
      locationId: LOC.wroclaw,
      images: pics([29, 30]),
    },
    // INNE × 3
    {
      title: '[DEMO] Szafa na broń — 5 stanowisk, alarm (dane fikcyjne)',
      description:
        'Metalowa, certyfikat (fikcja), zamki elektroniczne. Wymiary wys. 150 cm. Transport po uzgodnieniu — test kategorii Inne.',
      price: 4200,
      category: 'INNE',
      condition: 'UZYWANY',
      locationId: LOC.poznan,
      images: pics([24, 25]),
    },
    {
      title: '[DEMO] Tarcze papierowe — pakiet 50 szt. (symulacja)',
      description:
        'Mix IPSC i sylwetkowych. Wysyłka możliwa (tekst testowy). Niska cena do sprawdzenia sortowania rosnąco/malejąco.',
      price: 120,
      category: 'INNE',
      condition: 'NOWY',
      locationId: LOC.gdansk,
      images: pics([26, 27]),
    },
    {
      title: '[DEMO] Książka — balistyka dla strzelców (placeholder)',
      description:
        'Publikacja edukacyjna, stan idealny. ISBN zmyślony. Ostatnia pozycja zestawu demo — pełne pokrycie wszystkich kategorii.',
      price: 79,
      category: 'INNE',
      condition: 'UZYWANY',
      locationId: LOC.katowice,
      images: pics([28, 30]),
    },
  ];
}

module.exports = { getBazarDemoOfferTemplates, LOC };
