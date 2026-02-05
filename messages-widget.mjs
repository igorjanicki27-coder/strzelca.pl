const API_BASE = "https://strzelca.pl/api";
const LOGIN_URL = "https://konto.strzelca.pl/login.html";
const PROFILE_URL = "https://konto.strzelca.pl/profil.html";

const STORAGE_KEY_OPEN = "__strzelca_messages_widget_open";
const STORAGE_KEY_SELECTED = "__strzelca_messages_widget_selected"; // json: { type, peerId }

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

function firstLetter(name) {
  const s = (name || "").toString().trim();
  if (!s) return "U";
  return s[0].toUpperCase();
}

function getStoredOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

function setStoredOpen(v) {
  try {
    localStorage.setItem(STORAGE_KEY_OPEN, v ? "true" : "false");
  } catch {}
}

function getStoredSelected() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    if (j.type !== "support" && j.type !== "dm") return null;
    if (j.type === "dm" && (!j.peerId || typeof j.peerId !== "string")) return null;
    return j;
  } catch {
    return null;
  }
}

function setStoredSelected(sel) {
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify(sel));
  } catch {}
}

async function apiFetch(path, { method = "GET", body, timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function fetchMe() {
  const { ok, json } = await apiFetch("/me", { method: "GET" });
  if (!ok || !json) return { authenticated: false };
  return json;
}

async function fetchSupportThread(limit = 150) {
  const lim = clamp(limit, 1, 200);
  const { ok, json } = await apiFetch(`/messages/thread?peerId=admin&limit=${lim}`, { method: "GET" });
  if (!ok || !json?.success) return [];
  return Array.isArray(json?.data?.messages) ? json.data.messages : [];
}

async function fetchDmConversations(limit = 40) {
  const lim = clamp(limit, 1, 60);
  const { ok, json } = await apiFetch(`/private-messages/conversations?limit=${lim}`, { method: "GET" });
  if (!ok || !json?.success) return [];
  return Array.isArray(json?.data?.conversations) ? json.data.conversations : [];
}

async function fetchDmThread(peerId, limit = 200) {
  const lim = clamp(limit, 1, 200);
  const { ok, json } = await apiFetch(
    `/private-messages/thread?peerId=${encodeURIComponent(peerId)}&limit=${lim}`,
    { method: "GET" }
  );
  if (!ok || !json?.success) return { conversationId: null, messages: [] };
  return {
    conversationId: json?.data?.conversationId || null,
    messages: Array.isArray(json?.data?.messages) ? json.data.messages : [],
  };
}

async function fetchSupportUnreadCount(uid) {
  if (!uid) return 0;
  const { ok, json } = await apiFetch(
    `/messages?recipientId=${encodeURIComponent(uid)}&isRead=false&limit=1`,
    { method: "GET", timeoutMs: 6000 }
  );
  if (!ok || !json?.success) return 0;
  const total = Number(json?.data?.total || 0);
  return Number.isFinite(total) ? total : 0;
}

async function sendSupportMessage(content) {
  const { ok, json } = await apiFetch("/messages", { method: "POST", body: { content } });
  return ok && json?.success === true;
}

async function sendDmMessage(peerId, content) {
  const { ok, json } = await apiFetch("/private-messages", {
    method: "POST",
    body: { recipientId: peerId, content },
  });
  return ok && json?.success === true;
}

async function markSupportRead(id) {
  if (!id) return false;
  const { ok, json } = await apiFetch(`/messages/${encodeURIComponent(id)}/read`, { method: "PUT", body: {} });
  return ok && json?.success === true;
}

async function markDmConversationRead(conversationId) {
  if (!conversationId) return false;
  const { ok, json } = await apiFetch(`/private-messages/conversation/${encodeURIComponent(conversationId)}/read`, {
    method: "PUT",
    body: {},
  });
  return ok && json?.success === true;
}

async function searchUsers(q, limit = 10) {
  const qs = (q || "").toString().trim();
  if (qs.length < 2) return [];
  const lim = clamp(limit, 1, 20);
  const { ok, json } = await apiFetch(`/users?q=${encodeURIComponent(qs)}&limit=${lim}`, { method: "GET" });
  if (!ok || !json?.success) return [];
  return Array.isArray(json?.data?.users) ? json.data.users : [];
}

function scrollToBottom(el) {
  try {
    el.scrollTop = el.scrollHeight;
  } catch {}
}

function makeStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: #e5e5e5;
    }
    .btn {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(10,10,10,0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
    }
    .btn:hover { border-color: rgba(193,154,107,0.8); }
    .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #c19a6b;
      color: #000;
      font-weight: 900;
      font-size: 12px;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      border: 2px solid rgba(0,0,0,0.8);
    }
    .panel {
      position: absolute;
      right: 0;
      bottom: 70px;
      width: min(92vw, 900px);
      height: min(80vh, 600px);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,10,0.82);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 20px 70px rgba(0,0,0,0.65);
      overflow: hidden;
      display: none;
    }
    .hdr {
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      gap: 10px;
    }
    .hdrLeft { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .hdrTitle {
      font-weight: 900;
      letter-spacing: 0.01em;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .hdrTitleText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
    }
    .hdrBtns { display: flex; gap: 10px; align-items: center; }
    .ghost {
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: #e5e5e5;
      border-radius: 10px;
      padding: 8px 10px;
      font-weight: 800;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .ghost:hover { border-color: rgba(193,154,107,0.7); }
    .grid { height: calc(100% - 52px); display: grid; grid-template-columns: 300px 1fr; }
    .left { border-right: 1px solid rgba(255,255,255,0.10); overflow: auto; }
    .leftTop { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .search {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.55);
      color: #fff;
      padding: 10px 12px;
      outline: none;
      font: inherit;
      font-size: 13px;
    }
    .search:focus { border-color: rgba(193,154,107,0.7); }
    .smallHint { margin-top: 8px; font-size: 11px; color: rgba(229,229,229,0.55); }
    .sectionLabel {
      padding: 10px 12px;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(229,229,229,0.55);
    }
    .conv {
      padding: 12px 12px;
      cursor: pointer;
      display: flex;
      gap: 10px;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .conv:hover { background: rgba(255,255,255,0.04); }
    .conv.active { background: rgba(193,154,107,0.10); }
    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      overflow: hidden;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .convText { min-width: 0; flex: 1 1 auto; }
    .convNameRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .convName { font-weight: 900; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .convBadge {
      flex: 0 0 auto;
      min-width: 18px;
      height: 18px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      font-size: 11px;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
    }
    .convSub { font-size: 12px; color: rgba(229,229,229,0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .right { display: grid; grid-template-rows: 1fr auto; min-width: 0; }
    .msgs {
      overflow: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .bubbleRow { display: flex; }
    .bubbleRow.me { justify-content: flex-end; }
    .bubble {
      max-width: min(640px, 74%);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      padding: 10px 12px;
      background: rgba(255,255,255,0.06);
      line-height: 1.35;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .bubble.me { background: rgba(193,154,107,0.18); border-color: rgba(193,154,107,0.28); }
    .meta { margin-top: 6px; font-size: 11px; color: rgba(229,229,229,0.55); text-align: right; }
    .composer {
      border-top: 1px solid rgba(255,255,255,0.10);
      padding: 10px;
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }
    textarea {
      flex: 1 1 auto;
      min-height: 44px;
      max-height: 130px;
      resize: none;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.55);
      color: #fff;
      padding: 10px 12px;
      outline: none;
      font: inherit;
      font-size: 13px;
    }
    textarea:focus { border-color: rgba(193,154,107,0.7); }
    .send {
      flex: 0 0 auto;
      border-radius: 12px;
      border: 1px solid rgba(193,154,107,0.35);
      background: rgba(193,154,107,0.92);
      color: #111;
      font-weight: 900;
      cursor: pointer;
      padding: 10px 14px;
    }
    .send:disabled { opacity: 0.45; cursor: not-allowed; }
    .empty { color: rgba(229,229,229,0.70); font-size: 13px; padding: 18px; }

    @media (max-width: 900px) { .grid { grid-template-columns: 260px 1fr; } }
    @media (max-width: 640px) {
      .panel { width: min(96vw, 900px); height: min(84vh, 600px); }
      .grid { grid-template-columns: 1fr; }
      .left { display: none; }
    }
  `;
  return style;
}

function svgChatIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.color = "#e5e5e5";
  const p1 = document.createElementNS(ns, "path");
  p1.setAttribute("d", "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z");
  const p2 = document.createElementNS(ns, "path");
  p2.setAttribute("d", "M8 10h.01M12 10h.01M16 10h.01");
  svg.appendChild(p1);
  svg.appendChild(p2);
  return svg;
}

function setBadgeEl(badgeEl, n) {
  const count = clamp(n, 0, 999);
  if (count <= 0) {
    badgeEl.style.display = "none";
    badgeEl.textContent = "";
    return;
  }
  badgeEl.style.display = "inline-flex";
  badgeEl.textContent = count > 99 ? "99+" : String(count);
}

async function main() {
  if (!document?.body) return;

  const me = await fetchMe().catch(() => ({ authenticated: false }));
  if (!me || me.success !== true || me.authenticated !== true || !me.uid) return;

  const uid = me.uid;

  // Root/shadow
  const host = document.createElement("div");
  host.id = "strzelca-messages-widget";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(makeStyles());

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Wiadomości");
  btn.appendChild(svgChatIcon());

  const badge = document.createElement("div");
  badge.className = "badge";
  btn.appendChild(badge);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Wiadomości");

  // Header
  const hdr = document.createElement("div");
  hdr.className = "hdr";

  const hdrLeft = document.createElement("div");
  hdrLeft.className = "hdrLeft";

  const hdrTitle = document.createElement("div");
  hdrTitle.className = "hdrTitle";
  const dot = document.createElement("span");
  dot.className = "dot";
  const titleText = document.createElement("span");
  titleText.className = "hdrTitleText";
  titleText.textContent = "Wiadomości";
  hdrTitle.appendChild(dot);
  hdrTitle.appendChild(titleText);
  hdrLeft.appendChild(hdrTitle);

  const hdrBtns = document.createElement("div");
  hdrBtns.className = "hdrBtns";

  const profileBtn = document.createElement("a");
  profileBtn.className = "ghost";
  profileBtn.textContent = "Profil";
  profileBtn.href = PROFILE_URL;
  profileBtn.target = "_blank";
  profileBtn.rel = "noopener noreferrer";

  const closeBtn = document.createElement("button");
  closeBtn.className = "ghost";
  closeBtn.type = "button";
  closeBtn.textContent = "Zamknij";

  hdrBtns.appendChild(profileBtn);
  hdrBtns.appendChild(closeBtn);

  hdr.appendChild(hdrLeft);
  hdr.appendChild(hdrBtns);

  // Grid
  const grid = document.createElement("div");
  grid.className = "grid";

  const left = document.createElement("div");
  left.className = "left";

  const leftTop = document.createElement("div");
  leftTop.className = "leftTop";
  const searchInput = document.createElement("input");
  searchInput.className = "search";
  searchInput.placeholder = "Szukaj po nicku (min. 2 znaki)…";
  const hint = document.createElement("div");
  hint.className = "smallHint";
  hint.textContent = "Wyniki pokazują się poniżej. Kliknij, aby otworzyć rozmowę.";
  leftTop.appendChild(searchInput);
  leftTop.appendChild(hint);

  const resultsLabel = document.createElement("div");
  resultsLabel.className = "sectionLabel";
  resultsLabel.textContent = "Wyniki";

  const resultsList = document.createElement("div");

  const convLabel = document.createElement("div");
  convLabel.className = "sectionLabel";
  convLabel.textContent = "Konwersacje";

  const convList = document.createElement("div");

  left.appendChild(leftTop);
  left.appendChild(resultsLabel);
  left.appendChild(resultsList);
  left.appendChild(convLabel);
  left.appendChild(convList);

  const right = document.createElement("div");
  right.className = "right";
  const msgs = document.createElement("div");
  msgs.className = "msgs";
  const composer = document.createElement("div");
  composer.className = "composer";
  const ta = document.createElement("textarea");
  ta.placeholder = "Napisz wiadomość…";
  ta.setAttribute("rows", "1");
  const sendBtn = document.createElement("button");
  sendBtn.className = "send";
  sendBtn.type = "button";
  sendBtn.textContent = "Wyślij";
  composer.appendChild(ta);
  composer.appendChild(sendBtn);
  right.appendChild(msgs);
  right.appendChild(composer);

  grid.appendChild(left);
  grid.appendChild(right);
  panel.appendChild(hdr);
  panel.appendChild(grid);

  wrap.appendChild(panel);
  wrap.appendChild(btn);
  shadow.appendChild(wrap);

  let isOpen = getStoredOpen();
  let pollTimer = null;
  let unreadTimer = null;

  let state = {
    selected: getStoredSelected() || { type: "support" },
    dmConversations: [],
    supportUnread: 0,
    dmUnreadTotal: 0,
    activeConversationId: null, // dla dm
    activePeerProfile: null, // {uid, displayName, avatar}
    searchResults: [],
  };

  function updateHeaderTitle() {
    if (state.selected?.type === "support") {
      titleText.textContent = "Obsługa Strzelca.pl";
      return;
    }
    const name = state.activePeerProfile?.displayName || "Rozmowa";
    titleText.textContent = name;
  }

  function renderAvatar(el, { displayName, avatar, fallbackLetter }) {
    el.innerHTML = "";
    if (avatar) {
      const img = document.createElement("img");
      img.src = avatar;
      img.alt = "Avatar";
      el.appendChild(img);
      return;
    }
    el.textContent = fallbackLetter || firstLetter(displayName);
  }

  function renderConvItem({ key, active, name, sub, unreadCount, avatar, letter, onClick }) {
    const conv = document.createElement("div");
    conv.className = `conv ${active ? "active" : ""}`;
    conv.dataset.key = key;

    const av = document.createElement("div");
    av.className = "avatar";
    renderAvatar(av, { displayName: name, avatar, fallbackLetter: letter });

    const text = document.createElement("div");
    text.className = "convText";

    const nameRow = document.createElement("div");
    nameRow.className = "convNameRow";

    const nameEl = document.createElement("div");
    nameEl.className = "convName";
    nameEl.textContent = name;

    const badgeEl = document.createElement("div");
    badgeEl.className = "convBadge";
    setBadgeEl(badgeEl, unreadCount || 0);

    nameRow.appendChild(nameEl);
    nameRow.appendChild(badgeEl);

    const subEl = document.createElement("div");
    subEl.className = "convSub";
    subEl.textContent = sub || "";

    text.appendChild(nameRow);
    text.appendChild(subEl);

    conv.appendChild(av);
    conv.appendChild(text);
    conv.addEventListener("click", onClick);
    return conv;
  }

  function renderSearchResults() {
    resultsList.innerHTML = "";
    const items = state.searchResults || [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Brak wyników.";
      resultsList.appendChild(empty);
      return;
    }

    for (const u of items) {
      const name = u.displayName || "Użytkownik";
      const el = renderConvItem({
        key: `sr:${u.uid}`,
        active: state.selected?.type === "dm" && state.selected?.peerId === u.uid,
        name,
        sub: "Kliknij, aby otworzyć rozmowę",
        unreadCount: 0,
        avatar: u.avatar || null,
        letter: firstLetter(name),
        onClick: () => selectDm(u.uid, { uid: u.uid, displayName: name, avatar: u.avatar || null }),
      });
      resultsList.appendChild(el);
    }
  }

  function renderConversationList() {
    convList.innerHTML = "";

    // pinned support
    const supportItem = renderConvItem({
      key: "support",
      active: state.selected?.type === "support",
      name: "Obsługa Strzelca.pl",
      sub: "Pomoc / zgłoszenia",
      unreadCount: state.supportUnread || 0,
      avatar: null,
      letter: "S",
      onClick: () => selectSupport(),
    });
    convList.appendChild(supportItem);

    for (const c of state.dmConversations || []) {
      const peer = c.peerProfile || {};
      const name = peer.displayName || "Użytkownik";
      const preview = c.lastMessage?.content ? String(c.lastMessage.content).slice(0, 70) : "Brak wiadomości";
      const el = renderConvItem({
        key: `dm:${c.peerId}`,
        active: state.selected?.type === "dm" && state.selected?.peerId === c.peerId,
        name,
        sub: preview,
        unreadCount: c.unreadCount || 0,
        avatar: peer.avatar || null,
        letter: firstLetter(name),
        onClick: () => selectDm(c.peerId, peer),
      });
      convList.appendChild(el);
    }
  }

  function renderMessages(items, { isSupport }) {
    msgs.innerHTML = "";
    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = isSupport
        ? "Napisz do obsługi — odpowiemy najszybciej jak się da."
        : "Brak wiadomości. Napisz pierwszą wiadomość.";
      msgs.appendChild(empty);
      return;
    }

    const toMarkSupportRead = [];
    for (const m of items) {
      const isMe = m.senderId === uid;
      const row = document.createElement("div");
      row.className = `bubbleRow ${isMe ? "me" : ""}`;
      const b = document.createElement("div");
      b.className = `bubble ${isMe ? "me" : ""}`;
      b.textContent = (m.content || "").toString();
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatTime(m.timestamp);
      b.appendChild(meta);
      row.appendChild(b);
      msgs.appendChild(row);

      if (isSupport && !isMe && m.recipientId === uid && m.isRead === false && m.id) {
        toMarkSupportRead.push(m.id);
      }
    }

    queueMicrotask(() => scrollToBottom(msgs));

    if (isSupport && toMarkSupportRead.length) {
      (async () => {
        for (const id of toMarkSupportRead.slice(0, 25)) {
          await markSupportRead(id).catch(() => false);
        }
        await refreshUnread();
      })();
    }
  }

  async function refreshUnread() {
    const [supportUnread, dmConvs] = await Promise.all([
      fetchSupportUnreadCount(uid).catch(() => 0),
      fetchDmConversations(40).catch(() => []),
    ]);
    state.supportUnread = supportUnread;
    state.dmConversations = dmConvs;
    state.dmUnreadTotal = (dmConvs || []).reduce((acc, x) => acc + (Number(x.unreadCount || 0) || 0), 0);

    const total = state.supportUnread + state.dmUnreadTotal;
    setBadgeEl(badge, total);
    renderConversationList();
  }

  async function selectSupport() {
    state.selected = { type: "support" };
    setStoredSelected(state.selected);
    state.activeConversationId = null;
    state.activePeerProfile = { uid: "admin", displayName: "Obsługa Strzelca.pl", avatar: null };
    updateHeaderTitle();
    msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;
    const items = await fetchSupportThread(160).catch(() => []);
    renderMessages(items, { isSupport: true });
    await refreshUnread();
  }

  async function selectDm(peerId, peerProfile) {
    state.selected = { type: "dm", peerId };
    setStoredSelected(state.selected);
    state.activePeerProfile = peerProfile || { uid: peerId, displayName: null, avatar: null };
    updateHeaderTitle();
    msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;
    const { conversationId, messages } = await fetchDmThread(peerId, 200).catch(() => ({
      conversationId: null,
      messages: [],
    }));
    state.activeConversationId = conversationId;
    renderMessages(messages, { isSupport: false });

    // Best-effort: oznacz całą konwersację jako przeczytaną (czyści liczniki)
    if (conversationId) {
      await markDmConversationRead(conversationId).catch(() => false);
    }
    await refreshUnread();
  }

  async function refreshActiveThread() {
    if (state.selected?.type === "support") {
      const items = await fetchSupportThread(160).catch(() => []);
      renderMessages(items, { isSupport: true });
      return;
    }
    if (state.selected?.type === "dm" && state.selected?.peerId) {
      const { conversationId, messages } = await fetchDmThread(state.selected.peerId, 200).catch(() => ({
        conversationId: state.activeConversationId,
        messages: [],
      }));
      state.activeConversationId = conversationId || state.activeConversationId;
      renderMessages(messages, { isSupport: false });
      if (state.activeConversationId) {
        await markDmConversationRead(state.activeConversationId).catch(() => false);
      }
    }
  }

  async function doSend() {
    const content = (ta.value || "").toString().trim();
    if (!content) return;
    sendBtn.disabled = true;
    try {
      if (state.selected?.type === "support") {
        const ok = await sendSupportMessage(content);
        if (!ok) {
          window.location.href = LOGIN_URL;
          return;
        }
      } else if (state.selected?.type === "dm" && state.selected?.peerId) {
        const ok = await sendDmMessage(state.selected.peerId, content);
        if (!ok) {
          window.location.href = LOGIN_URL;
          return;
        }
      } else {
        return;
      }
      ta.value = "";
      await refreshActiveThread();
      await refreshUnread();
    } finally {
      sendBtn.disabled = false;
      ta.focus();
    }
  }

  // Search debounce
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    const q = searchInput.value || "";
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.searchResults = await searchUsers(q, 10).catch(() => []);
      renderSearchResults();
    }, 250);
  });

  btn.addEventListener("click", () => {
    if (isOpen) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  sendBtn.addEventListener("click", doSend);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closePanel();
  });

  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(host)) return;
    closePanel();
  });

  function openPanel() {
    isOpen = true;
    setStoredOpen(true);
    panel.style.display = "block";

    // refresh lists + open selected
    refreshUnread().catch(() => {});

    const sel = state.selected || { type: "support" };
    if (sel.type === "dm" && sel.peerId) {
      selectDm(sel.peerId, state.activePeerProfile).catch(() => selectSupport());
    } else {
      selectSupport();
    }

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      refreshActiveThread().catch(() => {});
    }, 5000);
  }

  function closePanel() {
    isOpen = false;
    setStoredOpen(false);
    panel.style.display = "none";
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // init
  msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;
  resultsList.innerHTML = `<div class="empty">Wpisz nick, aby wyszukać…</div>`;
  await refreshUnread().catch(() => {});

  if (unreadTimer) clearInterval(unreadTimer);
  unreadTimer = setInterval(() => {
    if (!isOpen) refreshUnread().catch(() => {});
  }, 20000);

  if (isOpen) openPanel();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main, { once: true });
  } else {
    main();
  }
}

