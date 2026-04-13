import {
  api,
  renderFaq,
  renderLaneCards,
  renderOfferCards,
  renderPackageCards,
  showNotice,
} from "./shooting-range-client.mjs";

function byId(id) {
  return document.getElementById(id);
}

function applyConfig(data) {
  const { config, lanes, offers, packages } = data;
  document.title = `${config.brandTitle} — rezerwacje osi i szkolenia`;
  byId("hero-eyebrow").textContent = config.heroEyebrow || "STRZELNICA OTWARTA";
  byId("hero-title").textContent = config.heroTitle || "Wyjdź z obrazu. Wejdź na oś.";
  byId("hero-lead").textContent = config.heroLead || "";
  byId("hero-badge").textContent = config.heroBadge || "";
  const primary = byId("hero-primary-link");
  primary.textContent = config.heroPrimaryCtaLabel || "Zarezerwuj termin";
  primary.href = config.heroPrimaryCtaUrl || "https://strzelnica.strzelca.pl/rezerwacja";
  const secondary = byId("hero-secondary-link");
  secondary.textContent = config.heroSecondaryCtaLabel || "Zobacz osie";
  secondary.href = config.heroSecondaryCtaUrl || "#osie";

  const scene = byId("hero-scene");
  scene.style.backgroundImage = [
    "linear-gradient(180deg, rgba(5,5,5,0.15), rgba(5,5,5,0.78))",
    config.heroSceneImage ? `url("${config.heroSceneImage}")` : "",
  ].filter(Boolean).join(",");
  if (config.heroSceneOverlayImage) {
    byId("hero-foreground").style.backgroundImage = `url("${config.heroSceneOverlayImage}")`;
  }

  byId("oferta-grid").innerHTML = renderOfferCards(offers);
  byId("osie-grid").innerHTML = renderLaneCards(lanes);
  byId("pakiety-grid").innerHTML = renderPackageCards(packages);
  byId("gallery-grid").innerHTML = (config.gallery || []).length
    ? config.gallery.map((src) => `<figure class="gallery-card"><img src="${src}" alt="Galeria strzelnicy" loading="lazy" /></figure>`).join("")
    : '<div class="gallery-empty">Galerię możesz wypełnić z panelu administratora.</div>';
  byId("first-visit-copy").innerHTML = config.firstVisitHtml || "";
  byId("regulations-copy").innerHTML = config.regulationsHtml || "";
  byId("faq-list").innerHTML = renderFaq(config.faq || []);
  byId("location-name").textContent = config.locationName || "STRZELNICA STRZELCA";
  byId("location-address").textContent = config.locationAddress || "";
  byId("location-lead").textContent = config.locationLead || "";
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
  const scene = byId("hero-scene");
  const shell = byId("hero-shell");
  const foreground = byId("hero-foreground");
  if (!hero || !scene || !shell || prefersReduced || window.innerWidth < 900) {
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
      end: "+=220%",
      scrub: 1.1,
      pin: true,
      anticipatePin: 1,
    },
  });

  timeline
    .fromTo(
      scene,
      { scale: 1.14, yPercent: 0, filter: "blur(0px)" },
      { scale: 1, yPercent: -6, filter: "blur(0.4px)", ease: "none" },
      0,
    )
    .fromTo(
      foreground,
      { opacity: 0.95, yPercent: 0, scale: 1.08 },
      { opacity: 0.18, yPercent: 18, scale: 1.22, ease: "none" },
      0,
    )
    .fromTo(
      shell,
      { scale: 0.88, yPercent: 20, opacity: 0.12, borderRadius: "44px" },
      { scale: 1, yPercent: 0, opacity: 1, borderRadius: "22px", ease: "power1.out" },
      0.15,
    )
    .fromTo(
      byId("hero-copy-wrap"),
      { opacity: 1, yPercent: 0 },
      { opacity: 0.2, yPercent: -14, ease: "none" },
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
