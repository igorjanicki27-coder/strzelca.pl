(function () {
  "use strict";

  // ====== Konfiguracja ======
  var MEASUREMENT_ID = "G-9EJ2R3JPVD";
  var CONSENT_COOKIE = "sc_consent";
  var CONSENT_COOKIE_MAX_AGE_DAYS = 180;
  // v2 format: JSON obiekt {"analytics":bool,"marketing":bool,"social":bool}
  var CONSENT_VERSION = "v2";
  var POLICY_URL = "https://dokumenty.strzelca.pl/";
  var LEAVE_URL = "https://strzelca.pl/leave.html";

  // ====== Definicje kategorii ======
  var CATEGORIES = [
    {
      id: "necessary",
      name: "Niezbędne",
      description:
        "Wymagane do prawidłowego działania serwisu: utrzymanie sesji logowania, bezpieczeństwo, zapamiętanie wyboru cookies. Nie można ich wyłączyć.",
      required: true,
      cookies: "sc_consent, __session",
    },
    {
      id: "analytics",
      name: "Analityczne",
      description:
        "Google Analytics 4 — pomiar ruchu, analiza zachowań użytkowników, ulepszanie serwisu. Dane są anonimizowane. Cookies: _ga, _ga_*",
      required: false,
      cookies: "_ga, _ga_*",
    },
    {
      id: "marketing",
      name: "Marketingowe",
      description:
        "Remarketing i dopasowanie treści reklamowych do Twoich zainteresowań na stronach zewnętrznych. Dane mogą być przekazywane do sieci reklamowych.",
      required: false,
      cookies: "dane remarketingowe",
    },
    {
      id: "social",
      name: "Społecznościowe i Multimedialne",
      description:
        "Integracja z mediami społecznościowymi (Facebook, Instagram) oraz platformami multimedialnymi (YouTube). Umożliwia wyświetlanie osadzonych treści.",
      required: false,
      cookies: "pliki zewnętrznych serwisów (Facebook, YouTube)",
    },
  ];

  // ====== Blokada GA na starcie ======
  try {
    window["ga-disable-" + MEASUREMENT_ID] = true;
  } catch (_) {}

  // ====== Helpers ======
  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function parseCookieMap() {
    var out = {};
    var raw = "";
    try { raw = document.cookie || ""; } catch (_) { raw = ""; }
    if (!raw) return out;
    var parts = raw.split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var eq = p.indexOf("=");
      if (eq === -1) continue;
      var k = p.slice(0, eq).trim();
      var v = p.slice(eq + 1).trim();
      if (!k) continue;
      out[k] = v;
    }
    return out;
  }

  function isDocsSite() {
    try {
      return (window.location.hostname || "").toLowerCase() === "dokumenty.strzelca.pl";
    } catch (_) { return false; }
  }

  function shouldEnforceConsentWall() {
    return !isDocsSite();
  }

  // ====== Cookie zgody ======
  // Format: v2:{analytics:true,marketing:false,social:false}
  function encodeConsent(prefs) {
    try {
      return CONSENT_VERSION + ":" + JSON.stringify(prefs);
    } catch (_) {
      return CONSENT_VERSION + ":{}";
    }
  }

  function decodeConsent(raw) {
    if (!raw) return null;
    var decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (_) {}
    if (decoded.indexOf(CONSENT_VERSION + ":") !== 0) return null;
    var jsonStr = decoded.slice((CONSENT_VERSION + ":").length);
    try {
      var obj = JSON.parse(jsonStr);
      // Walidacja – upewnij się że to obiekt z oczekiwanymi polami
      if (typeof obj === "object" && obj !== null) {
        return {
          analytics: obj.analytics === true,
          marketing: obj.marketing === true,
          social: obj.social === true,
        };
      }
    } catch (_) {}
    return null;
  }

  function getConsent() {
    var cookies = parseCookieMap();
    var raw = cookies[CONSENT_COOKIE];
    if (!raw) return null;

    // Obsługa starego formatu v1
    var decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (_) {}
    if (decoded.indexOf("v1:") === 0) {
      var v1val = decoded.slice(3);
      if (v1val === "all") return { analytics: true, marketing: false, social: false };
      if (v1val === "necessary") return { analytics: false, marketing: false, social: false };
      return null;
    }

    return decodeConsent(raw);
  }

  function setConsent(prefs) {
    var maxAge = CONSENT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    var v = encodeConsent(prefs);
    var cookie =
      CONSENT_COOKIE + "=" + encodeURIComponent(v) +
      "; Path=/" +
      "; Domain=.strzelca.pl" +
      "; Max-Age=" + maxAge +
      "; Secure" +
      "; SameSite=Lax";
    try { document.cookie = cookie; } catch (_) {}
  }

  function deleteCookie(name) {
    var exp =
      name + "=; Path=/" +
      "; Max-Age=0" +
      "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" +
      "; Secure" +
      "; SameSite=Lax";
    try { document.cookie = exp; } catch (_) {}
    try { document.cookie = exp + "; Domain=.strzelca.pl"; } catch (_) {}
  }

  function disableAnalyticsBestEffort() {
    try { window["ga-disable-" + MEASUREMENT_ID] = true; } catch (_) {}
    var cookies = parseCookieMap();
    for (var k in cookies) {
      if (!Object.prototype.hasOwnProperty.call(cookies, k)) continue;
      if (k === "_ga" || k.indexOf("_ga_") === 0) {
        deleteCookie(k);
      }
    }
  }

  function loadGoogleAnalytics() {
    if (window.__sc_ga_loaded) return;
    window.__sc_ga_loaded = true;
    try { window["ga-disable-" + MEASUREMENT_ID] = false; } catch (_) {}
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    (document.head || document.documentElement).appendChild(s);
  }

  function applyConsent(prefs) {
    if (!prefs) {
      disableAnalyticsBestEffort();
      return;
    }
    if (prefs.analytics) {
      loadGoogleAnalytics();
    } else {
      disableAnalyticsBestEffort();
    }
    // marketing i social: zapisane w cookie, strona może sprawdzać window.SC_consent
    try {
      window.SC_consent = {
        necessary: true,
        analytics: prefs.analytics,
        marketing: prefs.marketing,
        social: prefs.social,
      };
    } catch (_) {}
  }

  // ====== UI ======
  var overlayEl = null;
  var modalEl = null;

  function ensureStyles() {
    if (document.getElementById("sc-consent-styles")) return;
    var style = document.createElement("style");
    style.id = "sc-consent-styles";
    style.textContent = [
      "html.sc-consent-locked,html.sc-consent-locked body{overflow:hidden;}",
      ".sc-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}",
      ".sc-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;",
        "width:calc(100% - 32px);max-width:680px;max-height:90vh;overflow-y:auto;",
        "background:#111;border:1px solid rgba(193,154,107,.3);box-shadow:0 24px 80px rgba(0,0,0,.7);",
        "border-radius:16px;color:#e5e5e5;",
        "font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;",
        "scrollbar-width:thin;scrollbar-color:#333 transparent;}",
      ".sc-modal-inner{padding:24px 22px 20px;}",
      ".sc-title{font-size:13px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#C19A6B;margin:0 0 12px;}",
      ".sc-intro{font-size:13px;line-height:1.55;color:#b0b0b0;margin:0 0 8px;}",
      ".sc-link{color:#C19A6B;text-decoration:none;font-weight:700;}",
      ".sc-link:hover{text-decoration:underline;}",

      /* Sekcja granularna */
      ".sc-cats{margin:16px 0 0;display:flex;flex-direction:column;gap:8px;}",
      ".sc-cat{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}",
      ".sc-cat-info{flex:1;}",
      ".sc-cat-name{font-size:13px;font-weight:700;color:#e5e5e5;margin:0 0 3px;}",
      ".sc-cat-desc{font-size:11px;line-height:1.5;color:#888;margin:0;}",
      ".sc-cat-cookies{font-size:10px;color:#555;margin:4px 0 0;font-style:italic;}",

      /* Toggle switch */
      ".sc-toggle{position:relative;flex-shrink:0;width:42px;height:24px;margin-top:2px;}",
      ".sc-toggle input{opacity:0;width:0;height:0;position:absolute;}",
      ".sc-slider{position:absolute;inset:0;background:#2a2a2a;border-radius:24px;cursor:pointer;transition:background .2s;}",
      ".sc-slider::before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .2s;}",
      ".sc-toggle input:checked+.sc-slider{background:#C19A6B;}",
      ".sc-toggle input:checked+.sc-slider::before{transform:translateX(18px);}",
      ".sc-toggle input:disabled+.sc-slider{opacity:.5;cursor:not-allowed;}",
      ".sc-required-badge{font-size:10px;color:#C19A6B;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;display:block;}",

      /* Przyciski akcji – wszystkie jednakowo */
      ".sc-actions{display:flex;flex-direction:column;gap:8px;margin-top:20px;}",
      ".sc-btn{appearance:none;width:100%;padding:13px 16px;border-radius:10px;cursor:pointer;",
        "font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.07em;",
        "background:#1e1e1e;border:1px solid #333;color:#e0e0e0;transition:border-color .15s,background .15s;text-align:center;}",
      ".sc-btn:hover{border-color:#C19A6B;background:#222;}",
      ".sc-btn:active{background:#1a1a1a;}",

      /* Przycisk "opuść" – subtelny, poniżej */
      ".sc-leave{font-size:11px;color:#555;text-align:center;margin-top:12px;cursor:pointer;background:none;border:none;width:100%;padding:4px;}",
      ".sc-leave:hover{color:#888;text-decoration:underline;}",

      /* Separator */
      ".sc-divider{height:1px;background:#222;margin:16px 0 0;}",

      /* Aktualne ustawienia */
      ".sc-current{font-size:11px;color:#555;margin:12px 0 0;text-align:center;}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function createOverlayIfMissing() {
    if (overlayEl && overlayEl.isConnected) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "sc-overlay";
    overlayEl.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      openConsentModal({ mode: "initial" });
    });
    document.documentElement.appendChild(overlayEl);
  }

  function removeLockUI() {
    try { document.documentElement.classList.remove("sc-consent-locked"); } catch (_) {}
    if (overlayEl && overlayEl.isConnected) overlayEl.remove();
    overlayEl = null;
  }

  function closeModal() {
    if (modalEl && modalEl.isConnected) modalEl.remove();
    modalEl = null;
  }

  function getCheckboxState() {
    var state = {};
    CATEGORIES.forEach(function (cat) {
      if (cat.required) { state[cat.id] = true; return; }
      var el = document.getElementById("sc-chk-" + cat.id);
      state[cat.id] = el ? el.checked : false;
    });
    return state;
  }

  function openConsentModal(opts) {
    opts = opts || {};
    ensureStyles();

    if (opts.mode === "initial") {
      try { document.documentElement.classList.add("sc-consent-locked"); } catch (_) {}
      createOverlayIfMissing();
    }
    if (modalEl && modalEl.isConnected) return;

    var current = getConsent();
    var isInitial = opts.mode === "initial";

    // ---- Budujemy modal ----
    modalEl = document.createElement("div");
    modalEl.className = "sc-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-label", "Ustawienia prywatności");

    var inner = document.createElement("div");
    inner.className = "sc-modal-inner";

    // Tytuł
    var title = document.createElement("div");
    title.className = "sc-title";
    title.textContent = "Ustawienia prywatności";
    inner.appendChild(title);

    // Intro
    var intro = document.createElement("p");
    intro.className = "sc-intro";
    intro.innerHTML =
      "Używamy plików cookies niezbędnych do działania serwisu. Za Twoją zgodą możemy korzystać " +
      "z dodatkowych cookies do analizy ruchu i personalizacji. " +
      'Szczegóły: <a class="sc-link" href="' + POLICY_URL + '" target="_blank" rel="noopener">Polityka prywatności</a>.';
    inner.appendChild(intro);

    // Separator
    var div1 = document.createElement("div");
    div1.className = "sc-divider";
    inner.appendChild(div1);

    // Kategorie cookies
    var catsEl = document.createElement("div");
    catsEl.className = "sc-cats";

    CATEGORIES.forEach(function (cat) {
      var catEl = document.createElement("div");
      catEl.className = "sc-cat";

      var info = document.createElement("div");
      info.className = "sc-cat-info";

      var name = document.createElement("div");
      name.className = "sc-cat-name";
      name.textContent = cat.name;
      info.appendChild(name);

      var desc = document.createElement("div");
      desc.className = "sc-cat-desc";
      desc.textContent = cat.description;
      info.appendChild(desc);

      var cookiesInfo = document.createElement("div");
      cookiesInfo.className = "sc-cat-cookies";
      cookiesInfo.textContent = "Cookies: " + cat.cookies;
      info.appendChild(cookiesInfo);

      catEl.appendChild(info);

      // Toggle
      var toggleLabel = document.createElement("label");
      toggleLabel.className = "sc-toggle";

      var chk = document.createElement("input");
      chk.type = "checkbox";
      chk.id = "sc-chk-" + cat.id;
      chk.setAttribute("aria-label", cat.name);

      if (cat.required) {
        chk.checked = true;
        chk.disabled = true;
        // Etykieta "zawsze włączone"
        var badge = document.createElement("span");
        badge.className = "sc-required-badge";
        badge.textContent = "zawsze włączone";
        // Dodaj badge pod opisem
        info.appendChild(badge);
      } else {
        // Ustaw stan z aktualnej zgody
        if (current && current[cat.id] === true) {
          chk.checked = true;
        } else {
          chk.checked = false;
        }
      }

      var slider = document.createElement("span");
      slider.className = "sc-slider";

      toggleLabel.appendChild(chk);
      toggleLabel.appendChild(slider);
      catEl.appendChild(toggleLabel);
      catsEl.appendChild(catEl);
    });

    inner.appendChild(catsEl);

    // Separator
    var div2 = document.createElement("div");
    div2.className = "sc-divider";
    div2.style.marginTop = "16px";
    inner.appendChild(div2);

    // Aktualne ustawienie (tylko w trybie settings)
    if (!isInitial && current) {
      var currentInfo = document.createElement("div");
      currentInfo.className = "sc-current";
      var parts = [];
      if (current.analytics) parts.push("analityczne");
      if (current.marketing) parts.push("marketingowe");
      if (current.social) parts.push("społecznościowe");
      currentInfo.textContent = parts.length
        ? "Aktualnie zaakceptowane: niezbędne + " + parts.join(", ") + "."
        : "Aktualnie zaakceptowane: tylko niezbędne.";
      inner.appendChild(currentInfo);
    }

    // ---- Przyciski akcji ----
    var actions = document.createElement("div");
    actions.className = "sc-actions";

    // Btn 1: Tylko obowiązkowe
    var btnNecessary = document.createElement("button");
    btnNecessary.type = "button";
    btnNecessary.className = "sc-btn";
    btnNecessary.textContent = "Zaakceptuj tylko obowiązkowe";
    btnNecessary.addEventListener("click", function () {
      var prefs = { analytics: false, marketing: false, social: false };
      setConsent(prefs);
      applyConsent(prefs);
      // Odznacz wszystkie opcjonalne
      CATEGORIES.forEach(function(cat) {
        if (!cat.required) {
          var el = document.getElementById("sc-chk-" + cat.id);
          if (el) el.checked = false;
        }
      });
      closeModal();
      removeLockUI();
    });
    actions.appendChild(btnNecessary);

    // Btn 2: Zaakceptuj wybrane
    var btnSelected = document.createElement("button");
    btnSelected.type = "button";
    btnSelected.className = "sc-btn";
    btnSelected.textContent = "Zaakceptuj tylko wybrane";
    btnSelected.addEventListener("click", function () {
      var state = getCheckboxState();
      var prefs = {
        analytics: state.analytics === true,
        marketing: state.marketing === true,
        social: state.social === true,
      };
      setConsent(prefs);
      applyConsent(prefs);
      closeModal();
      removeLockUI();
    });
    actions.appendChild(btnSelected);

    // Btn 3: Zaakceptuj wszystkie
    var btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.className = "sc-btn";
    btnAll.textContent = "Zaakceptuj wszystkie";
    btnAll.addEventListener("click", function () {
      var prefs = { analytics: true, marketing: true, social: true };
      setConsent(prefs);
      applyConsent(prefs);
      // Zaznacz wszystkie
      CATEGORIES.forEach(function(cat) {
        var el = document.getElementById("sc-chk-" + cat.id);
        if (el) el.checked = true;
      });
      closeModal();
      removeLockUI();
    });
    actions.appendChild(btnAll);

    // Btn zamknij (tylko w trybie settings, jeśli zgoda już jest)
    if (!isInitial && current) {
      var btnClose = document.createElement("button");
      btnClose.type = "button";
      btnClose.className = "sc-btn";
      btnClose.textContent = "Zamknij bez zmian";
      btnClose.addEventListener("click", function () {
        closeModal();
      });
      actions.appendChild(btnClose);
    }

    inner.appendChild(actions);

    // Opuść stronę (tylko initial)
    if (isInitial) {
      var leaveBtn = document.createElement("button");
      leaveBtn.type = "button";
      leaveBtn.className = "sc-leave";
      leaveBtn.textContent = "Nie wyrażam zgody — opuść stronę";
      leaveBtn.addEventListener("click", function () {
        window.location.href = LEAVE_URL;
      });
      inner.appendChild(leaveBtn);
    }

    modalEl.appendChild(inner);
    document.documentElement.appendChild(modalEl);
  }

  // ====== Menu użytkownika ======
  function injectSettingsIntoUserMenus() {
    try {
      var menus = document.querySelectorAll("#user-menu");
      for (var i = 0; i < menus.length; i++) {
        var menu = menus[i];
        if (!menu || menu.querySelector("[data-sc-cookie-settings='1']")) continue;
        var a = document.createElement("a");
        a.href = "?cookies=1";
        a.setAttribute("data-sc-cookie-settings", "1");
        a.className = "block text-zinc-300 hover:text-coyote transition text-sm";
        a.style.display = "block";
        a.style.marginTop = "8px";
        a.innerHTML = '<i class="fa-solid fa-cookie-bite mr-2"></i>Ustawienia cookies';
        a.addEventListener("click", function (e) {
          e.preventDefault();
          openConsentModal({ mode: "settings" });
          try {
            var u = new URL(window.location.href);
            u.searchParams.delete("cookies");
            history.replaceState(null, "", u.toString());
          } catch (_) {}
        });
        var container = menu.querySelector(".space-y-2") || menu;
        container.appendChild(a);
      }
    } catch (_) {}
  }

  function makeCookieSettingsUrl(fromHref) {
    try {
      var u = new URL(fromHref || window.location.href, window.location.origin);
      u.searchParams.set("cookies", "1");
      return u.toString();
    } catch (_) {
      return "?cookies=1";
    }
  }

  function enhanceCookieSettingsLinks() {
    try {
      var links = document.querySelectorAll("a[href='?cookies=1']");
      var desired = makeCookieSettingsUrl(window.location.href);
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (!a) continue;
        try { a.href = desired; } catch (_) {}
        if (a.getAttribute("data-sc-cookie-settings-bound") === "1") continue;
        a.setAttribute("data-sc-cookie-settings-bound", "1");
        a.addEventListener("click", function (e) {
          try { e.preventDefault(); } catch (_) {}
          openConsentModal({ mode: "settings" });
          try {
            var u2 = new URL(window.location.href);
            u2.searchParams.delete("cookies");
            if ((u2.hash || "").toLowerCase() === "#cookies") u2.hash = "";
            history.replaceState(null, "", u2.toString());
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  // ====== Entry point ======
  function handleEntry() {
    ensureStyles();

    var wantSettings = false;
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get("cookies") === "1") wantSettings = true;
    } catch (_) {}
    try {
      if ((window.location.hash || "").toLowerCase() === "#cookies") wantSettings = true;
    } catch (_) {}

    var consent = getConsent();

    if (!consent) {
      if (shouldEnforceConsentWall()) {
        try { document.documentElement.classList.add("sc-consent-locked"); } catch (_) {}
        createOverlayIfMissing();
        openConsentModal({ mode: "initial" });
        return;
      }
      disableAnalyticsBestEffort();
      if (wantSettings) {
        openConsentModal({ mode: "settings" });
        try {
          var u3 = new URL(window.location.href);
          u3.searchParams.delete("cookies");
          if ((u3.hash || "").toLowerCase() === "#cookies") u3.hash = "";
          history.replaceState(null, "", u3.toString());
        } catch (_) {}
      }
      return;
    }

    applyConsent(consent);

    if (wantSettings) {
      openConsentModal({ mode: "settings" });
      try {
        var u2 = new URL(window.location.href);
        u2.searchParams.delete("cookies");
        if ((u2.hash || "").toLowerCase() === "#cookies") u2.hash = "";
        history.replaceState(null, "", u2.toString());
      } catch (_) {}
    }
  }

  // ====== Globalne API ======
  window.SC_openCookieSettings = function () {
    openConsentModal({ mode: "settings" });
  };

  // ====== Start ======
  (function start() {
    var consent = getConsent();
    if (!consent && shouldEnforceConsentWall()) {
      ensureStyles();
      try { document.documentElement.classList.add("sc-consent-locked"); } catch (_) {}
      createOverlayIfMissing();
    }

    function initUI() {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
      handleEntry();
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUI);
    } else {
      setTimeout(initUI, 0);
    }

    setTimeout(function () {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
    }, 1200);

    setTimeout(function () {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
    }, 4000);
  })();
})();
