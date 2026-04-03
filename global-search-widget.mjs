// Global Search Widget (floating launcher + centered modal)
// Visible across subpages (where script is included), above messages widget.

const SEARCH_MIN_CHARS = 3;
const SEARCH_LIMIT_ALL = 3;
const SEARCH_LIMIT_SINGLE = 10;
const SEARCH_FETCH_LIMIT_ALL = 40;
const SEARCH_FETCH_LIMIT_SINGLE = 90;
const SEARCH_TYPE_ORDER = ["user", "shop", "event", "blog", "bazar"];
const SEARCH_TYPE_LABEL = {
  user: "Użytkownicy",
  shop: "Sklep",
  event: "Wydarzenia",
  blog: "Blog",
  bazar: "Bazar",
};
const STORAGE_RECENT_ITEMS = "__strzelca_global_search_recent_items_v1";

function normalizeText(input) {
  if (input == null) return "";
  return String(input)
    .replace(/[Łł]/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(input) {
  if (!input) return "";
  return String(input)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(text) {
  const n = normalizeText(text);
  if (!n) return [];
  return Array.from(new Set(n.split(" ").filter((x) => x.length >= 2)));
}

function coerceArray(v) {
  return Array.isArray(v) ? v : [];
}

function searchEntryKey(entry) {
  return `${entry.type}:${entry.sourceId || entry.slug || entry.title || ""}`;
}

function toSnippet(raw) {
  const plain = stripHtml(raw || "");
  if (!plain) return "";
  if (plain.length <= 140) return plain;
  return `${plain.slice(0, 139).trim()}…`;
}

function loadRecentItems() {
  try {
    const raw = localStorage.getItem(STORAGE_RECENT_ITEMS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentItems(list) {
  try {
    localStorage.setItem(STORAGE_RECENT_ITEMS, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function pushRecentItem(entry) {
  if (!entry) return;
  const key = searchEntryKey(entry);
  const list = loadRecentItems();
  const prev = list.find((x) => x.key === key);
  const nextItem = {
    key,
    type: entry.type,
    sourceId: entry.sourceId || "",
    title: entry.title || "",
    snippet: entry.snippet || "",
    url: entry.url || "",
    slug: entry.slug || "",
    clicks: Number(prev?.clicks || 0) + 1,
    lastClickedAt: Date.now(),
  };
  const next = [nextItem, ...list.filter((x) => x.key !== key)].slice(0, 80);
  saveRecentItems(next);
}

function makeStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .launcher {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid rgba(193,154,107,0.45);
      background: rgba(10,10,10,0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: rgba(193,154,107,0.95);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .launcher:hover {
      border-color: rgba(193,154,107,0.8);
      color: #fff;
    }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.42);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .overlay.open { display: flex; }
    .modal {
      width: min(860px, 94vw);
      max-height: min(72vh, 700px);
      border-radius: 18px;
      border: 1px solid rgba(193,154,107,0.32);
      background: linear-gradient(120deg, rgba(22,22,22,0.9), rgba(10,10,10,0.84));
      box-shadow: 0 22px 64px rgba(0,0,0,0.55);
      overflow: hidden;
      color: #f2f2f2;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(193,154,107,0.22);
    }
    .input {
      width: 100%;
      border: none;
      outline: none;
      background: transparent;
      color: #f2f2f2;
      font-size: 20px;
      line-height: 1.2;
      padding: 4px 2px;
    }
    .input::placeholder { color: rgba(229,229,229,0.45); }
    .iconBtn {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 10px;
      background: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: rgba(245,245,245,0.7);
    }
    .iconBtn.filter { color: rgba(161,161,170,0.95); }
    .iconBtn.submit { color: rgba(193,154,107,0.95); }
    .filterWrap { position: relative; }
    .filterMenu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      width: 220px;
      padding: 8px;
      border-radius: 12px;
      border: 1px solid rgba(193,154,107,0.25);
      background: rgba(8,8,8,0.96);
      box-shadow: 0 16px 32px rgba(0,0,0,0.42);
      z-index: 2;
      display: none;
    }
    .filterMenu.open { display: block; }
    .filterItem {
      width: 100%;
      text-align: left;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: rgba(236,236,236,0.88);
      padding: 8px 10px;
      font-size: 13px;
      cursor: pointer;
    }
    .filterItem:hover, .filterItem.active {
      background: rgba(193,154,107,0.14);
      border-color: rgba(193,154,107,0.3);
    }
    .results {
      padding: 10px 12px 12px;
      max-height: min(56vh, 520px);
      overflow-y: auto;
      background: rgba(7,7,7,0.72);
    }
    .group { margin-bottom: 10px; }
    .groupTitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: rgba(193,154,107,0.9);
      margin: 0 0 6px;
    }
    .item {
      width: 100%;
      text-align: left;
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 10px;
      padding: 9px 11px;
      background: rgba(18,18,18,0.62);
      color: #f2f2f2;
      cursor: pointer;
      margin-bottom: 7px;
      box-sizing: border-box;
    }
    .item:hover, .item.sel {
      border-color: rgba(193,154,107,0.75);
      background: rgba(30,30,30,0.86);
    }
    .itemTitle { font-weight: 700; font-size: 14px; }
    .itemSnippet { margin-top: 3px; font-size: 12px; color: rgba(229,229,229,0.68); }
    .empty {
      padding: 16px 6px;
      text-align: center;
      font-size: 13px;
      color: rgba(229,229,229,0.66);
    }
    @media (max-width: 900px) {
      .launcher { bottom: 16px; }
      .modal { width: min(96vw, 860px); }
      .input { font-size: 18px; }
    }
  `;
  return style;
}

function svgIcon(pathD, { width = 24, height = 24, stroke = "currentColor", fill = "none", strokeWidth = "1.8" } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", fill);
  svg.setAttribute("stroke", stroke);
  svg.setAttribute("stroke-width", strokeWidth);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", pathD);
  svg.appendChild(p);
  return svg;
}

async function getFirebaseApiKey() {
  const isMain = (window.location?.hostname || "") === "strzelca.pl";
  const urls = isMain
    ? ["/api/firebase-config", "https://strzelca.pl/api/firebase-config"]
    : ["https://strzelca.pl/api/firebase-config", "/api/firebase-config"];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: url.startsWith("http") ? "omit" : "same-origin",
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.apiKey === "string" && data.apiKey.length > 10) return data.apiKey;
    } catch {
      // ignore
    }
  }
  return null;
}

async function main() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.getElementById("strzelca-global-search-widget")) return;

  const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
  ]);

  const { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } = authMod;
  const {
    initializeFirestore,
    getFirestore,
    collection,
    query,
    where,
    limit,
    getDocs,
    setLogLevel,
  } = fsMod;

  const apiKey = await getFirebaseApiKey();
  if (!apiKey) {
    console.warn("global-search-widget: brak /api/firebase-config");
    return;
  }

  const firebaseConfig = {
    apiKey,
    authDomain: "strzelca-pl.firebaseapp.com",
    projectId: "strzelca-pl",
    storageBucket: "strzelca-pl.appspot.com",
    messagingSenderId: "511362047688",
    appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
    measurementId: "G-9EJ2R3JPVD",
  };

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  let db;
  try {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    });
  } catch (err) {
    if (err?.code === "failed-precondition") db = getFirestore(app);
    else throw err;
  }
  try {
    setLogLevel("silent");
  } catch {}

  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});
  try {
    await auth.authStateReady();
  } catch {}

  let currentUser = auth.currentUser || null;
  onAuthStateChanged(auth, (u) => {
    currentUser = u || null;
    refreshFilterVisibility();
    updateLauncherOffset();
  });

  const host = document.createElement("div");
  host.id = "strzelca-global-search-widget";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(makeStyles());

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Globalna wyszukiwarka");
  launcher.title = "Szukaj";
  launcher.appendChild(svgIcon("M11 3a8 8 0 1 0 5.29 14l4.35 4.35 1.41-1.41-4.35-4.35A8 8 0 0 0 11 3z"));
  shadow.appendChild(launcher);

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const modal = document.createElement("div");
  modal.className = "modal";
  const bar = document.createElement("div");
  bar.className = "bar";
  const filterWrap = document.createElement("div");
  filterWrap.className = "filterWrap";
  const filterBtn = document.createElement("button");
  filterBtn.className = "iconBtn filter";
  filterBtn.type = "button";
  filterBtn.setAttribute("aria-label", "Filtr kategorii");
  filterBtn.appendChild(svgIcon("M4 5h16M7 12h10M10 19h4"));
  const filterMenu = document.createElement("div");
  filterMenu.className = "filterMenu";
  filterWrap.appendChild(filterBtn);
  filterWrap.appendChild(filterMenu);

  const input = document.createElement("input");
  input.className = "input";
  input.type = "search";
  input.placeholder = "Szukaj: użytkownicy, sklep, wydarzenia, blog, bazar…";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const submitBtn = document.createElement("button");
  submitBtn.className = "iconBtn submit";
  submitBtn.type = "button";
  submitBtn.setAttribute("aria-label", "Szukaj");
  submitBtn.appendChild(svgIcon("M2 21l20-9L2 3l.01 7L17 12 2.01 14z", { fill: "currentColor", stroke: "none", strokeWidth: "0" }));

  bar.appendChild(filterWrap);
  bar.appendChild(input);
  bar.appendChild(submitBtn);

  const results = document.createElement("div");
  results.className = "results";
  results.innerHTML = '<div class="empty">Wpisz minimum 3 znaki, aby wyszukać.</div>';

  modal.appendChild(bar);
  modal.appendChild(results);
  overlay.appendChild(modal);
  shadow.appendChild(overlay);

  const state = {
    selectedCategory: "all",
    typingTimer: null,
    activeEntries: [],
    selectionIndex: -1,
    fullCache: new Map(),
  };

  function userSearchVisible() {
    return !!currentUser;
  }

  function updateLauncherOffset() {
    launcher.style.bottom = "16px";
  }

  function visibleTypes() {
    return SEARCH_TYPE_ORDER.filter((type) => type !== "user" || userSearchVisible());
  }

  function activeTypes() {
    const selected = state.selectedCategory || "all";
    if (selected === "all") return visibleTypes();
    if (selected === "user" && !userSearchVisible()) return [];
    return visibleTypes().includes(selected) ? [selected] : [];
  }

  function buildBlob(entry) {
    return normalizeText(
      [
        entry.title || "",
        entry.snippet || "",
        entry.slug || "",
        coerceArray(entry.tokens).join(" "),
        entry.meta?.category || "",
        entry.meta?.location || "",
        entry.meta?.wojewodztwo || "",
        entry.meta?.miejscowosc || "",
        entry.meta?.sellerName || "",
        entry.meta?.username || "",
      ].join(" "),
    );
  }

  function computeScore(entry, normQuery, tokens) {
    const title = normalizeText(entry.title || "");
    const blob = buildBlob(entry);
    let score = 0;
    if (title.startsWith(normQuery)) score += 180;
    if (title.includes(normQuery)) score += 110;
    if (blob.includes(normQuery)) score += 70;
    for (const tok of tokens) {
      if (title.includes(tok)) score += 22;
      if (blob.includes(tok)) score += 10;
    }
    const popularity = Number(entry.popularity || 0);
    if (Number.isFinite(popularity) && popularity > 0) score += Math.min(90, popularity);
    return score;
  }

  function mapDocToEntry(docSnap) {
    const data = docSnap.data() || {};
    return {
      type: String(data.type || "").toLowerCase(),
      sourceId: String(data.sourceId || ""),
      title: String(data.title || "").trim(),
      snippet: toSnippet(data.snippet || ""),
      url: typeof data.url === "string" ? data.url : "",
      slug: typeof data.slug === "string" ? data.slug : "",
      tokens: coerceArray(data.tokens).map((x) => String(x)),
      popularity: Number(data.popularity || 0),
      meta: data.meta && typeof data.meta === "object" ? data.meta : {},
    };
  }

  function refreshFilterVisibility() {
    const userItem = filterMenu.querySelector('[data-category="user"]');
    if (userItem) userItem.style.display = userSearchVisible() ? "" : "none";
    if (!userSearchVisible() && state.selectedCategory === "user") {
      state.selectedCategory = "all";
    }
    filterMenu.querySelectorAll(".filterItem").forEach((item) => {
      item.classList.toggle("active", item.getAttribute("data-category") === state.selectedCategory);
    });
  }

  function fillFilterMenu() {
    filterMenu.innerHTML = "";
    const rows = [
      { key: "all", label: "Wszystko" },
      { key: "user", label: "Użytkownicy" },
      { key: "shop", label: "Sklep" },
      { key: "event", label: "Wydarzenia" },
      { key: "blog", label: "Blog" },
      { key: "bazar", label: "Bazar" },
    ];
    for (const row of rows) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filterItem";
      b.setAttribute("data-category", row.key);
      b.textContent = row.label;
      b.addEventListener("click", () => {
        state.selectedCategory = row.key;
        state.fullCache.clear();
        filterMenu.classList.remove("open");
        refreshFilterVisibility();
        void runSearch();
      });
      filterMenu.appendChild(b);
    }
    refreshFilterVisibility();
  }

  function clearSelection() {
    state.selectionIndex = -1;
    state.activeEntries.forEach((e) => e.el.classList.remove("sel"));
  }

  function setSelection(index) {
    state.selectionIndex = index;
    state.activeEntries.forEach((entry, idx) => {
      entry.el.classList.toggle("sel", idx === index);
    });
  }

  function renderGroups(groups) {
    results.innerHTML = "";
    state.activeEntries = [];
    state.selectionIndex = -1;
    if (!groups.length) {
      results.innerHTML = '<div class="empty">Brak wyników.</div>';
      return;
    }
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "group";
      const h = document.createElement("h4");
      h.className = "groupTitle";
      h.textContent = group.label;
      section.appendChild(h);
      for (const item of group.items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "item";
        const t = document.createElement("div");
        t.className = "itemTitle";
        t.textContent = item.title || "";
        b.appendChild(t);
        if (item.snippet) {
          const s = document.createElement("div");
          s.className = "itemSnippet";
          s.textContent = item.snippet;
          b.appendChild(s);
        }
        b.addEventListener("click", () => openResult(item));
        section.appendChild(b);
        state.activeEntries.push({ item, el: b });
      }
      results.appendChild(section);
    }
  }

  function renderRecent() {
    const list = loadRecentItems()
      .slice()
      .sort((a, b) => Number(b.clicks || 0) - Number(a.clicks || 0))
      .slice(0, 5);
    if (!list.length) {
      results.innerHTML = '<div class="empty">Wpisz minimum 3 znaki, aby wyszukać.</div>';
      state.activeEntries = [];
      state.selectionIndex = -1;
      return;
    }
    renderGroups([{ label: "Ostatnie", items: list }]);
  }

  function groupAndLimit(entries, selectedCategory, normQuery, tokens) {
    const grouped = new Map();
    const order = activeTypes();
    for (const t of order) grouped.set(t, []);
    for (const e of entries) {
      if (!grouped.has(e.type)) continue;
      grouped.get(e.type).push(e);
    }
    const out = [];
    for (const t of order) {
      const scored = grouped
        .get(t)
        .map((entry) => ({ ...entry, score: computeScore(entry, normQuery, tokens) }))
        .sort((a, b) => b.score - a.score || Number(b.popularity || 0) - Number(a.popularity || 0));
      const lim = selectedCategory === "all" ? SEARCH_LIMIT_ALL : SEARCH_LIMIT_SINGLE;
      const items = scored.slice(0, lim);
      if (!items.length) continue;
      out.push({ type: t, label: SEARCH_TYPE_LABEL[t], items });
    }
    return out;
  }

  async function runCategoryQuery(type, primaryKey, tokens, qLimit) {
    const ref = collection(db, "searchIndex");
    const qRef = query(ref, where("type", "==", type), where("searchKeys", "array-contains", primaryKey), limit(qLimit));
    const snap = await getDocs(qRef);
    return snap.docs.map(mapDocToEntry).filter((entry) => {
      if (!entry.title) return false;
      const blob = buildBlob(entry);
      return tokens.every((tok) => blob.includes(tok));
    });
  }

  async function runSearch({ persistQuery = false } = {}) {
    const raw = input.value || "";
    const norm = normalizeText(raw);
    if (norm.length < SEARCH_MIN_CHARS) {
      renderRecent();
      return;
    }
    const selectedCategory = state.selectedCategory || "all";
    const signature = `${selectedCategory}::${norm}`;
    if (state.fullCache.has(signature)) {
      renderGroups(state.fullCache.get(signature));
      return;
    }
    const tokens = tokenizeQuery(norm);
    if (!tokens.length) {
      renderRecent();
      return;
    }
    const primaryToken = tokens.find((t) => t.length >= SEARCH_MIN_CHARS) || norm;
    const primaryKey = primaryToken.slice(0, 12);
    const types = activeTypes();
    if (!types.length) {
      results.innerHTML = '<div class="empty">Brak dostępnych kategorii dla tego konta.</div>';
      return;
    }

    results.innerHTML = '<div class="empty">Wyszukiwanie…</div>';
    const qLimit = selectedCategory === "all" ? SEARCH_FETCH_LIMIT_ALL : SEARCH_FETCH_LIMIT_SINGLE;
    const queryErrors = [];
    const rows = await Promise.all(
      types.map(async (type) => {
        try {
          return await runCategoryQuery(type, primaryKey, tokens, qLimit);
        } catch (e) {
          queryErrors.push(e);
          return [];
        }
      }),
    );
    const flat = rows.flat();
    if (!flat.length && queryErrors.length === types.length) {
      const missingIndex = queryErrors.some((err) => {
        const code = String(err?.code || "");
        const msg = String(err?.message || "").toLowerCase();
        return code.includes("failed-precondition") || msg.includes("index");
      });
      if (missingIndex) {
        results.innerHTML =
          '<div class="empty">Indeks wyszukiwania nie jest gotowy. Utwórz indeksy Firestore i uruchom reindex.</div>';
        return;
      }
    }

    const grouped = groupAndLimit(flat, selectedCategory, norm, tokens);
    state.fullCache.set(signature, grouped);
    if (state.fullCache.size > 18) {
      const first = state.fullCache.keys().next().value;
      state.fullCache.delete(first);
    }
    if (persistQuery) {
      // wpis historii robi się na kliknięciu wyniku.
    }
    renderGroups(grouped);
  }

  function openResult(entry) {
    if (!entry) return;
    pushRecentItem(entry);
    closeOverlay();
    const url = entry.url || "";
    if (url) {
      window.location.href = url;
      return;
    }
    if (entry.type === "user") {
      window.location.href = `https://konto.strzelca.pl/profil.html?uid=${encodeURIComponent(entry.sourceId || entry.slug || "")}`;
      return;
    }
    if (entry.type === "shop") {
      window.location.href = `https://sklep.strzelca.pl/?open=${encodeURIComponent(entry.sourceId || entry.slug || "")}`;
      return;
    }
    if (entry.type === "event") {
      window.location.href = `https://wydarzenia.strzelca.pl/?open=${encodeURIComponent(entry.sourceId || entry.slug || "")}`;
      return;
    }
    if (entry.type === "blog") {
      window.location.href = `https://blog.strzelca.pl/?open=${encodeURIComponent(entry.sourceId || entry.slug || "")}`;
      return;
    }
    if (entry.type === "bazar") {
      window.location.href = `https://bazar.strzelca.pl/?offer=${encodeURIComponent(entry.sourceId || entry.slug || "")}`;
    }
  }

  function openOverlay() {
    overlay.classList.add("open");
    input.focus();
    input.select();
    if ((input.value || "").trim().length >= SEARCH_MIN_CHARS) {
      void runSearch();
    } else {
      renderRecent();
    }
  }

  function closeOverlay() {
    overlay.classList.remove("open");
    filterMenu.classList.remove("open");
    clearSelection();
  }

  launcher.addEventListener("click", () => {
    if (overlay.classList.contains("open")) closeOverlay();
    else openOverlay();
  });

  filterBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    filterMenu.classList.toggle("open");
  });

  submitBtn.addEventListener("click", () => {
    void runSearch({ persistQuery: true });
  });

  input.addEventListener("input", () => {
    if (state.typingTimer) clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      void runSearch({ persistQuery: false });
    }, 220);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!state.activeEntries.length) return;
      const next = state.selectionIndex + 1 >= state.activeEntries.length ? 0 : state.selectionIndex + 1;
      setSelection(next);
      state.activeEntries[next].el.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!state.activeEntries.length) return;
      const next = state.selectionIndex - 1 < 0 ? state.activeEntries.length - 1 : state.selectionIndex - 1;
      setSelection(next);
      state.activeEntries[next].el.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.selectionIndex >= 0 && state.selectionIndex < state.activeEntries.length) {
        openResult(state.activeEntries[state.selectionIndex].item);
      } else {
        void runSearch({ persistQuery: true });
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeOverlay();
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  shadow.addEventListener("click", (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(filterWrap)) filterMenu.classList.remove("open");
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
  });

  fillFilterMenu();
  updateLauncherOffset();
  renderRecent();
}

if (typeof window !== "undefined") {
  if (!window.__strzelcaGlobalSearchWidgetLoaded) {
    window.__strzelcaGlobalSearchWidgetLoaded = true;
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => main().catch((e) => console.warn("global-search-widget:", e?.message || e)),
        { once: true },
      );
    } else {
      main().catch((e) => console.warn("global-search-widget:", e?.message || e));
    }
  }
}

