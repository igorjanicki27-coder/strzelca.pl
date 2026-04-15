import {
  api,
  renderFaq,
  renderLaneCards,
  renderOfferCards,
  renderPackageCards,
  showNotice,
} from "./shooting-range-client.mjs";

const DEFAULT_SCENE_IMAGE =
  "https://strzelca.pl/tlo:logo/Zdjecia%20z%20GPT/Moj_Event%20-%20glowne.png";
const DEFAULT_SCENE_FALLBACK =
  "https://strzelca.pl/tlo:logo/tlo_compress.jpeg";

function byId(id) {
  return document.getElementById(id);
}

function renderDefaultOffers() {
  return [
    {
      type: "training",
      title: "Szkolenie z instruktorem",
      description:
        "Praktyczne wejście na strzelnicę prowadzone przez instruktora z doborem osi i terminu.",
      paymentMode: "on_site",
      price: 0,
      subtitle: "Płatność na miejscu",
    },
    {
      type: "offer",
      title: "Wynajem osi dla klientów indywidualnych",
      description:
        "Wybór konkretnej osi, realnej dostępności i rozliczenia godzinowego bez zbędnych kroków.",
      paymentMode: "online",
      price: 169,
      subtitle: "HotPay lub żetony",
    },
    {
      type: "offer",
      title: "Rezerwacja pod wydarzenia",
      description:
        "Elastyczne wykorzystanie osi i pakietów pod eventy, wyjścia firmowe i kameralne spotkania.",
      paymentMode: "online",
      price: 390,
      subtitle: "Oferta rozwijana z panelu",
    },
  ];
}

function renderDefaultLanes() {
  return [
    {
      name: "Oś główna 25 m",
      lengthMeters: 25,
      positions: 6,
      laneType: "otwarta",
      description:
        "Główna oś strzelnicy przygotowana pod regularne wejścia, treningi i wydarzenia.",
      pricePerHour: 160,
      companyPricePerHour: 220,
      heroImage: "",
    },
    {
      name: "Oś treningowa 50 m",
      lengthMeters: 50,
      positions: 4,
      laneType: "otwarta",
      description:
        "Dłuższa oś pod bardziej wymagające sesje i szkolenia prowadzone z instruktorem.",
      pricePerHour: 220,
      companyPricePerHour: 300,
      heroImage: "",
    },
  ];
}

function renderDefaultPackages() {
  return [
    {
      badge: "Starter",
      title: "Pierwsza wizyta z instruktorem",
      description:
        "Pakiet dla osób, które chcą wejść na strzelnicę pierwszy raz i przejść cały proces z opieką.",
      price: 299,
      companyPrice: 359,
    },
    {
      badge: "Event",
      title: "Pakiet firmowy",
      description:
        "Doświadczenie dla zespołów i grup, z naciskiem na sprawną logistykę i czytelny harmonogram.",
      price: 799,
      companyPrice: 920,
    },
  ];
}

function applyConfig(data) {
  const config = data?.config || {};
  const lanes = data?.lanes || [];
  const offers = data?.offers || [];
  const packages = data?.packages || [];
  document.title = `${config.brandTitle || "STRZELNICA STRZELCA"} — rezerwacje osi i szkolenia`;
  byId("hero-eyebrow").textContent = config.heroEyebrow || "STRZELNICA OTWARTA";
  byId("hero-title").textContent = config.heroTitle || "Wyjdź z obrazu. Wejdź na oś.";
  byId("hero-lead").textContent =
    config.heroLead ||
    "Nowa podstrona strzelnicy łączy sceniczną prezentację obiektu z realnym systemem rezerwacji osi, szkoleń i voucherów. Użytkownik zaczyna od wrażenia, ale kończy na konkretnej akcji.";
  byId("hero-badge").innerHTML = config.heroBadge
    ? `<i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>${config.heroBadge}`
    : '<i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Otwarta strzelnica • szkolenia • vouchery';
  const primary = byId("hero-primary-link");
  primary.innerHTML = `<i class="fa-solid fa-calendar-check" aria-hidden="true"></i>${config.heroPrimaryCtaLabel || "Zarezerwuj termin"}`;
  primary.href = config.heroPrimaryCtaUrl || "https://strzelnica.strzelca.pl/rezerwacja";
  const secondary = byId("hero-secondary-link");
  secondary.innerHTML = `<i class="fa-solid fa-bullseye" aria-hidden="true"></i>${config.heroSecondaryCtaLabel || "Zobacz osie"}`;
  secondary.href = config.heroSecondaryCtaUrl || "#osie";

  const scene = byId("hero-scene");
  scene.style.backgroundImage = [
    `url("${config.heroSceneImage || DEFAULT_SCENE_IMAGE}")`,
    `url("${DEFAULT_SCENE_FALLBACK}")`,
  ].join(",");
  if (config.heroSceneOverlayImage) {
    byId("hero-foreground").style.backgroundImage = [
      `url("${config.heroSceneOverlayImage}")`,
      "radial-gradient(circle at 78% 18%, rgba(193, 154, 107, 0.2), transparent 22%)",
      "radial-gradient(circle at 18% 78%, rgba(255, 255, 255, 0.08), transparent 20%)",
    ].join(",");
  }

  byId("oferta-grid").innerHTML = renderOfferCards((offers || []).length ? offers : renderDefaultOffers());
  byId("osie-grid").innerHTML = renderLaneCards((lanes || []).length ? lanes : renderDefaultLanes());
  byId("pakiety-grid").innerHTML = renderPackageCards(
    (packages || []).length ? packages : renderDefaultPackages(),
  );
  byId("gallery-grid").innerHTML = (config.gallery || []).length
    ? config.gallery.map((src) => `<figure class="gallery-card"><img src="${src}" alt="Galeria strzelnicy" loading="lazy" /></figure>`).join("")
    : '<div class="gallery-empty">Galerię możesz wypełnić z panelu administratora.</div>';
  byId("first-visit-copy").innerHTML =
    config.firstVisitHtml ||
    `
      <p>Pierwsza rezerwacja prowadzi użytkownika przez spokojny, czytelny onboarding. Najpierw pokazujemy regulamin i warunki bezpieczeństwa, a dopiero potem przechodzimy do wyboru osi, terminu i sposobu płatności.</p>
      <p>Przy rezerwacji osi klient potwierdza pełnoletniość oraz posiadanie uprawnień prowadzącego strzelanie. Dzięki temu operator i recepcja mają komplet wymaganych informacji jeszcze przed wizytą.</p>
    `;
  byId("regulations-copy").innerHTML =
    config.regulationsHtml ||
    `
      <p>Regulaminy i zasady bezpieczeństwa są traktowane jako pełnoprawny element ścieżki rezerwacyjnej, a nie dopisek na końcu formularza. Użytkownik ma je zaakceptować przy pierwszej rezerwacji, a system zapisuje fakt i czas akceptacji.</p>
      <p>To miejsce jest gotowe na właściwy regulamin strzelnicy, instrukcję bezpieczeństwa, zasady anulowania oraz dodatkowe informacje organizacyjne.</p>
    `;
  byId("faq-list").innerHTML = renderFaq(
    (config.faq || []).length
      ? config.faq
      : [
          {
            question: "Czy mogę zarezerwować konkretną oś?",
            answer: "Tak. Klient wybiera konkretną oś i widzi tylko realnie wolne sloty czasowe dla tej osi.",
          },
          {
            question: "Jak działa szkolenie z instruktorem?",
            answer: "W kroku rezerwacji pokazujemy tylko tych instruktorów, którzy mają wolną dyspozycyjność w wybranym terminie.",
          },
          {
            question: "Czy mogę zapłacić żetonami?",
            answer: "Tak. Rezerwacje osi mogą być opłacane żetonami z bazaru albo przez HotPay, zależnie od wybranej ścieżki.",
          },
        ],
  );
  byId("location-name").textContent = config.locationName || "STRZELNICA STRZELCA";
  byId("location-address").textContent =
    config.locationAddress || "Adres i szczegóły dojazdu możesz teraz uzupełniać z panelu administracyjnego.";
  byId("location-lead").textContent =
    config.locationLead || "Mapa, dojazd i kontakt są utrzymywane z panelu, dzięki czemu strona nie wymaga ręcznych wdrożeń przy każdej zmianie danych.";
  const map = byId("location-map");
  if (config.locationMapEmbedUrl) {
    map.src = config.locationMapEmbedUrl;
    map.classList.remove("hidden");
  } else {
    map.classList.add("hidden");
  }
}

function initHeroAnimation() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hero = byId("cinematic-hero");
  const frame = byId("hero-stage-frame");
  const scene = byId("hero-scene");
  const shell = byId("hero-shell");
  const foreground = byId("hero-foreground");
  const copy = byId("hero-copy-wrap");
  if (!hero || !frame || !scene || !shell || !copy || prefersReduced || window.innerWidth < 900) {
    document.documentElement.classList.add("reveal-fallback");
    return;
  }

  if (!window.gsap || !window.ScrollTrigger) {
    document.documentElement.classList.add("reveal-fallback");
    return;
  }

  const { gsap } = window;
  window.ScrollTrigger.defaults({
    scrub: true,
    invalidateOnRefresh: true,
  });

  // Sekwencja jest warstwowa: najpierw żyje sama scena, potem odsłaniamy „shell” strony.
  const timeline = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: "top top",
      end: "+=190%",
      scrub: 1,
      pin: true,
      anticipatePin: 1,
    },
  });

  timeline
    .fromTo(
      frame,
      { scale: 1.16, yPercent: 0, borderRadius: "0px" },
      { scale: 0.84, yPercent: -8, borderRadius: "34px", ease: "none" },
      0,
    )
    .fromTo(
      scene,
      { scale: 1.02, yPercent: 0, filter: "blur(0px)" },
      { scale: 1.16, yPercent: 8, filter: "blur(1px)", ease: "none" },
      0,
    )
    .fromTo(
      foreground,
      { opacity: 0.92, yPercent: 0, scale: 1 },
      { opacity: 0.24, yPercent: 10, scale: 1.08, ease: "none" },
      0,
    )
    .fromTo(
      shell,
      { scale: 0.92, yPercent: 20, opacity: 0.08, borderRadius: "40px" },
      { scale: 1, yPercent: 0, opacity: 1, borderRadius: "30px", ease: "power1.out" },
      0.18,
    )
    .fromTo(
      copy,
      { opacity: 1, yPercent: 0 },
      { opacity: 0.24, yPercent: -12, ease: "none" },
      0,
    );
}

async function init() {
  try {
    const data = await api("public", { auth: false });
    applyConfig(data);
    initHeroAnimation();
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Nie udało się załadować strony strzelnicy.", "error");
  }
}

init();
