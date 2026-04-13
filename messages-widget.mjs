// Realtime Messages Widget (Firestore) - Strzelca.pl
// - floating button (prawy dolny róg) widoczny po zalogowaniu
// - lista konwersacji po lewej, czat po prawej
// - realtime (onSnapshot), bez serverless API => brak 401/500 z /api/*

const PROFILE_URL = "https://konto.strzelca.pl/profil.html";
const SUPPORT_PEER_ID = "admin"; // pinned "Pomoc" (wspólna skrzynka administracji przez /api/messages)

const STORAGE_KEY_OPEN = "__strzelca_messages_widget_open";
const STORAGE_KEY_SELECTED = "__strzelca_messages_widget_selected"; // json: { peerId }

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function firstLetter(name) {
  const s = (name || "").toString().trim();
  if (!s) return "U";
  return s[0].toUpperCase();
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

function getStoredSelectedPeerId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const peerId = j?.peerId;
    return typeof peerId === "string" && peerId.length > 8 ? peerId : null;
  } catch {
    return null;
  }
}

function setStoredSelectedPeerId(peerId) {
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify({ peerId }));
  } catch {}
}

function conversationIdFor(a, b) {
  return [String(a || ""), String(b || "")].sort().join("_");
}

/** Limit binarny zgodny z API (dokument Firestore ~1 MiB z base64). */
const MAX_MESSAGE_IMAGE_BYTES = 720 * 1024;

function stripDataUrlBase64(s) {
  const str = (s || "").toString().trim();
  const m = str.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (m) return m[2].replace(/\s/g, "");
  return str.replace(/\s/g, "");
}

function decodeBase64ToUint8(b64) {
  try {
    const clean = stripDataUrlBase64(b64);
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function verifyImageMagicBytesClient(buf, mimeType) {
  if (!buf || buf.length < 12) return false;
  if (mimeType === "image/jpeg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  if (mimeType === "image/webp") {
    const riff = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    const webp = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    return riff === "RIFF" && webp === "WEBP";
  }
  return false;
}

function isSafeRenderableAttachment(att) {
  if (!att || typeof att !== "object") return false;
  const mime = (att.mimeType || "").toString().trim().toLowerCase();
  const b64 = stripDataUrlBase64(att.dataBase64 || "");
  if (!b64 || !["image/jpeg", "image/png", "image/webp"].includes(mime)) return false;
  const bytes = decodeBase64ToUint8(b64);
  if (!bytes || bytes.length > MAX_MESSAGE_IMAGE_BYTES) return false;
  return verifyImageMagicBytesClient(bytes, mime);
}

function captionForBubble(rawContent, hasImage) {
  const t = (rawContent || "").toString().trim();
  if (hasImage && (t === "" || t === "[Zdjęcie]")) return "";
  return (rawContent || "").toString();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      if (typeof dataUrl !== "string" || !dataUrl.includes(",")) {
        reject(new Error("Odczyt pliku nie powiódł się"));
        return;
      }
      resolve(stripDataUrlBase64(dataUrl));
    };
    r.onerror = () => reject(new Error("Odczyt pliku nie powiódł się"));
    r.readAsDataURL(blob);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nie można wczytać obrazu"));
    };
    img.src = url;
  });
}

function isLikelyRasterImageFileForChat(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return false;
  if (t && /^image\//.test(t)) return true;
  const n = (file.name || "").toLowerCase();
  return /\.(jpe?g|png|webp)$/i.test(n);
}

/**
 * Kompresja do JPEG i dopasowanie rozmiaru pod limit Firestore/API (~720 KB binarnie).
 * @param {(progress01: number) => void} [onProgress] — 0…1 (wczytanie, skalowanie, kompresja, base64)
 */
async function compressImageFileToJpegAttachment(file, onProgress) {
  const rep = (p) => {
    try {
      if (typeof onProgress === "function") onProgress(Math.max(0, Math.min(1, p)));
    } catch (_) {}
  };
  if (!isLikelyRasterImageFileForChat(file)) {
    const t = (file.type || "").toLowerCase();
    if (t.includes("heic") || t.includes("heif") || /\.hei[cf]$/i.test(file.name || "")) {
      throw new Error(
        "Format HEIC/HEIF nie jest obsługiwany w przeglądarce — zapisz zdjęcie jako JPG lub PNG.",
      );
    }
    throw new Error("Wybierz plik graficzny (JPG, PNG lub WebP).");
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error("Plik jest zbyt duży (max 30 MB przed kompresją).");
  }
  rep(0.06);
  const img = await loadImageFromFile(file);
  rep(0.22);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("Nieprawidłowy obraz.");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const maxDim = 1920;

  function scaleToMax(side) {
    if (w <= side && h <= side) return;
    const sc = side / Math.max(w, h);
    w = Math.max(1, Math.round(w * sc));
    h = Math.max(1, Math.round(h * sc));
  }
  scaleToMax(maxDim);

  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  rep(0.32);

  let quality = 0.88;
  let blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("Kompresja nie powiodła się.");
  rep(0.4);

  let shrinkStep = 0;
  async function shrinkUntilOk() {
    for (;;) {
      if (blob.size <= MAX_MESSAGE_IMAGE_BYTES) return;
      shrinkStep += 1;
      rep(0.4 + Math.min(0.42, shrinkStep * 0.07));
      if (quality > 0.42) {
        quality -= 0.07;
        blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
        if (!blob) throw new Error("Kompresja nie powiodła się.");
        continue;
      }
      if (w <= 360 && h <= 360) {
        throw new Error(
          "Nie udało się zmieścić zdjęcia w bezpiecznym limicie (~720 KB). Wybierz mniejszy obraz.",
        );
      }
      w = Math.max(320, Math.round(w * 0.82));
      h = Math.max(320, Math.round(h * 0.82));
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      quality = 0.82;
      blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
      if (!blob) throw new Error("Kompresja nie powiodła się.");
    }
  }
  await shrinkUntilOk();

  rep(0.88);
  const dataBase64 = await blobToBase64(blob);
  rep(1);
  return { mimeType: "image/jpeg", dataBase64 };
}

// Funkcja pomocnicza do uzyskania URL API (zawsze używa głównej domeny)
function getApiUrl(path) {
  const isMain = (window.location?.hostname || "") === "strzelca.pl";
  if (isMain) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  // Na subdomenach zawsze używamy pełnego URL do głównej domeny
  return `https://strzelca.pl${path.startsWith("/") ? path : `/${path}`}`;
}

async function getFirebaseApiKey() {
  try {
    const cached = localStorage.getItem("firebase_web_api_key");
    if (cached && typeof cached === "string" && cached.length > 10) return cached;
  } catch {
    // ignore
  }
  const isMain = (window.location?.hostname || "") === "strzelca.pl";
  const urls = isMain
    ? ["/api/firebase-config", "https://strzelca.pl/api/firebase-config"]
    : ["https://strzelca.pl/api/firebase-config", "/api/firebase-config"];
  for (const url of urls) {
    try {
      // API key nie jest sekretem — nie wysyłamy cookies/credentials, żeby uniknąć CORS (ACACredentials).
      const res = await fetch(url, {
        cache: "no-store",
        credentials: url.startsWith("http") ? "omit" : "same-origin",
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && typeof data.apiKey === "string" && data.apiKey.length > 10) {
        try {
          localStorage.setItem("firebase_web_api_key", data.apiKey);
        } catch {
          // ignore
        }
        return data.apiKey;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function makeStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      /* Pływający przycisk wiadomości ma być pod przyciskiem wyszukiwania. */
      z-index: 2147483647;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: #e5e5e5;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      box-sizing: border-box;
    }
    /* Wspólny dolny pasek (np. Bazar): wiadomości obok innych przycisków, wyśrodkowany. */
    .wrap--dock {
      position: relative;
      right: auto;
      bottom: auto;
      z-index: 1;
      max-width: none;
      max-height: none;
    }
    .wrap--dock .panel {
      right: auto;
      left: 50%;
      transform: translateX(-50%);
    }
    .btn {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: none;
      background: rgba(10,10,10,0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.18),
        0 14px 40px rgba(0,0,0,0.45);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: box-shadow 0.2s ease;
    }
    .btn:hover {
      box-shadow:
        0 0 0 1px rgba(193,154,107,0.8),
        0 14px 40px rgba(0,0,0,0.45);
    }
    .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      background: #22c55e;
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
      /* Nad przyciskiem: .wrap ma wysokość tylko z przycisku (panel jest absolute),
         więc top:70px wypychało panel pod viewport — stąd „niewidoczny” modal. */
      bottom: calc(100% + 14px);
      top: auto;
      width: min(calc(100vw - 32px), 900px);
      max-width: calc(100vw - 32px);
      height: min(calc(100vh - 100px), 600px);
      max-height: calc(100vh - 100px);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,10,0.82);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 20px 70px rgba(0,0,0,0.65);
      overflow: hidden;
      display: none;
      box-sizing: border-box;
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
    .hdrTitleText.clickable {
      cursor: pointer;
      transition: color 0.2s ease;
    }
    .hdrTitleText.clickable:hover {
      color: rgba(193,154,107,0.9);
    }
    .dot { width: 10px; height: 10px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.12); }
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
    .grid { 
      height: calc(100% - 52px); 
      display: grid; 
      grid-template-columns: 300px 1fr; 
      min-height: 0;
      overflow: hidden;
    }
    .left { 
      border-right: 1px solid rgba(255,255,255,0.10); 
      overflow-y: auto; 
      overflow-x: hidden;
      min-width: 0;
    }
    .leftTop { 
      padding: 10px; 
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    .search {
      width: 100%;
      box-sizing: border-box;
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
    .right { 
      display: grid; 
      grid-template-rows: 1fr auto; 
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .msgs { 
      overflow-y: auto; 
      overflow-x: hidden;
      padding: 14px; 
      display: flex; 
      flex-direction: column; 
      gap: 10px;
      min-height: 0;
    }
    .bubbleRow { display: flex; }
    .bubbleRow.me { justify-content: flex-end; }
    .msgUnreadDivider {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 6px 0 4px;
      flex-shrink: 0;
    }
    .msgUnreadDivider-inner {
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent);
    }
    .bubble {
      max-width: min(640px, 74%);
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      padding: 10px 12px;
      background: rgba(255,255,255,0.06);
      line-height: 1.35;
      word-wrap: break-word;
    }
    .bubble.me { background: rgba(193,154,107,0.18); border-color: rgba(193,154,107,0.28); }
    .bubbleImg {
      max-width: 100%;
      max-height: 220px;
      width: auto;
      height: auto;
      border-radius: 10px;
      display: block;
      margin-bottom: 6px;
      object-fit: contain;
      background: rgba(0,0,0,0.25);
      cursor: zoom-in;
    }
    .imgLightbox {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .imgLightbox.open { display: block; }
    .imgLightboxBackdrop {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.92);
      z-index: 0;
      pointer-events: none;
    }
    .imgLightboxToolbar {
      position: absolute;
      top: 10px;
      right: 10px;
      left: 10px;
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      z-index: 20;
      pointer-events: none;
    }
    .imgLightboxToolbarInner {
      pointer-events: auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(18,18,18,0.96);
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .imgLightboxPct {
      font-size: 11px;
      color: rgba(229,229,229,0.6);
      min-width: 2.75rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .imgLightboxBtn {
      min-width: 40px;
      height: 40px;
      padding: 0 10px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(40,40,40,0.95);
      color: #fff;
      font-size: 18px;
      font-weight: 800;
      cursor: pointer;
      line-height: 1;
    }
    .imgLightboxBtn:hover { border-color: rgba(193,154,107,0.75); }
    .imgLightboxBtnSm { font-size: 12px; font-weight: 700; }
    .imgLightboxViewport {
      position: absolute;
      inset: 0;
      z-index: 10;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 56px 14px 20px;
      box-sizing: border-box;
    }
    .imgLightboxImg {
      max-width: 100%;
      max-height: min(85vh, 900px);
      width: auto;
      height: auto;
      object-fit: contain;
      transform-origin: center center;
      transition: transform 0.15s ease-out;
      user-select: none;
      -webkit-user-select: none;
    }
    .bubbleText { word-wrap: break-word; white-space: pre-wrap; }
    .meta { margin-top: 6px; font-size: 11px; color: rgba(229,229,229,0.55); text-align: right; }
    .composer { 
      border-top: 1px solid rgba(255,255,255,0.10); 
      padding: 12px; 
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
      min-height: 64px;
      box-sizing: border-box;
    }
    /* Jedna „kapsuła”: pole + ikony wyrównane do dołu (jak w typowych czatach) */
    .composerBar {
      display: flex;
      flex-direction: row;
      align-items: flex-end;
      gap: 10px;
      padding: 8px 10px 8px 12px;
      background: rgba(0,0,0,0.42);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      box-sizing: border-box;
      min-height: 52px;
    }
    .composerBar:focus-within {
      border-color: rgba(193,154,107,0.5);
      box-shadow: 0 0 0 1px rgba(193,154,107,0.12);
    }
    .attach {
      width: 42px;
      height: 42px;
      border-radius: 11px;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.07);
      color: #e8e8e8;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
      box-sizing: border-box;
    }
    .attach:hover { border-color: rgba(193,154,107,0.65); color: rgba(193,154,107,0.98); background: rgba(255,255,255,0.09); }
    .attach:disabled { opacity: 0.45; cursor: not-allowed; }
    .attach svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; }
    .pendingAttach {
      display: none;
      padding: 0 2px;
      width: 100%;
      box-sizing: border-box;
    }
    .pendingAttach.show { display: block; }
    .pendingAttachRow {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 10px;
      width: 100%;
    }
    .pendingThumb {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      object-fit: cover;
      border: 1px solid rgba(255,255,255,0.12);
      flex-shrink: 0;
      display: none;
      background: rgba(0,0,0,0.3);
    }
    .pendingAttachMid {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .attachProgress {
      display: none;
      width: 100%;
    }
    .attachProgressTrack {
      height: 5px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      overflow: hidden;
    }
    .attachProgressBar {
      height: 100%;
      width: 8%;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      transition: width 0.18s ease-out;
    }
    .pendingAttachLabel {
      font-size: 11px;
      color: rgba(229,229,229,0.65);
      line-height: 1.35;
    }
    .pendingRemove {
      border: none;
      background: rgba(239,68,68,0.2);
      color: #f87171;
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
    }
    textarea {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 40px;
      max-height: 130px;
      resize: none;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #fff;
      padding: 10px 4px 11px 12px;
      outline: none;
      font: inherit;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    textarea::placeholder { color: rgba(229,229,229,0.45); }
    textarea:focus { outline: none; }
    .send {
      flex: 0 0 auto;
      width: 42px;
      height: 42px;
      border-radius: 11px;
      border: none;
      background: rgba(193,154,107,0.95);
      color: #fff;
      font-weight: 900;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-sizing: border-box;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      transition: background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
    }
    .send:hover {
      background: rgba(201,164,115,1);
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.45);
    }
    .send:active {
      transform: translateY(0);
    }
    .send:disabled { 
      opacity: 0.45; 
      cursor: not-allowed;
      transform: none;
    }
    .send svg {
      width: 19px;
      height: 19px;
      fill: currentColor;
    }
    .empty { color: rgba(229,229,229,0.70); font-size: 13px; padding: 18px; }
    @media (max-width: 900px) { 
      .grid { grid-template-columns: 260px 1fr; }
      .panel {
        width: min(calc(100vw - 32px), 900px);
        max-width: calc(100vw - 32px);
        height: min(calc(100vh - 100px), 600px);
        max-height: calc(100vh - 100px);
      }
    }
    @media (max-width: 640px) {
      .panel { 
        width: min(calc(100vw - 16px), 900px);
        max-width: calc(100vw - 16px);
        height: min(calc(100vh - 80px), 600px);
        max-height: calc(100vh - 80px);
        right: 8px;
        bottom: calc(100% + 12px);
        top: auto;
      }
      .grid { grid-template-columns: 1fr; }
      .left { display: none; }
    }
    .modalOverlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      z-index: 2147483647;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 20px;
      overflow-y: auto;
      box-sizing: border-box;
    }
    .modalOverlay.show { display: flex; }
    .modalContent {
      background: rgba(10,10,10,0.95);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 18px;
      padding: 20px;
      max-width: min(480px, calc(100vw - 40px));
      width: 100%;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      overflow-x: hidden;
      margin: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .modalHeader {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      flex-shrink: 0;
    }
    .modalTitle {
      font-weight: 900;
      font-size: 16px;
      color: #e5e5e5;
    }
    .modalClose {
      background: none;
      border: none;
      color: rgba(229,229,229,0.6);
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    }
    .modalClose:hover { background: rgba(255,255,255,0.08); color: #e5e5e5; }
    .modalField {
      margin-bottom: 16px;
      position: relative;
      flex-shrink: 0;
    }
    .modalLabel {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: rgba(229,229,229,0.7);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .modalField .search {
      border: 1px solid rgba(193,154,107,0.5);
      width: 100%;
      box-sizing: border-box;
    }
    .modalField .search:focus {
      border-color: rgba(193,154,107,0.8);
    }
    .modalField textarea {
      min-height: 80px;
      max-height: 200px;
      resize: vertical;
      border: 1px solid rgba(193,154,107,0.5);
      width: 100%;
      box-sizing: border-box;
    }
    .modalField textarea:focus {
      border-color: rgba(193,154,107,0.8);
    }
    .userSearchResults {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: rgba(0,0,0,0.95);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 12px;
      max-height: min(200px, calc(100vh - 400px));
      overflow-y: auto;
      z-index: 10;
      display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .userSearchResults.show { display: block; }
    .userResultItem {
      padding: 12px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .userResultItem:hover { background: rgba(255,255,255,0.06); }
    .userResultItem:last-child { border-bottom: none; }
    .userResultAvatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: rgba(193,154,107,0.95);
      color: #111;
      font-weight: 900;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }
    .userResultText {
      flex: 1 1 auto;
      min-width: 0;
    }
    .userResultName {
      font-weight: 700;
      font-size: 13px;
      color: #e5e5e5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .userResultEmail {
      font-size: 11px;
      color: rgba(229,229,229,0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .modalActions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.10);
      flex-shrink: 0;
    }
    .modalBtn {
      flex: 1;
      padding: 12px;
      border-radius: 12px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: #e5e5e5;
    }
    .modalBtn:hover { border-color: rgba(193,154,107,0.7); background: rgba(193,154,107,0.1); }
    .modalBtn.primary {
      background: rgba(193,154,107,0.92);
      color: #111;
      border-color: rgba(193,154,107,0.35);
    }
    .modalBtn.primary:hover { background: rgba(193,154,107,1); }
    .modalBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (max-width: 640px) {
      .modalOverlay {
        padding: 16px 12px;
        align-items: flex-start;
      }
      .modalContent {
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 32px);
        padding: 16px;
        margin-top: 0;
      }
      .modalHeader {
        margin-bottom: 16px;
      }
      .modalField {
        margin-bottom: 12px;
      }
      .modalField textarea {
        min-height: 100px;
        max-height: 120px;
      }
      .userSearchResults {
        max-height: min(150px, calc(100vh - 400px));
      }
      .modalActions {
        margin-top: 16px;
        padding-top: 12px;
      }
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

// Funkcja do odtwarzania dźwięku nowej wiadomości
let soundCache = null;
function playMessageSound() {
  try {
    if (!soundCache) {
      soundCache = new Audio("/message.mp3");
      soundCache.volume = 0.5;
    }
    // Reset do początku i odtwórz
    soundCache.currentTime = 0;
    soundCache.play().catch((e) => {
      // Ignoruj błędy autoplay (użytkownik musi najpierw kliknąć na stronę)
      console.debug("Nie można odtworzyć dźwięku (wymagana interakcja użytkownika):", e);
    });
  } catch (e) {
    console.debug("Błąd odtwarzania dźwięku:", e);
  }
}

function scrollToBottom(el) {
  try {
    el.scrollTop = el.scrollHeight;
  } catch {}
}

async function main() {
  if (!document?.body) return;

  // Wycisz znane "CORS/access control checks" z Firestore WebChannel/Listen,
  // które w praktyce często nie wpływają na działanie (a tylko spamują konsolę).
  // (Masz identyczną logikę w części stron.)
  try {
    if (!window.__strzelcaFirestoreNoiseGuard) {
      window.__strzelcaFirestoreNoiseGuard = true;
      window.addEventListener(
        "error",
        (e) => {
          const msg = (e?.message || "").toString();
          if (
            msg.includes("access control checks") ||
            msg.includes("CORS") ||
            msg.includes("firestore.googleapis.com")
          ) {
            e.preventDefault();
            return false;
          }
          return undefined;
        },
        true
      );
      window.addEventListener(
        "unhandledrejection",
        (e) => {
          const msg = (e?.reason?.message || "").toString();
          if (
            msg.includes("access control checks") ||
            msg.includes("CORS") ||
            msg.includes("firestore.googleapis.com")
          ) {
            e.preventDefault();
            return false;
          }
          return undefined;
        },
        true
      );
    }
  } catch {
    // ignore
  }

  // Firebase dynamic imports
  const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
  ]);

  const {
    getAuth,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
  } = authMod;

  const {
    initializeFirestore,
    getFirestore,
    collection,
    doc,
    setDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    runTransaction,
    serverTimestamp,
    increment,
    writeBatch,
    getDocs,
    getDoc,
    setLogLevel,
  } = fsMod;

  const apiKey = await getFirebaseApiKey();
  if (!apiKey) {
    console.warn("messages-widget: /api/firebase-config niedostępne — widget wyłączony.");
    return;
  }

  const firebaseConfig = {
    apiKey,
    authDomain: (() => { try { const h = window.location.hostname.toLowerCase().replace(/^www\./, ""); return h === "strzelca.pl" || h.endsWith(".strzelca.pl") ? "strzelca.pl" : "strzelca-pl.firebaseapp.com"; } catch (_) { return "strzelca-pl.firebaseapp.com"; } })(),
    projectId: "strzelca-pl",
    storageBucket: "strzelca-pl.appspot.com",
    messagingSenderId: "511362047688",
    appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
    measurementId: "G-9EJ2R3JPVD",
  };

  // Jeśli strona ma już Firebase (większość Twoich podstron), reuse'ujemy istniejącą instancję.
  // To jest kluczowe, bo wtedy widget dziedziczy ten sam stan Firebase Auth (unikamy permission-denied).
  const existingApps = getApps();
  const app = existingApps.length ? existingApps[0] : initializeApp(firebaseConfig);

  let db;
  try {
    db = initializeFirestore(app, {
      // Spójnie z auth-init.mjs — Safari/WebKit: wymuszenie long polling + wyłączenie fetch streams
      // ogranicza błędy WebChannel „access control checks”.
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    });
  } catch (initErr) {
    if (initErr?.code === "failed-precondition") {
      db = getFirestore(app);
    } else {
      throw initErr;
    }
  }

  // Wycisz logi Firestore (w tym szum WebChannel/Listen w konsoli).
  try {
    setLogLevel("silent");
  } catch {}
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence).catch(() => {});

  // Nie używamy pierwszego wywołania onAuthStateChanged jako „prawdy” — bywa null zanim
  // persistence/SSO dokończą pracę; wtedy widget wracał wcześnie i nigdy nie montował UI.
  try {
    await auth.authStateReady();
  } catch {}

  let user = auth.currentUser;
  if (!user) {
    try {
      const { ensureFirebaseSSO } = await import("https://strzelca.pl/sso-client.mjs?v=2026-03-29-4");
      await ensureFirebaseSSO(auth);
    } catch {}
    try {
      await auth.authStateReady();
    } catch {}
    user = auth.currentUser;
  }
  if (!user) {
    // Często na subdomenach (np. kontakt.strzelca.pl) ten moduł startuje równolegle z auth-widget /
    // inline Firebase — pierwszy snapshot bywa null, a dopiero chwilę później SSO ustawia usera.
    // Wtedy wcześniejsze `return` blokowało na stałe montaż i globalne `__strzelcaMessagesOpenSupport`.
    const lateUnsub = onAuthStateChanged(auth, (u) => {
      if (!u) return;
      lateUnsub();
      void mountMessagesWidgetUi(u).catch((e) =>
        console.warn("messages-widget: opóźniony montaż", e)
      );
    });
    return;
  }

  await mountMessagesWidgetUi(user);

  /** Musi być wewnątrz main() — domyka doc/query/onSnapshot z fsMod. */
  async function mountMessagesWidgetUi(loggedUser) {
    if (document.getElementById("strzelca-messages-widget")) return;

    const uid = loggedUser.uid;

  // Sprawdź czy użytkownik jest administratorem
  let isUserAdmin = false;
  try {
    const profileRef = doc(db, "userProfiles", uid);
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data();
      isUserAdmin = data.role === "admin" || uid === "nCMUz2fc8MM9WhhMVBLZ1pdR7O43";
    }
  } catch (e) {
    console.debug("checkIfAdmin error:", e);
  }

  // UI
  const dock = document.getElementById("bazar-bottom-dock");
  const useDock = !!dock;
  const host = document.createElement("div");
  host.id = "strzelca-messages-widget";
  if (useDock) {
    host.style.flexShrink = "0";
    host.style.display = "block";
    dock.appendChild(host);
  } else {
    document.body.appendChild(host);
  }
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(makeStyles());

  const wrap = document.createElement("div");
  wrap.className = useDock ? "wrap wrap--dock" : "wrap";

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

  const hdr = document.createElement("div");
  hdr.className = "hdr";

  const hdrTitle = document.createElement("div");
  hdrTitle.className = "hdrTitle";
  const dot = document.createElement("span");
  dot.className = "dot";
  const titleText = document.createElement("span");
  titleText.className = "hdrTitleText";
  titleText.textContent = "Wiadomości";
  hdrTitle.appendChild(dot);
  hdrTitle.appendChild(titleText);

  const hdrBtns = document.createElement("div");
  hdrBtns.className = "hdrBtns";
  const closeBtn = document.createElement("button");
  closeBtn.className = "ghost";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Zamknij");
  closeBtn.style.fontSize = "18px";
  closeBtn.style.lineHeight = "1";
  hdrBtns.appendChild(closeBtn);

  hdr.appendChild(hdrTitle);
  hdr.appendChild(hdrBtns);

  const grid = document.createElement("div");
  grid.className = "grid";

  const left = document.createElement("div");
  left.className = "left";

  const leftTop = document.createElement("div");
  leftTop.className = "leftTop";
  const searchInput = document.createElement("input");
  searchInput.className = "search";
  searchInput.placeholder = "Szukaj ...";
  const newMsgBtn = document.createElement("button");
  newMsgBtn.className = "ghost";
  newMsgBtn.type = "button";
  newMsgBtn.style.marginTop = "10px";
  newMsgBtn.style.width = "100%";
  newMsgBtn.innerHTML = '<span style="margin-right: 6px;">+</span> Nowa wiadomość';
  newMsgBtn.setAttribute("aria-label", "Nowa wiadomość");
  leftTop.appendChild(searchInput);
  leftTop.appendChild(newMsgBtn);

  const convList = document.createElement("div");
  left.appendChild(leftTop);
  left.appendChild(convList);

  const right = document.createElement("div");
  right.className = "right";

  const msgs = document.createElement("div");
  msgs.className = "msgs";
  msgs.innerHTML = `<div class="empty">Wybierz rozmowę…</div>`;

  const composer = document.createElement("div");
  composer.className = "composer";
  const pendingAttach = document.createElement("div");
  pendingAttach.className = "pendingAttach";
  const pendingRow = document.createElement("div");
  pendingRow.className = "pendingAttachRow";
  const pendingThumb = document.createElement("img");
  pendingThumb.className = "pendingThumb";
  pendingThumb.alt = "";
  const pendingMid = document.createElement("div");
  pendingMid.className = "pendingAttachMid";
  const pendingProgress = document.createElement("div");
  pendingProgress.className = "attachProgress";
  pendingProgress.innerHTML =
    '<div class="attachProgressTrack"><div class="attachProgressBar"></div></div>';
  const pendingLabel = document.createElement("span");
  pendingLabel.className = "pendingAttachLabel";
  const pendingRemove = document.createElement("button");
  pendingRemove.type = "button";
  pendingRemove.className = "pendingRemove";
  pendingRemove.textContent = "Usuń zdjęcie";
  pendingMid.appendChild(pendingProgress);
  pendingMid.appendChild(pendingLabel);
  pendingRow.appendChild(pendingThumb);
  pendingRow.appendChild(pendingMid);
  pendingRow.appendChild(pendingRemove);
  pendingAttach.appendChild(pendingRow);

  const composerBar = document.createElement("div");
  composerBar.className = "composerBar";

  const attachBtn = document.createElement("button");
  attachBtn.className = "attach";
  attachBtn.type = "button";
  attachBtn.title = "Dodaj zdjęcie";
  attachBtn.setAttribute("aria-label", "Dodaj zdjęcie");
  attachBtn.innerHTML =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
  fileInput.style.display = "none";

  const ta = document.createElement("textarea");
  ta.placeholder = "Napisz wiadomość…";
  ta.setAttribute("rows", "1");
  const sendBtn = document.createElement("button");
  sendBtn.className = "send";
  sendBtn.type = "button";
  sendBtn.title = "Wyślij wiadomość";
  sendBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

  composerBar.appendChild(ta);
  composerBar.appendChild(attachBtn);
  composerBar.appendChild(sendBtn);
  composer.appendChild(pendingAttach);
  composer.appendChild(composerBar);
  composer.appendChild(fileInput);

  let pendingImageAttachment = null;
  let attachmentProcessing = false;
  function updatePendingAttachUI() {
    const bar = pendingProgress.querySelector(".attachProgressBar");
    if (pendingImageAttachment) {
      pendingAttach.classList.add("show");
      pendingThumb.src = `data:${pendingImageAttachment.mimeType};base64,${pendingImageAttachment.dataBase64}`;
      pendingThumb.style.display = "block";
      pendingProgress.style.display = "none";
      if (bar) bar.style.width = "100%";
      pendingLabel.textContent = "Zdjęcie gotowe do wysłania (JPEG, skompresowane).";
      return;
    }
    if (!attachmentProcessing) {
      pendingAttach.classList.remove("show");
      pendingThumb.removeAttribute("src");
      pendingThumb.style.display = "none";
      pendingProgress.style.display = "none";
      if (bar) bar.style.width = "8%";
      pendingLabel.textContent = "";
    }
  }

  right.appendChild(msgs);
  right.appendChild(composer);

  grid.appendChild(left);
  grid.appendChild(right);
  panel.appendChild(hdr);
  panel.appendChild(grid);

  wrap.appendChild(panel);
  wrap.appendChild(btn);
  shadow.appendChild(wrap);

  const imgLightboxEl = document.createElement("div");
  imgLightboxEl.className = "imgLightbox";
  imgLightboxEl.setAttribute("role", "dialog");
  imgLightboxEl.setAttribute("aria-modal", "true");
  imgLightboxEl.setAttribute("aria-label", "Podgląd zdjęcia");
  const imgLbBackdrop = document.createElement("div");
  imgLbBackdrop.className = "imgLightboxBackdrop";
  const imgLbToolbar = document.createElement("div");
  imgLbToolbar.className = "imgLightboxToolbar";
  const imgLbToolbarInner = document.createElement("div");
  imgLbToolbarInner.className = "imgLightboxToolbarInner";
  const imgLbPct = document.createElement("span");
  imgLbPct.className = "imgLightboxPct";
  imgLbPct.textContent = "100%";
  function mkImgLbBtn(label, extraClass, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "imgLightboxBtn" + (extraClass ? ` ${extraClass}` : "");
    b.textContent = label;
    b.title = title;
    return b;
  }
  const imgLbMinus = mkImgLbBtn("−", "", "Oddal");
  const imgLbReset = mkImgLbBtn("Reset", "imgLightboxBtnSm", "Domyślny rozmiar");
  const imgLbPlus = mkImgLbBtn("+", "", "Przybliż");
  const imgLbClose = mkImgLbBtn("×", "", "Zamknij (Esc)");
  imgLbToolbarInner.appendChild(imgLbPct);
  imgLbToolbarInner.appendChild(imgLbMinus);
  imgLbToolbarInner.appendChild(imgLbReset);
  imgLbToolbarInner.appendChild(imgLbPlus);
  imgLbToolbarInner.appendChild(imgLbClose);
  imgLbToolbar.appendChild(imgLbToolbarInner);
  const imgLbViewport = document.createElement("div");
  imgLbViewport.className = "imgLightboxViewport";
  const imgLbImg = document.createElement("img");
  imgLbImg.className = "imgLightboxImg";
  imgLbImg.alt = "Powiększone zdjęcie";
  imgLbImg.draggable = false;
  imgLbViewport.appendChild(imgLbImg);
  imgLightboxEl.appendChild(imgLbBackdrop);
  imgLightboxEl.appendChild(imgLbToolbar);
  imgLightboxEl.appendChild(imgLbViewport);
  shadow.appendChild(imgLightboxEl);

  let imgLbScale = 1;
  let imgLbWheel = null;
  let imgLbKey = null;
  const IMG_LB_MIN = 0.25;
  const IMG_LB_MAX = 5;

  function applyWidgetImgLbScale() {
    imgLbImg.style.transform = `scale(${imgLbScale})`;
    imgLbPct.textContent = `${Math.round(imgLbScale * 100)}%`;
  }

  function closeWidgetImageLightbox() {
    imgLightboxEl.classList.remove("open");
    if (imgLbWheel) {
      imgLbViewport.removeEventListener("wheel", imgLbWheel);
      imgLbWheel = null;
    }
    if (imgLbKey) {
      document.removeEventListener("keydown", imgLbKey);
      imgLbKey = null;
    }
    imgLbImg.removeAttribute("src");
    imgLbImg.style.transform = "";
    imgLbScale = 1;
  }

  function openWidgetImageLightbox(src) {
    if (!src) return;
    if (imgLightboxEl.classList.contains("open")) closeWidgetImageLightbox();
    imgLbImg.src = src;
    imgLbScale = 1;
    applyWidgetImgLbScale();
    imgLbViewport.scrollTop = 0;
    imgLbViewport.scrollLeft = 0;
    imgLightboxEl.classList.add("open");
    imgLbWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      imgLbScale = Math.min(IMG_LB_MAX, Math.max(IMG_LB_MIN, imgLbScale * factor));
      applyWidgetImgLbScale();
    };
    imgLbViewport.addEventListener("wheel", imgLbWheel, { passive: false });
    imgLbKey = (e) => {
      if (e.key === "Escape") closeWidgetImageLightbox();
    };
    document.addEventListener("keydown", imgLbKey);
  }

  imgLbMinus.addEventListener("click", () => {
    imgLbScale = Math.min(IMG_LB_MAX, Math.max(IMG_LB_MIN, imgLbScale / 1.2));
    applyWidgetImgLbScale();
  });
  imgLbPlus.addEventListener("click", () => {
    imgLbScale = Math.min(IMG_LB_MAX, Math.max(IMG_LB_MIN, imgLbScale * 1.2));
    applyWidgetImgLbScale();
  });
  imgLbReset.addEventListener("click", () => {
    imgLbScale = 1;
    applyWidgetImgLbScale();
    imgLbViewport.scrollTop = 0;
    imgLbViewport.scrollLeft = 0;
  });
  imgLbClose.addEventListener("click", () => closeWidgetImageLightbox());
  imgLbViewport.addEventListener("click", (e) => {
    if (e.target === imgLbViewport) closeWidgetImageLightbox();
  });
  imgLbImg.addEventListener("click", (e) => e.stopPropagation());
  imgLbImg.addEventListener("dblclick", () => {
    imgLbScale = 1;
    applyWidgetImgLbScale();
  });

  msgs.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("bubbleImg")) {
      e.preventDefault();
      openWidgetImageLightbox(t.src);
    }
  });

  // State + subscriptions
  let isOpen = getStoredOpen();
  let convUnsub = null;
  let threadUnsub = null;
  let supportBadgeUnsub = null;
  let supportThreadUnsubs = [];
  let supportReadDebounceTimer = null;
  let supportReadInFlight = false;
  const conversationReadInFlight = new Set();
  const BADGE_LEADER_RENEW_MS = 15 * 1000;
  const BADGE_LEASE_MS = 45 * 1000;
  const BADGE_LEADER_LOCK_KEY = `strzelca_messages_badge_leader_v1_${uid}`;
  const BADGE_CACHE_KEY = `strzelca_messages_badge_cache_v1_${uid}`;
  const BADGE_TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let badgeLeadershipInterval = null;
  let badgePagehideHandler = null;
  let badgeStorageHandler = null;
  let previousUnreadTotal = 0; // Śledzenie poprzedniej liczby nieprzeczytanych wiadomości

  let state = {
    conversations: [], // { id, peerId, peerName, peerAvatar, lastText, unread }
    searchUsers: [],
    q: "",
    selectedPeerId: getStoredSelectedPeerId() || SUPPORT_PEER_ID,
    selectedConversationId: null,
    unreadTotal: 0,
    supportLastText: "Pomoc / zgłoszenia",
    supportUnread: 0,
  };

  function applyUnreadBadge() {
    const totalUnreadWithSupport =
      (Number(state.unreadTotal || 0) || 0) + (Number(state.supportUnread || 0) || 0);
    setBadgeEl(badge, totalUnreadWithSupport);
    if (totalUnreadWithSupport > previousUnreadTotal && previousUnreadTotal >= 0) {
      playMessageSound();
    }
    previousUnreadTotal = totalUnreadWithSupport;
    try {
      localStorage.setItem(
        BADGE_CACHE_KEY,
        JSON.stringify({
          unreadTotal: Number(state.unreadTotal || 0) || 0,
          supportUnread: Number(state.supportUnread || 0) || 0,
          supportLastText: typeof state.supportLastText === "string" ? state.supportLastText.slice(0, 70) : "",
          total: totalUnreadWithSupport,
          ts: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
  }

  function readBadgeCache() {
    try {
      const raw = localStorage.getItem(BADGE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function applyBadgeCache(payload) {
    if (!payload || typeof payload !== "object") return;
    if (typeof payload.unreadTotal === "number") state.unreadTotal = payload.unreadTotal;
    if (typeof payload.supportUnread === "number") state.supportUnread = payload.supportUnread;
    if (typeof payload.supportLastText === "string" && payload.supportLastText.trim()) {
      state.supportLastText = payload.supportLastText.slice(0, 70);
    }
    const totalUnreadWithSupport =
      (Number(state.unreadTotal || 0) || 0) + (Number(state.supportUnread || 0) || 0);
    setBadgeEl(badge, totalUnreadWithSupport);
    previousUnreadTotal = totalUnreadWithSupport;
    renderList();
  }

  function readBadgeLeaderLease() {
    try {
      const raw = localStorage.getItem(BADGE_LEADER_LOCK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.tabId !== "string" || typeof parsed.expiresAt !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeBadgeLeaderLease(expiresAt) {
    try {
      localStorage.setItem(
        BADGE_LEADER_LOCK_KEY,
        JSON.stringify({
          tabId: BADGE_TAB_ID,
          expiresAt,
        }),
      );
    } catch {
      // ignore
    }
  }

  function renewBadgeLeadership() {
    const lease = readBadgeLeaderLease();
    const now = Date.now();
    if (!lease || lease.expiresAt <= now || lease.tabId === BADGE_TAB_ID) {
      writeBadgeLeaderLease(now + BADGE_LEASE_MS);
      return true;
    }
    return false;
  }

  function releaseBadgeLeadership() {
    try {
      const lease = readBadgeLeaderLease();
      if (lease?.tabId === BADGE_TAB_ID) {
        localStorage.removeItem(BADGE_LEADER_LOCK_KEY);
      }
    } catch {
      // ignore
    }
  }

  function stopPassiveRealtimeSubscriptions() {
    if (convUnsub) {
      convUnsub();
      convUnsub = null;
    }
    if (supportBadgeUnsub) {
      supportBadgeUnsub();
      supportBadgeUnsub = null;
    }
  }

  function ensurePassiveRealtimeSubscriptions() {
    if (isOpen) {
      if (!convUnsub) subscribeConversations();
      if (!supportBadgeUnsub) subscribeSupportBadgeListener();
      return;
    }

    const isLeader = renewBadgeLeadership();
    if (!isLeader) {
      stopPassiveRealtimeSubscriptions();
      return;
    }
    if (!convUnsub) subscribeConversations();
    if (!supportBadgeUnsub) subscribeSupportBadgeListener();
  }

  function startBadgeLeadershipLoop() {
    if (badgeLeadershipInterval) {
      clearInterval(badgeLeadershipInterval);
      badgeLeadershipInterval = null;
    }
    if (badgePagehideHandler) {
      window.removeEventListener("pagehide", badgePagehideHandler);
      badgePagehideHandler = null;
    }
    if (badgeStorageHandler) {
      window.removeEventListener("storage", badgeStorageHandler);
      badgeStorageHandler = null;
    }

    applyBadgeCache(readBadgeCache());
    ensurePassiveRealtimeSubscriptions();
    badgeLeadershipInterval = setInterval(() => {
      ensurePassiveRealtimeSubscriptions();
    }, BADGE_LEADER_RENEW_MS);

    badgePagehideHandler = () => {
      releaseBadgeLeadership();
    };
    window.addEventListener("pagehide", badgePagehideHandler);

    badgeStorageHandler = (ev) => {
      if (ev.key !== BADGE_CACHE_KEY || !ev.newValue) return;
      try {
        applyBadgeCache(JSON.parse(ev.newValue));
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", badgeStorageHandler);
  }

  function renderAvatar(el, name, avatarUrl) {
    el.innerHTML = "";
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = "Avatar";
      el.appendChild(img);
      return;
    }
    el.textContent = firstLetter(name);
  }

  function renderConvItem({ key, active, name, sub, unread, avatar, letter, onClick, onDelete, canDelete }) {
    const conv = document.createElement("div");
    conv.className = `conv ${active ? "active" : ""}`;
    conv.dataset.key = key;

    const av = document.createElement("div");
    av.className = "avatar";
    renderAvatar(av, name || letter, avatar || null);

    const text = document.createElement("div");
    text.className = "convText";

    const nameRow = document.createElement("div");
    nameRow.className = "convNameRow";

    const nameEl = document.createElement("div");
    nameEl.className = "convName";
    nameEl.textContent = name;

    const badgeEl = document.createElement("div");
    badgeEl.className = "convBadge";
    setBadgeEl(badgeEl, unread || 0);

    nameRow.appendChild(nameEl);
    nameRow.appendChild(badgeEl);

    const subEl = document.createElement("div");
    subEl.className = "convSub";
    subEl.textContent = sub || "";

    text.appendChild(nameRow);
    text.appendChild(subEl);

    conv.appendChild(av);
    conv.appendChild(text);
    
    // Dodaj przycisk usuwania jeśli można usunąć
    if (canDelete && onDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "convDelete";
      deleteBtn.innerHTML = "×";
      deleteBtn.setAttribute("aria-label", "Usuń konwersację");
      deleteBtn.style.cssText = "position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.5); color: #ef4444; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; display: none; align-items: center; justify-content: center; font-size: 18px; font-weight: 900;";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Czy na pewno chcesz usunąć tę konwersację?")) {
          onDelete();
        }
      });
      conv.style.position = "relative";
      conv.addEventListener("mouseenter", () => deleteBtn.style.display = "flex");
      conv.addEventListener("mouseleave", () => deleteBtn.style.display = "none");
      conv.appendChild(deleteBtn);
    }
    
    conv.addEventListener("click", onClick);
    return conv;
  }

  function filteredConversations() {
    const q = (state.q || "").toString().trim().toLowerCase();
    if (!q) return state.conversations;
    return state.conversations.filter((c) => {
      const n = (c.peerName || "").toLowerCase();
      const l = (c.lastText || "").toLowerCase();
      // Wyszukiwanie po nicku (nazwie użytkownika) w utworzonych już wiadomościach
      // peerName zawiera nick użytkownika, więc już jest uwzględnione w n.includes(q)
      return n.includes(q) || l.includes(q);
    });
  }

  function renderList() {
    convList.innerHTML = "";
    const q = (state.q || "").toString().trim().toLowerCase();

    // pinned support always on top
    const supportName = "Pomoc STRZELCA.PL";
    const supportUnread = Number(state.supportUnread || 0) || 0;
    convList.appendChild(
      renderConvItem({
        key: "support",
        active: state.selectedPeerId === SUPPORT_PEER_ID,
        name: supportName,
        sub: state.supportLastText || "Pomoc / zgłoszenia",
        unread: supportUnread,
        avatar: null,
        letter: "S",
        onClick: () => selectPeer(SUPPORT_PEER_ID, supportName),
      })
    );

    const dm = filteredConversations().filter((c) => c.peerId !== SUPPORT_PEER_ID);
    for (const c of dm) {
      convList.appendChild(
        renderConvItem({
          key: `dm:${c.peerId}`,
          active: state.selectedPeerId === c.peerId,
          name: c.peerName || "Użytkownik",
          sub: c.lastText || "Brak wiadomości",
          unread: c.unread || 0,
          avatar: c.peerAvatar || null,
          letter: firstLetter(c.peerName || "U"),
          onClick: () => selectPeer(c.peerId, c.peerName || "Rozmowa"),
          onDelete: () => deleteConversation(c.id, c.peerId),
          canDelete: true, // Nie można usuwać konwersacji z support (sprawdzane w deleteConversation)
        })
      );
    }

    const shown = new Set(dm.map((x) => x.peerId));

    if (q.length >= 2) {
      const users = (state.searchUsers || []).filter((u) => u?.uid && !shown.has(u.uid) && u.uid !== uid);
      if (users.length) {
        const label = document.createElement("div");
        label.className = "sectionLabel";
        label.textContent = "Użytkownicy";
        convList.appendChild(label);
      }
      for (const u of users) {
        const name = u.displayName || "Użytkownik";
        convList.appendChild(
          renderConvItem({
            key: `u:${u.uid}`,
            active: state.selectedPeerId === u.uid,
            name,
            sub: "Kliknij, aby rozpocząć rozmowę",
            unread: 0,
            avatar: u.avatar || null,
            letter: firstLetter(name),
            onClick: () => selectPeer(u.uid, name),
          })
        );
      }
    }
  }

  function renderMessages(items) {
    msgs.innerHTML = "";
    if (!items || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Rozpocznij rozmowę!";
      msgs.appendChild(empty);
      return;
    }

    const peerId = state.selectedPeerId;
    let firstNewIdx = -1;
    if (peerId && items.length) {
      firstNewIdx = items.findIndex(
        (m) => m && m.senderId === peerId && m.isRead !== true,
      );
    }

    items.forEach((m, index) => {
      if (index === firstNewIdx && firstNewIdx >= 0) {
        const div = document.createElement("div");
        div.className = "msgUnreadDivider";
        div.setAttribute("role", "separator");
        div.setAttribute("aria-label", "Nowe wiadomości");
        const inner = document.createElement("div");
        inner.className = "msgUnreadDivider-inner";
        div.appendChild(inner);
        msgs.appendChild(div);
      }

      const isMe = m.senderId === uid;
      const row = document.createElement("div");
      row.className = `bubbleRow ${isMe ? "me" : ""}`;
      const b = document.createElement("div");
      b.className = `bubble ${isMe ? "me" : ""}`;
      const hasImg = isSafeRenderableAttachment(m.imageAttachment);
      if (hasImg) {
        const img = document.createElement("img");
        img.className = "bubbleImg";
        img.alt = "Załącznik graficzny";
        img.title = "Kliknij, aby powiększyć";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        const mime = m.imageAttachment.mimeType;
        const rawB64 = stripDataUrlBase64(m.imageAttachment.dataBase64);
        img.src = `data:${mime};base64,${rawB64}`;
        b.appendChild(img);
      }
      const cap = captionForBubble(m.content || "", hasImg);
      if (cap) {
        const textEl = document.createElement("div");
        textEl.className = "bubbleText";
        textEl.textContent = cap;
        b.appendChild(textEl);
      } else if (!hasImg) {
        const textEl = document.createElement("div");
        textEl.className = "bubbleText";
        textEl.textContent = (m.content || "").toString();
        b.appendChild(textEl);
      }
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = formatTime(m.timestampMs || Date.now());
      b.appendChild(meta);
      row.appendChild(b);
      msgs.appendChild(row);
    });
    queueMicrotask(() => scrollToBottom(msgs));
  }

  async function searchUsersByPrefix(prefix) {
    const qRaw = (prefix || "").toString().trim().toLowerCase();
    if (qRaw.length < 2) return [];

    // Wyszukaj w publicProfiles po displayName (publiczne dane dostępne dla wszystkich)
    try {
      const usersRef = collection(db, "publicProfiles");
      const usersSnapshot = await getDocs(usersRef);
      const matchingUsers = [];

      usersSnapshot.forEach((profDoc) => {
        const userData = profDoc.data();
        const userId = profDoc.id;
        const displayName = (userData.displayName || "").toLowerCase();

        // Sprawdź czy wyszukiwany tekst pasuje do nicku
        if (displayName.includes(qRaw)) {
          matchingUsers.push({
            uid: userId,
            displayName: userData.displayName || "Użytkownik",
            avatar: userData.avatar || null,
          });
        }
      });

      // Sortuj: najpierw dokładne dopasowania, potem częściowe
      matchingUsers.sort((a, b) => {
        const aName = a.displayName.toLowerCase();
        const bName = b.displayName.toLowerCase();
        const aExact = aName === qRaw || aName.startsWith(qRaw);
        const bExact = bName === qRaw || bName.startsWith(qRaw);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return aName.localeCompare(bName);
      });

      return matchingUsers.slice(0, 10).filter((x) => x.uid !== uid);
    } catch (e) {
      console.warn("searchUsersByPrefix error:", e);
      return [];
    }
  }

  async function markConversationRead({ conversationId, unreadDocs = [], unreadHint = 0 }) {
    if (!conversationId) return;
    if (conversationReadInFlight.has(conversationId)) return;
    const docsToMark = Array.isArray(unreadDocs) ? unreadDocs : [];
    const shouldZeroCounter = docsToMark.length > 0 || (Number(unreadHint || 0) || 0) > 0;
    if (!shouldZeroCounter) return;

    conversationReadInFlight.add(conversationId);
    try {
      const convRef = doc(db, "privateConversations", conversationId);
      await setDoc(convRef, { unreadCounts: { [uid]: 0 } }, { merge: true });

      if (docsToMark.length > 0) {
        const batch = writeBatch(db);
        docsToMark.forEach((d) => batch.update(d.ref, { isRead: true }));
        await batch.commit();
      }
    } catch (e) {
      const msg = (e?.message || "").toString();
      // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do tej konwersacji
      if (msg.includes("Missing or insufficient permissions") || 
          msg.includes("permission-denied") ||
          msg.includes("Not authenticated")) {
        console.debug("messages-widget: brak uprawnień do oznaczania jako przeczytane (normalne dla niektórych użytkowników)");
        return;
      }
      console.warn("markConversationRead failed:", msg || e);
    } finally {
      conversationReadInFlight.delete(conversationId);
    }
  }

  async function sendMessageTo(peerId, textContent, imageAttachment) {
    const text = (textContent || "").toString().trim().slice(0, 4000);
    if (!text && !imageAttachment) return;
    if (!peerId || peerId === uid) return;

    const storedContent = text || "[Zdjęcie]";
    const lastPreview = text || "📷 Zdjęcie";

    const conversationId = conversationIdFor(uid, peerId);
    const convRef = doc(db, "privateConversations", conversationId);
    const msgRef = doc(collection(db, "privateMessages"));

    // best-effort names/avatars
    const [myPub, peerPub] = await Promise.all([
      getDoc(doc(db, "publicProfiles", uid)).catch(() => null),
      getDoc(doc(db, "publicProfiles", peerId)).catch(() => null),
    ]);
    const myDisplayName = myPub?.exists?.() ? myPub.data()?.displayName : null;
    const peerDisplayName = peerPub?.exists?.() ? peerPub.data()?.displayName : null;
    const peerAvatar = peerPub?.exists?.() ? peerPub.data()?.avatar : null;

    // Nie czytamy convRef w transakcji — przy braku dokumentu to potrafiło kończyć się permission-denied.
    // Zamiast tego: ensureConversation() tworzy dokument wcześniej, a tutaj tylko update (merge + increment).
    await runTransaction(db, async (tx) => {
      tx.set(
        convRef,
        {
          participants: [uid, peerId].sort(),
          participantNames: { [uid]: myDisplayName || null, [peerId]: peerDisplayName || null },
          participantAvatars: { [peerId]: peerAvatar || null },
          updatedAt: serverTimestamp(),
          lastMessage: { content: lastPreview, senderId: uid, timestamp: serverTimestamp() },
          unreadCounts: { [peerId]: increment(1) },
        },
        { merge: true }
      );

      tx.set(msgRef, {
        conversationId,
        content: storedContent,
        senderId: uid,
        recipientId: peerId,
        isRead: false,
        timestamp: serverTimestamp(),
        ...(imageAttachment
          ? {
              imageAttachment: {
                mimeType: imageAttachment.mimeType,
                dataBase64: imageAttachment.dataBase64,
              },
            }
          : {}),
      });
    });
  }

  // Funkcja usuwania konwersacji (soft delete)
  async function deleteConversation(conversationId, peerId) {
    try {
      // Nie można usuwać konwersacji z pomocą STRZELCA.PL
      if (peerId === SUPPORT_PEER_ID) {
        alert("Nie można usunąć konwersacji z Pomoc STRZELCA.PL");
        return;
      }
      
      const convRef = doc(db, "privateConversations", conversationId);
      // Soft delete - dodajemy deletedBy dla tego użytkownika
      await setDoc(convRef, { 
        deletedBy: { [uid]: true }
      }, { merge: true });
      
      // Jeśli konwersacja jest aktualnie wybrana, przełącz na support
      if (state.selectedPeerId === peerId) {
        selectPeer(SUPPORT_PEER_ID, "Pomoc STRZELCA.PL");
      }
    } catch (e) {
      console.warn("deleteConversation error:", e);
      alert("Nie udało się usunąć konwersacji. Spróbuj ponownie.");
    }
  }

  function subscribeConversations() {
    if (convUnsub) convUnsub();
    const q = query(
      collection(db, "privateConversations"),
      where("participants", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(40)
    );

    convUnsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        let totalUnread = 0;
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          // Pomijamy konwersacje usunięte przez tego użytkownika
          if (data.deletedBy && data.deletedBy[uid]) return;
          
          const participants = Array.isArray(data.participants) ? data.participants : [];
          const peerId = participants.find((p) => p && p !== uid) || null;
          if (!peerId) return;
          const names = data.participantNames || {};
          const avatars = data.participantAvatars || {};
          const peerName =
            (typeof names?.[peerId] === "string" ? names[peerId] : null) ||
            "Użytkownik";
          const peerAvatar = typeof avatars?.[peerId] === "string" ? avatars[peerId] : null;
          const unread = Number((data.unreadCounts || {})[uid] || 0) || 0;
          totalUnread += unread;
          const lastText = data.lastMessage?.content ? String(data.lastMessage.content).slice(0, 70) : "";
          list.push({
            id: d.id,
            peerId,
            peerName,
            peerAvatar,
            lastText,
            unread,
          });
        });

        state.conversations = list;
        state.unreadTotal = totalUnread;
        applyUnreadBadge();
        renderList();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do wszystkich konwersacji
        // lub może nie być w pełni zalogowany. Widget powinien działać cicho w tle.
        if (msg.includes("Missing or insufficient permissions") || 
            msg.includes("permission-denied") ||
            msg.includes("Not authenticated")) {
          // Cicho zignoruj - widget nie powinien być widoczny dla niezalogowanych użytkowników
          // lub użytkowników bez uprawnień
          console.debug("messages-widget: brak uprawnień do konwersacji (normalne dla niezalogowanych)");
          return;
        }
        console.warn("conversations snapshot error:", msg || err);
      }
    );
  }

  async function ensureConversation(peerId) {
    const conversationId = conversationIdFor(uid, peerId);
    const ref = doc(db, "privateConversations", conversationId);
    // Tworzymy dokument konwersacji bez czytania (żeby nie wpadać w permission-denied na nieistniejącym docu).
    // NIE aktualizujemy updatedAt - to powodowało przesunięcie konwersacji na górę po kliknięciu.
    // updatedAt jest aktualizowane tylko przy wysyłaniu wiadomości.
    await setDoc(
      ref,
      {
        participants: [uid, peerId].sort(),
        unreadCounts: { [uid]: 0, [peerId]: 0 },
      },
      { merge: true }
    );
    return conversationId;
  }

  function subscribeSupportBadgeListener() {
    if (supportBadgeUnsub) supportBadgeUnsub();
    supportBadgeUnsub = onSnapshot(
      doc(db, "userInboxes", uid),
      (snap) => {
        const data = snap.exists() ? (snap.data() || {}) : {};
        state.supportUnread = Number(data.supportUnread || 0) || 0;
        if (typeof data.supportLastText === "string" && data.supportLastText.trim()) {
          state.supportLastText = data.supportLastText.slice(0, 70);
        }
        applyUnreadBadge();
        renderList();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        if (
          msg.includes("Missing or insufficient permissions") ||
          msg.includes("permission-denied") ||
          msg.includes("Not authenticated")
        ) {
          return;
        }
        console.warn("support badge snapshot error:", msg || err);
      }
    );
  }

  function subscribeThread(peerId) {
    if (threadUnsub) threadUnsub();
    const conversationId = conversationIdFor(uid, peerId);
    state.selectedConversationId = conversationId;

    // Pobieramy wszystkie wiadomości z jednej konwersacji używając conversationId
    // To zapewnia, że wszystkie wiadomości między dwoma użytkownikami są w jednej konwersacji
    const messagesQuery = query(
      collection(db, "privateMessages"),
      where("conversationId", "==", conversationId),
      orderBy("timestamp", "asc"),
      limit(200)
    );

    let allDocs = [];

    function mapDocs(docs) {
      return docs.map((d) => {
        const data = d.data() || {};
        const ts = data.timestamp;
        const timestampMs =
          typeof ts?.toMillis === "function" ? ts.toMillis() : typeof ts === "number" ? ts : Date.now();
        return {
          id: d.id,
          content: data.content || "",
          senderId: data.senderId || null,
          recipientId: data.recipientId || null,
          isRead: data.isRead === true,
          timestampMs,
          imageAttachment:
            data.imageAttachment &&
            typeof data.imageAttachment.mimeType === "string" &&
            typeof data.imageAttachment.dataBase64 === "string"
              ? {
                  mimeType: data.imageAttachment.mimeType,
                  dataBase64: data.imageAttachment.dataBase64,
                }
              : null,
        };
      });
    }

    let previousMessageCount = 0;
    let previousLastMessageTime = 0;
    
    async function recompute() {
      const merged = mapDocs(allDocs).sort((x, y) => (x.timestampMs || 0) - (y.timestampMs || 0));
      const unreadDocsFromPeer = allDocs.filter((d) => {
        const data = d.data() || {};
        return data.senderId === peerId && data.recipientId === uid && data.isRead !== true;
      });
      
      // Sprawdź czy są nowe nieprzeczytane wiadomości od tego użytkownika
      const unreadFromPeer = merged.filter(m => m.senderId === peerId && m.recipientId === uid && !m.isRead);
      const hasNewUnread = unreadFromPeer.length > 0;
      const lastMessage = merged[merged.length - 1];
      const lastMessageTime = lastMessage?.timestampMs || 0;
      
      // Odtwórz dźwięk jeśli:
      // 1. Jest nowa nieprzeczytana wiadomość od tego użytkownika
      // 2. Ostatnia wiadomość jest nowsza niż poprzednia (nowa wiadomość przyszła)
      // 3. Panel nie jest otwarty lub otwarta jest inna konwersacja
      if (hasNewUnread && lastMessageTime > previousLastMessageTime && 
          (!isOpen || state.selectedPeerId !== peerId)) {
        playMessageSound();
      }
      
      previousMessageCount = merged.length;
      previousLastMessageTime = lastMessageTime;
      
      renderMessages(merged);
      
      // Oznacz jako przeczytane jeśli panel jest otwarty i ta konwersacja jest wybrana
      if (isOpen && state.selectedPeerId === peerId && unreadDocsFromPeer.length > 0) {
        await markConversationRead({
          conversationId,
          unreadDocs: unreadDocsFromPeer,
          unreadHint: unreadDocsFromPeer.length,
        });
      }
    }

    // Jeden snapshot dla wszystkich wiadomości w konwersacji
    const unsub = onSnapshot(
      messagesQuery,
      async (snap) => {
        allDocs = snap.docs;
        await recompute();
      },
      (err) => {
        const msg = (err?.message || "").toString();
        // Ignoruj błędy uprawnień - użytkownik może nie mieć dostępu do tej konwersacji
        if (msg.includes("Missing or insufficient permissions") || 
            msg.includes("permission-denied") ||
            msg.includes("Not authenticated")) {
          console.debug("messages-widget: brak uprawnień do wątku (normalne dla niektórych użytkowników)");
          try {
            msgs.innerHTML = `<div class="empty">Brak uprawnień do tej rozmowy.</div>`;
          } catch {}
          return;
        }
        console.warn("thread snapshot error:", msg || err);
        try {
          msgs.innerHTML = `<div class="empty">${
            msg.includes("requires an index") || msg.includes("index is currently building")
              ? "Indeks Firestore dla wiadomości jest w trakcie budowania. Odczekaj chwilę (czasem kilka minut) i odśwież."
              : "Nie udało się załadować rozmowy. Spróbuj odświeżyć."
          }</div>`;
        } catch {}
      }
    );

    threadUnsub = () => {
      try { unsub(); } catch {}
    };
  }

  function selectPeer(peerId, labelName) {
    pendingImageAttachment = null;
    updatePendingAttachUI();
    state.selectedPeerId = peerId;
    setStoredSelectedPeerId(peerId);
    titleText.textContent = labelName || "Wiadomości";
    
    // Usuń poprzedni event listener jeśli istnieje
    titleText.onclick = null;
    
    // Support chat (API /api/messages) — wspólna skrzynka administracji
    if (peerId === SUPPORT_PEER_ID) {
      titleText.classList.remove("clickable");
      renderList();
      msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;
      subscribeSupportThread();
      return;
    }

    // Dla normalnych użytkowników: dodaj klikalność i link do profilu
    titleText.classList.add("clickable");
    titleText.onclick = (e) => {
      e.preventDefault();
      const profileUrl = `https://konto.strzelca.pl/profil.html?uid=${peerId}`;
      window.open(profileUrl, "_blank", "noopener,noreferrer");
    };
    
    renderList();
    msgs.innerHTML = `<div class="empty">Ładowanie…</div>`;

    // DM (Firestore privateMessages)
    ensureConversation(peerId).catch(() => {}).finally(() => subscribeThread(peerId));
  }

  // =========================
  // SUPPORT CHAT (realtime Firestore + API read-ack)
  // =========================
  function renderSupportMessages(items) {
    // map to widget render format
    // Dla wiadomości support: jeśli senderId === "admin", używamy "Pomoc STRZELCA.PL" jako nazwy nadawcy
    const mapped = (items || []).map((m) => {
      const senderId = m.senderId || null;
      // Jeśli to wiadomość od admina, ustawiamy senderName na "Pomoc STRZELCA.PL"
      const senderName = (senderId === "admin" || senderId === SUPPORT_PEER_ID) 
        ? "Pomoc STRZELCA.PL" 
        : (m.senderName || null);
      return {
        id: m.id,
        content: (m.content || "").toString(),
        senderId,
        senderName,
        recipientId: m.recipientId || null,
        isRead: m.isRead === true,
        timestampMs: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
        imageAttachment:
          m.imageAttachment &&
          typeof m.imageAttachment.mimeType === "string" &&
          typeof m.imageAttachment.dataBase64 === "string"
            ? {
                mimeType: m.imageAttachment.mimeType,
                dataBase64: m.imageAttachment.dataBase64,
              }
            : null,
      };
    });
    renderMessages(mapped);
  }

  function supportDocToItem(docSnap) {
    const data = docSnap.data() || {};
    const ts = data.timestamp;
    const timestampMs =
      typeof ts?.toMillis === "function" ? ts.toMillis() : typeof ts === "number" ? ts : Date.now();
    return {
      id: docSnap.id,
      content: (data.content || "").toString(),
      senderId: data.senderId || null,
      senderName: data.senderName || null,
      recipientId: data.recipientId || null,
      isRead: data.isRead === true,
      timestampMs,
      imageAttachment:
        data.imageAttachment &&
        typeof data.imageAttachment.mimeType === "string" &&
        typeof data.imageAttachment.dataBase64 === "string"
          ? {
              mimeType: data.imageAttachment.mimeType,
              dataBase64: data.imageAttachment.dataBase64,
            }
          : null,
    };
  }

  async function markSupportRead(items) {
    if (supportReadInFlight) return;
    // Oznacz jako przeczytane wiadomości od "admin" do usera
    const toMark = (items || []).filter((m) => m && m.senderId === "admin" && m.isRead === false && m.id);
    if (!toMark.length) return;
    supportReadInFlight = true;
    
    // Pobierz Firebase Auth ID token jako fallback
    let authToken = null;
    try {
      if (user) {
        authToken = await user.getIdToken();
      }
    } catch (e) {
      console.debug("markSupportRead: Failed to get ID token", e);
    }
    
    const headers = {};
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    
    try {
      await Promise.all(
        toMark.slice(0, 50).map(async (m) => {
          try {
            const apiUrl = getApiUrl(`/api/messages/${m.id}/read`);
            await fetch(apiUrl, {
              method: "PUT",
              credentials: "include",
              headers,
            });
          } catch {}
        })
      );
    } finally {
      supportReadInFlight = false;
    }
  }

  function scheduleSupportRead(items) {
    if (supportReadDebounceTimer) clearTimeout(supportReadDebounceTimer);
    supportReadDebounceTimer = setTimeout(() => {
      void markSupportRead(items);
    }, 250);
  }

  function subscribeSupportThread() {
    if (threadUnsub) threadUnsub();
    supportThreadUnsubs.forEach((u) => {
      try {
        u();
      } catch {}
    });
    supportThreadUnsubs = [];
    let fromUserToSupport = [];
    let fromSupportToUser = [];

    const recompute = () => {
      const items = [...fromUserToSupport, ...fromSupportToUser].sort(
        (a, b) => (a.timestampMs || 0) - (b.timestampMs || 0)
      );
      const unreadFromAdmin = items.filter(
        (m) => m && m.senderId === SUPPORT_PEER_ID && m.recipientId === uid && m.isRead === false
      );
      const unreadCount = unreadFromAdmin.length;
      state.supportUnread = unreadCount;
      const last = items[items.length - 1];
      state.supportLastText = last?.content
        ? String(last.content).slice(0, 70)
        : "Pomoc / zgłoszenia";
      applyUnreadBadge();
      renderList();
      renderSupportMessages(items);

      if (isOpen && state.selectedPeerId === SUPPORT_PEER_ID && unreadCount > 0) {
        scheduleSupportRead(items);
      }
    };

    const qFromUser = query(
      collection(db, "messages"),
      where("senderId", "==", uid)
    );
    const qFromSupport = query(
      collection(db, "messages"),
      where("recipientId", "==", uid)
    );

    const unsubUser = onSnapshot(
      qFromUser,
      (snap) => {
        fromUserToSupport = snap.docs
          .map(supportDocToItem)
          .filter((m) => m && m.recipientId === SUPPORT_PEER_ID);
        recompute();
      },
      (err) => {
        console.warn("support thread (user->support) snapshot:", err?.message || err);
      }
    );
    const unsubSupport = onSnapshot(
      qFromSupport,
      (snap) => {
        fromSupportToUser = snap.docs
          .map(supportDocToItem)
          .filter((m) => m && m.senderId === SUPPORT_PEER_ID);
        recompute();
      },
      (err) => {
        console.warn("support thread (support->user) snapshot:", err?.message || err);
      }
    );
    supportThreadUnsubs = [unsubUser, unsubSupport];

    threadUnsub = () => {
      supportThreadUnsubs.forEach((u) => {
        try {
          u();
        } catch {}
      });
      supportThreadUnsubs = [];
      if (supportReadDebounceTimer) {
        clearTimeout(supportReadDebounceTimer);
      }
      supportReadDebounceTimer = null;
    };
  }

  // Search: live filter + users below (wyszukiwanie po nickach w utworzonych już wiadomościach)
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    state.q = searchInput.value || "";
    // Natychmiastowe filtrowanie konwersacji (po nickach)
    renderList();
    if (searchTimer) clearTimeout(searchTimer);
    // Wyszukiwanie użytkowników z opóźnieniem dla lepszej wydajności
    searchTimer = setTimeout(async () => {
      try {
        state.searchUsers = await searchUsersByPrefix(state.q);
      } catch (e) {
        state.searchUsers = [];
      }
      renderList();
    }, 150);
  });

  async function doSend() {
    const content = (ta.value || "").toString().trim();
    const hasImage = !!pendingImageAttachment;
    if (!content && !hasImage) return;

    sendBtn.disabled = true;
    try {
      if (state.selectedPeerId === SUPPORT_PEER_ID) {
        console.log("doSend: Sending message to support", {
          content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
          userId: uid,
          peerId: state.selectedPeerId
        });
        
        // Pobierz Firebase Auth ID token jako fallback
        let authToken = null;
        try {
          if (user) {
            authToken = await user.getIdToken();
            console.log("doSend: Got Firebase Auth token", authToken ? "yes" : "no");
          }
        } catch (e) {
          console.debug("doSend: Failed to get ID token", e);
        }
        
        const headers = { "Content-Type": "application/json" };
        if (authToken) {
          headers["Authorization"] = `Bearer ${authToken}`;
        }
        
        const apiUrl = getApiUrl("/api/messages");
        const requestBody = {
          content,
          recipientId: "admin",
          status: "in_progress",
        };
        if (hasImage) {
          requestBody.imageAttachment = pendingImageAttachment;
        }
        console.log("doSend: Sending POST request to", apiUrl, {
          body: requestBody,
          headers: Object.keys(headers)
        });
        
        const res = await fetch(apiUrl, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(requestBody),
        });
        
        console.log("doSend: Response status", res.status, res.statusText);
        const data = await res.json().catch((e) => {
          console.error("doSend: Failed to parse JSON response", e);
          return null;
        });
        
        console.log("doSend: Response data", data);
        
        if (!res.ok || !data?.success) {
          const errorMsg = data?.error || `HTTP ${res.status}`;
          console.error("doSend: Request failed", errorMsg);
          throw new Error(errorMsg);
        }
        
        console.log("doSend: Message sent successfully", data?.data?.id);
        ta.value = "";
        pendingImageAttachment = null;
        updatePendingAttachUI();
        ta.focus();
        // Realtime snapshot sam dociągnie nową wiadomość.
      } else {
        console.log("doSend: Sending private message to", state.selectedPeerId);
        await ensureConversation(state.selectedPeerId).catch((e) => {
          console.error("doSend: Failed to ensure conversation", e);
        });
        await sendMessageTo(state.selectedPeerId, content, hasImage ? pendingImageAttachment : null);
        ta.value = "";
        pendingImageAttachment = null;
        updatePendingAttachUI();
        ta.focus();
      }
    } catch (e) {
      console.error("doSend: Send failed", e?.message || e, e);
      alert("Nie udało się wysłać wiadomości: " + (e?.message || "Nieznany błąd"));
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Modal do tworzenia nowej wiadomości
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modalOverlay";
  modalOverlay.innerHTML = `
    <div class="modalContent">
      <div class="modalHeader">
        <div class="modalTitle">Nowa wiadomość</div>
        <button class="modalClose" type="button" aria-label="Zamknij">×</button>
      </div>
      <div class="modalField" style="position: relative;">
        <label class="modalLabel">WYSZUKAJ UŻYTKOWNIKA</label>
        <input type="text" class="search" id="new-msg-user-search" placeholder="Wpisz nick lub email..." autocomplete="off" />
        <input type="hidden" id="new-msg-user-id" />
        <input type="hidden" id="new-msg-user-email" />
        <div class="userSearchResults" id="new-msg-results"></div>
      </div>
      <div class="modalField">
        <label class="modalLabel">WIADOMOŚĆ</label>
        <textarea class="search" id="new-msg-content" placeholder="Wpisz wiadomość..." rows="4" style="resize: vertical;"></textarea>
      </div>
      <div class="modalActions">
        <button class="modalBtn" type="button" id="new-msg-cancel">Anuluj</button>
        <button class="modalBtn primary" type="button" id="new-msg-send">Wyślij</button>
      </div>
    </div>
  `;
  shadow.appendChild(modalOverlay);

  const newMsgUserSearch = shadow.getElementById("new-msg-user-search");
  const newMsgUserId = shadow.getElementById("new-msg-user-id");
  const newMsgUserEmail = shadow.getElementById("new-msg-user-email");
  const newMsgContent = shadow.getElementById("new-msg-content");
  const newMsgResults = shadow.getElementById("new-msg-results");
  const newMsgCancel = shadow.getElementById("new-msg-cancel");
  const newMsgSend = shadow.getElementById("new-msg-send");
  const modalCloseBtn = shadow.querySelector(".modalClose");

  let newMsgSearchTimer = null;
  newMsgUserSearch.addEventListener("input", () => {
    const q = (newMsgUserSearch.value || "").trim();
    if (newMsgSearchTimer) clearTimeout(newMsgSearchTimer);
    if (q.length < 2) {
      newMsgResults.classList.remove("show");
      newMsgResults.innerHTML = "";
      newMsgUserId.value = "";
      newMsgUserEmail.value = "";
      return;
    }
    // Wyszukiwanie "live" - zmniejszony timeout dla szybszej reakcji
    newMsgSearchTimer = setTimeout(async () => {
      try {
        const users = await searchUsersByPrefix(q);
        if (users.length === 0) {
          newMsgResults.innerHTML = '<div style="padding: 12px; text-align: center; color: rgba(229,229,229,0.6); font-size: 12px;">Nie znaleziono użytkowników</div>';
          newMsgResults.classList.add("show");
          return;
        }
        newMsgResults.innerHTML = users.slice(0, 8).map(u => `
          <div class="userResultItem" data-uid="${u.uid}" data-name="${u.displayName || 'Użytkownik'}" data-email="${u.uid}">
            <div class="userResultAvatar">${firstLetter(u.displayName || "U")}</div>
            <div class="userResultText">
              <div class="userResultName">${u.displayName || "Użytkownik"}</div>
            </div>
          </div>
        `).join("");
        newMsgResults.querySelectorAll(".userResultItem").forEach(item => {
          item.addEventListener("click", () => {
            const uid = item.dataset.uid;
            const name = item.dataset.name;
            newMsgUserId.value = uid;
            newMsgUserEmail.value = uid; // Używamy uid jako email dla DM
            newMsgUserSearch.value = name;
            newMsgResults.classList.remove("show");
          });
        });
        newMsgResults.classList.add("show");
      } catch (e) {
        console.warn("User search failed:", e);
        newMsgResults.innerHTML = '<div style="padding: 12px; text-align: center; color: rgba(229,229,229,0.6); font-size: 12px;">Błąd wyszukiwania</div>';
        newMsgResults.classList.add("show");
      }
    }, 150);
  });

  document.addEventListener("click", (e) => {
    if (!newMsgResults.contains(e.target) && !newMsgUserSearch.contains(e.target)) {
      newMsgResults.classList.remove("show");
    }
  });

  async function sendNewMessage() {
    const userId = newMsgUserId.value.trim();
    const content = (newMsgContent.value || "").trim();
    if (!userId || !content) return;
    newMsgSend.disabled = true;
    newMsgSend.textContent = "Wysyłanie...";
    try {
      await ensureConversation(userId).catch(() => {});
      await sendMessageTo(userId, content, null);
      closeNewMessageModal();
      // Otwórz konwersację z wybranym użytkownikiem
      selectPeer(userId, newMsgUserSearch.value || "Użytkownik");
    } catch (e) {
      console.warn("Send new message failed:", e?.message || e);
      alert("Nie udało się wysłać wiadomości. Spróbuj ponownie.");
    } finally {
      newMsgSend.disabled = false;
      newMsgSend.textContent = "Wyślij";
    }
  }

  function openNewMessageModal() {
    modalOverlay.classList.add("show");
    newMsgUserSearch.focus();
  }

  function closeNewMessageModal() {
    modalOverlay.classList.remove("show");
    newMsgUserSearch.value = "";
    newMsgContent.value = "";
    newMsgUserId.value = "";
    newMsgUserEmail.value = "";
    newMsgResults.classList.remove("show");
    newMsgResults.innerHTML = "";
  }

  newMsgBtn.addEventListener("click", openNewMessageModal);
  newMsgCancel.addEventListener("click", closeNewMessageModal);
  modalCloseBtn.addEventListener("click", closeNewMessageModal);
  newMsgSend.addEventListener("click", sendNewMessage);
  newMsgContent.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendNewMessage();
    }
  });
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeNewMessageModal();
  });

  btn.addEventListener("click", () => {
    if (isOpen) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  sendBtn.addEventListener("click", doSend);
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const bar = pendingProgress.querySelector(".attachProgressBar");
    let blobUrl = null;
    try {
      attachBtn.disabled = true;
      attachmentProcessing = true;
      pendingImageAttachment = null;
      pendingAttach.classList.add("show");
      blobUrl = URL.createObjectURL(f);
      pendingThumb.src = blobUrl;
      pendingThumb.style.display = "block";
      pendingProgress.style.display = "block";
      if (bar) bar.style.width = "5%";
      pendingLabel.textContent = "Wczytywanie i przygotowanie zdjęcia…";
      const att = await compressImageFileToJpegAttachment(f, (p) => {
        if (bar) bar.style.width = `${8 + Math.round(p * 90)}%`;
        if (p < 0.28) pendingLabel.textContent = "Wczytywanie obrazu…";
        else if (p < 0.55) pendingLabel.textContent = "Optymalizacja rozmiaru…";
        else if (p < 0.9) pendingLabel.textContent = "Kompresja…";
        else pendingLabel.textContent = "Finalizowanie…";
      });
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      pendingImageAttachment = att;
      attachmentProcessing = false;
      if (bar) bar.style.width = "100%";
      updatePendingAttachUI();
      setTimeout(() => {
        if (pendingImageAttachment) pendingProgress.style.display = "none";
      }, 400);
    } catch (e) {
      attachmentProcessing = false;
      pendingImageAttachment = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      updatePendingAttachUI();
      alert(e?.message || "Nie udało się przygotować zdjęcia");
    } finally {
      fileInput.value = "";
      attachBtn.disabled = false;
    }
  });
  pendingRemove.addEventListener("click", () => {
    pendingImageAttachment = null;
    attachmentProcessing = false;
    updatePendingAttachUI();
  });
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
    if (!convUnsub) subscribeConversations();
    if (!supportBadgeUnsub) subscribeSupportBadgeListener();
    selectPeer(state.selectedPeerId, state.selectedPeerId === SUPPORT_PEER_ID ? "Obsługa Strzelca.pl" : "Wiadomości");
  }

  // Otwieranie z zewnątrz (np. kafelek na kontakt.strzelca.pl): nie możemy wywołać openPanel()
  // synchronicznie w handlerze kliknięcia — ten sam event bąbelkuje do document, gdzie mamy
  // „klik poza widgetem = zamknij”, przy czym w chwili obsługi document isOpen jest jeszcze false.
  window.__strzelcaMessagesOpen = () => {
    queueMicrotask(() => openPanel());
  };

  /** Otwiera panel wiadomości na konwersacji „Pomoc STRZELCA.PL” z opcjonalnym szkicem w polu wpisywania. */
  window.__strzelcaMessagesOpenSupport = (opts = {}) => {
    queueMicrotask(() => {
      const draft = (opts && typeof opts.draftText === "string") ? opts.draftText : "";
      state.selectedPeerId = SUPPORT_PEER_ID;
      setStoredSelectedPeerId(SUPPORT_PEER_ID);
      if (!isOpen) openPanel();
      else if (!convUnsub) subscribeConversations();
      selectPeer(SUPPORT_PEER_ID, "Pomoc STRZELCA.PL");
      if (draft) {
        ta.value = draft;
        try {
          ta.focus();
        } catch {
          // ignore
        }
      }
    });
  };

  function closePanel() {
    closeWidgetImageLightbox();
    isOpen = false;
    setStoredOpen(false);
    panel.style.display = "none";
    if (threadUnsub) threadUnsub();
    threadUnsub = null;
    ensurePassiveRealtimeSubscriptions();
  }

  // init
  renderList();
  startBadgeLeadershipLoop();
  if (isOpen) openPanel();
}
}

if (typeof window !== "undefined") {
  // Guard przed podwójnym uruchomieniem, jeśli widget zostanie dołączony 2x.
  if (!window.__strzelcaMessagesWidgetLoaded) {
    window.__strzelcaMessagesWidgetLoaded = true;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            main().catch((e) => console.warn("messages-widget:", e?.message || e));
          },
          { once: true }
        );
      } else {
        main().catch((e) => console.warn("messages-widget:", e?.message || e));
      }
    }
  }
}
