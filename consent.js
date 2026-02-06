(function () {
  "use strict";

  // ====== Konfiguracja ======
  var MEASUREMENT_ID = "G-9EJ2R3JPVD";
  var CONSENT_COOKIE = "sc_consent";
  var CONSENT_COOKIE_MAX_AGE_DAYS = 180;
  var CONSENT_VERSION = "v1";
  // Linkujemy bezpośrednio do sekcji cookies w dokumentach.
  // Dokumenty muszą być czytelne nawet bez podjęcia decyzji cookies.
  var POLICY_URL = "https://dokumenty.strzelca.pl/#cookies-platformy";
  var LEAVE_URL = "https://strzelca.pl/leave.html";

  // Domyślnie blokuj GA na wszelki wypadek (gdyby gdzieś został stary snippet).
  // GA respektuje flagę window["ga-disable-<MEASUREMENT_ID>"].
  try {
    window["ga-disable-" + MEASUREMENT_ID] = true;
  } catch (_) {}

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function parseCookieMap() {
    var out = {};
    var raw = "";
    try {
      raw = document.cookie || "";
    } catch (_) {
      raw = "";
    }
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
    } catch (_) {
      return false;
    }
  }

  function shouldEnforceConsentWall() {
    // Pozwól czytać dokumenty/politykę cookies bez zgody (przed akceptacją).
    return !isDocsSite();
  }

  function getConsent() {
    var cookies = parseCookieMap();
    var raw = cookies[CONSENT_COOKIE];
    if (!raw) return null;
    // Format: v1:necessary | v1:all
    var decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (_) {}
    if (decoded.indexOf(CONSENT_VERSION + ":") !== 0) return null;
    var v = decoded.slice((CONSENT_VERSION + ":").length);
    if (v === "necessary" || v === "all") return v;
    return null;
  }

  function setConsent(value) {
    var maxAge = CONSENT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    var v = CONSENT_VERSION + ":" + value;
    // Wspólna zgoda dla wszystkich subdomen:
    // Domain=.strzelca.pl sprawia, że cookie jest widoczne na *.strzelca.pl i strzelca.pl
    var cookie =
      CONSENT_COOKIE +
      "=" +
      encodeURIComponent(v) +
      "; Path=/" +
      "; Domain=.strzelca.pl" +
      "; Max-Age=" +
      maxAge +
      "; Secure" +
      "; SameSite=Lax";
    try {
      document.cookie = cookie;
    } catch (_) {}
  }

  function deleteCookie(name) {
    var exp =
      name +
      "=; Path=/" +
      "; Max-Age=0" +
      "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" +
      "; Secure" +
      "; SameSite=Lax";
    // spróbuj usunąć na aktualnym hostcie
    try {
      document.cookie = exp;
    } catch (_) {}
    // spróbuj usunąć na domenie wspólnej
    try {
      document.cookie = exp + "; Domain=.strzelca.pl";
    } catch (_) {}
  }

  function disableAnalyticsBestEffort() {
    try {
      window["ga-disable-" + MEASUREMENT_ID] = true;
    } catch (_) {}

    // Best effort: usuń cookies GA (_ga, _ga_*)
    var cookies = parseCookieMap();
    for (var k in cookies) {
      if (!Object.prototype.hasOwnProperty.call(cookies, k)) continue;
      if (k === "_ga" || k.indexOf("_ga_") === 0) {
        deleteCookie(k);
      }
    }
  }

  function loadGoogleAnalytics() {
    // Jeżeli już załadowane - nic nie rób
    if (window.__sc_ga_loaded) return;
    window.__sc_ga_loaded = true;

    try {
      window["ga-disable-" + MEASUREMENT_ID] = false;
    } catch (_) {}

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID);

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    (document.head || document.documentElement).appendChild(s);
  }

  // ====== UI / blokada ======
  var overlayEl = null;
  var modalEl = null;
  // Usunięto pływający przycisk ustawień (zostaje tylko link w stopce/menu).

  function ensureStyles() {
    if (document.getElementById("sc-consent-styles")) return;
    var style = document.createElement("style");
    style.id = "sc-consent-styles";
    style.textContent =
      "html.sc-consent-locked, html.sc-consent-locked body{overflow:hidden;}" +
      ".sc-consent-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}" +
      ".sc-consent-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;max-width:720px;width:calc(100% - 32px);background:rgba(10,10,10,.96);border:1px solid rgba(193,154,107,.35);box-shadow:0 20px 80px rgba(0,0,0,.6);border-radius:18px;color:#e5e5e5;padding:18px 18px 16px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}" +
      ".sc-consent-title{font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:14px;color:#C19A6B;margin:0 0 10px;}" +
      ".sc-consent-text{margin:0 0 10px;font-size:14px;line-height:1.45;color:#cfcfcf;}" +
      ".sc-consent-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:stretch;}" +
      ".sc-consent-btn{appearance:none;border:1px solid #333;background:#121212;color:#fff;padding:12px 14px;border-radius:12px;cursor:pointer;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.06em;}" +
      ".sc-consent-btn:hover{border-color:#C19A6B;}" +
      ".sc-consent-btn-danger{border-color:rgba(239,68,68,.55);color:#ef4444;}" +
      ".sc-consent-btn-danger:hover{border-color:#ef4444;}" +
      ".sc-consent-btn-primary{background:#C19A6B;border-color:#C19A6B;color:#000;}" +
      ".sc-consent-btn-primary:hover{filter:brightness(1.05);}" +
      ".sc-consent-btn-grow{flex:1 1 260px;min-width:220px;}" +
      ".sc-consent-link{color:#C19A6B;text-decoration:none;font-weight:800;}" +
      ".sc-consent-link:hover{text-decoration:underline;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function createOverlayIfMissing() {
    if (overlayEl && overlayEl.isConnected) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "sc-consent-overlay";
    // Nie pozwól kliknąć "w tło"
    overlayEl.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openConsentModal({ mode: "initial" });
    });
    document.documentElement.appendChild(overlayEl);
  }

  function injectSettingsIntoUserMenus() {
    // W wielu subdomenach macie menu użytkownika o id="user-menu" – dokładamy tam link do ustawień.
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
    // Zachowaj istniejące parametry, dopisz/ustaw cookies=1 i zostaw hash.
    try {
      var u = new URL(fromHref || window.location.href, window.location.origin);
      u.searchParams.set("cookies", "1");
      return u.toString();
    } catch (_) {
      // fallback (gdyby URL() nie zadziałał): po prostu wróć do klasycznego linku
      return "?cookies=1";
    }
  }

  function enhanceCookieSettingsLinks() {
    // Ujednolicamy wszystkie linki typu "?cookies=1" (stopki, menu, itp.)
    // tak, żeby NIE gubiły istniejących parametrów (np. ?topic=...).
    try {
      var links = document.querySelectorAll("a[href='?cookies=1']");
      var desired = makeCookieSettingsUrl(window.location.href);
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        if (!a) continue;

        // ustaw poprawny href (żeby najechanie myszą pokazywało prawidłowy URL)
        try {
          a.href = desired;
        } catch (_) {}

        // podepnij handler 1x: nie przeładowuj strony, tylko otwórz modal ustawień
        if (a.getAttribute("data-sc-cookie-settings-bound") === "1") continue;
        a.setAttribute("data-sc-cookie-settings-bound", "1");
        a.addEventListener("click", function (e) {
          try {
            e.preventDefault();
          } catch (_) {}
          openConsentModal({ mode: "settings" });
          // posprzątaj URL (żeby odświeżenie nie otwierało ponownie)
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

  function removeLockUI() {
    try {
      document.documentElement.classList.remove("sc-consent-locked");
    } catch (_) {}
    if (overlayEl && overlayEl.isConnected) overlayEl.remove();
    overlayEl = null;
  }

  function closeModal() {
    if (modalEl && modalEl.isConnected) modalEl.remove();
    modalEl = null;
  }

  function openConsentModal(opts) {
    opts = opts || {};
    ensureStyles();

    // Jeśli to "initial", wymuś overlay + lock
    if (opts.mode === "initial") {
      try {
        document.documentElement.classList.add("sc-consent-locked");
      } catch (_) {}
      createOverlayIfMissing();
    }

    if (modalEl && modalEl.isConnected) return;

    var current = getConsent();
    var isInitial = opts.mode === "initial";

    modalEl = document.createElement("div");
    modalEl.className = "sc-consent-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");

    var title = document.createElement("div");
    title.className = "sc-consent-title";
    title.textContent = isInitial ? "Wybór cookies wymagany" : "Ustawienia cookies";

    var p1 = document.createElement("p");
    p1.className = "sc-consent-text";
    p1.innerHTML =
      "Używamy cookies <b>niezbędnych</b> do działania logowania i bezpieczeństwa (m.in. sesja SSO). " +
      "Za Twoją zgodą możemy używać też cookies <b>analitycznych</b> (Google Analytics) do pomiaru ruchu i ulepszania serwisu.";

    var p2 = document.createElement("p");
    p2.className = "sc-consent-text";
    p2.innerHTML =
      'Więcej informacji: <a class="sc-consent-link" href="' +
      POLICY_URL +
      '" target="_blank" rel="noopener noreferrer">Polityka prywatności i cookies</a>.';

    var p3 = document.createElement("p");
    p3.className = "sc-consent-text";
    p3.style.marginTop = "8px";
    p3.textContent =
      current
        ? "Aktualny wybór: " + (current === "all" ? "Akceptuj wszystkie" : "Akceptuj tylko niezbędne") + "."
        : "Wybierz jedną z opcji, aby korzystać z serwisu.";

    var actions = document.createElement("div");
    actions.className = "sc-consent-actions";

    var btnLeave = document.createElement("button");
    btnLeave.type = "button";
    btnLeave.className = "sc-consent-btn sc-consent-btn-danger";
    btnLeave.textContent = "Opuść stronę";
    btnLeave.addEventListener("click", function () {
      window.location.href = LEAVE_URL;
    });

    var btnNecessary = document.createElement("button");
    btnNecessary.type = "button";
    btnNecessary.className = "sc-consent-btn";
    btnNecessary.textContent = "Akceptuj tylko niezbędne";
    btnNecessary.addEventListener("click", function () {
      setConsent("necessary");
      disableAnalyticsBestEffort();
      closeModal();
      removeLockUI();
    });

    var btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.className = "sc-consent-btn sc-consent-btn-primary sc-consent-btn-grow";
    btnAll.textContent = "Akceptuj wszystkie";
    btnAll.addEventListener("click", function () {
      setConsent("all");
      closeModal();
      removeLockUI();
      loadGoogleAnalytics();
    });

    actions.appendChild(btnLeave);
    actions.appendChild(btnNecessary);
    actions.appendChild(btnAll);

    // W trybie ustawień dodaj przycisk zamknięcia
    if (!isInitial) {
      var btnClose = document.createElement("button");
      btnClose.type = "button";
      btnClose.className = "sc-consent-btn";
      btnClose.textContent = "Zamknij";
      btnClose.addEventListener("click", function () {
        closeModal();
      });
      actions.appendChild(btnClose);
    }

    modalEl.appendChild(title);
    modalEl.appendChild(p1);
    modalEl.appendChild(p2);
    modalEl.appendChild(p3);
    modalEl.appendChild(actions);
    document.documentElement.appendChild(modalEl);
  }

  function handleEntry() {
    ensureStyles();

    // Ustawienia przez URL: ?cookies=1 albo #cookies
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
      // Na stronach dokumentów nie blokujemy treści — użytkownik musi móc
      // przeczytać politykę cookies przed wyrażeniem zgody.
      if (shouldEnforceConsentWall()) {
        try {
          document.documentElement.classList.add("sc-consent-locked");
        } catch (_) {}
        createOverlayIfMissing();
        openConsentModal({ mode: "initial" });
        return;
      }

      // Best-effort: jeżeli ktoś jest na dokumentach bez zgody, nie uruchamiaj analityki.
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

    // Zastosuj wybór
    if (consent === "all") {
      loadGoogleAnalytics();
    } else {
      disableAnalyticsBestEffort();
    }

    if (wantSettings) {
      openConsentModal({ mode: "settings" });
      // posprzątaj URL, żeby odświeżenie nie otwierało ponownie
      try {
        var u2 = new URL(window.location.href);
        u2.searchParams.delete("cookies");
        if ((u2.hash || "").toLowerCase() === "#cookies") u2.hash = "";
        history.replaceState(null, "", u2.toString());
      } catch (_) {}
    }
  }

  // API globalne (na wypadek linków/wywołań z innych skryptów)
  window.SC_openCookieSettings = function () {
    openConsentModal({ mode: "settings" });
  };

  // Start możliwie wcześnie
  (function start() {
    // Nie czekamy na DOM – lock i overlay dodajemy od razu.
    var consent = getConsent();
    if (!consent && shouldEnforceConsentWall()) {
      ensureStyles();
      try {
        document.documentElement.classList.add("sc-consent-locked");
      } catch (_) {}
      createOverlayIfMissing();
    }

    // Po gotowości DOM: UI, menu i ew. modal
    document.addEventListener("DOMContentLoaded", function () {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
      handleEntry();
    });

    // Dodatkowo: jak coś doładuje menu później, spróbuj ponownie po chwili
    setTimeout(function () {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
    }, 1200);

    // I jeszcze raz po kilku sekundach (best effort)
    setTimeout(function () {
      injectSettingsIntoUserMenus();
      enhanceCookieSettingsLinks();
    }, 4000);
  })();
})();

