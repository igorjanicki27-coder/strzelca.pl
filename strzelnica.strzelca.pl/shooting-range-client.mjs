import { resolveStrzelcaAuthDomain } from "https://strzelca.pl/strzelca-firebase-helpers.mjs?v=2026-04-13-1";
import { ensureFirebaseSSO } from "https://strzelca.pl/sso-client.mjs?v=2026-03-29-4";
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const API_BASE = "https://strzelca.pl/api/shooting-range";
let firebaseRuntime = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function showNotice(message, type = "info") {
  const el = document.getElementById("shooting-range-notice");
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.remove("hidden");
  clearTimeout(showNotice._timer);
  showNotice._timer = setTimeout(() => {
    el.classList.add("hidden");
  }, 5000);
}

async function getFirebaseConfig() {
  const response = await fetch("https://strzelca.pl/api/firebase-config", {
    credentials: "include",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.apiKey) {
    throw new Error(data?.error || "Nie udało się pobrać konfiguracji Firebase.");
  }
  return data;
}

export async function initFirebaseForStrzelnica() {
  if (firebaseRuntime) return firebaseRuntime;
  const remoteConfig = await getFirebaseConfig();
  const firebaseConfig = {
    apiKey: remoteConfig.apiKey,
    authDomain: remoteConfig.authDomain || resolveStrzelcaAuthDomain(),
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
  } catch (error) {
    if (error?.code === "failed-precondition") {
      db = getFirestore(app);
    } else {
      throw error;
    }
  }
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  try {
    await ensureFirebaseSSO(auth);
  } catch (error) {
    console.warn("ensureFirebaseSSO:", error?.message || error);
  }
  firebaseRuntime = { app, db, auth };
  return firebaseRuntime;
}

export async function getBearerToken() {
  const runtime = await initFirebaseForStrzelnica();
  if (!runtime.auth.currentUser) return "";
  try {
    return await runtime.auth.currentUser.getIdToken();
  } catch {
    return "";
  }
}

export async function api(path = "", options = {}) {
  const url = `${API_BASE}${path ? `/${String(path).replace(/^\/+/, "")}` : ""}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.auth !== false) {
    const token = await getBearerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    credentials: "include",
    cache: "no-store",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || "Wystąpił błąd połączenia z modułem strzelnicy.");
  }
  return data;
}

export async function requireCurrentUser() {
  const runtime = await initFirebaseForStrzelnica();
  if (!runtime.auth.currentUser) {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `https://konto.strzelca.pl/logowanie.html?returnUrl=${returnUrl}`;
    throw new Error("redirecting-to-login");
  }
  return runtime.auth.currentUser;
}

export function renderFaq(entries = []) {
  return entries
    .map(
      (entry, index) => `
        <details class="strzelnica-faq-item group" ${index === 0 ? "open" : ""}>
          <summary>
            <span>${escapeHtml(entry.question || "")}</span>
            <i class="fa-solid fa-plus"></i>
          </summary>
          <div class="faq-answer">${escapeHtml(entry.answer || "")}</div>
        </details>
      `,
    )
    .join("");
}

export function renderLaneCards(lanes = []) {
  return lanes
    .map(
      (lane) => `
        <article class="strzelnica-card lane-card">
          <div class="lane-card-media">
            ${
              lane.heroImage
                ? `<img src="${escapeHtml(lane.heroImage)}" alt="${escapeHtml(lane.name)}" loading="lazy" />`
                : `<div class="lane-card-placeholder"><span>${escapeHtml(lane.name)}</span></div>`
            }
          </div>
          <div class="lane-card-body">
            <div class="lane-card-meta">
              <span>${escapeHtml(lane.lengthMeters)} m</span>
              <span>${escapeHtml(lane.positions)} stanowisko${Number(lane.positions) === 1 ? "" : "a"}</span>
              <span>${escapeHtml(lane.laneType || "otwarta")}</span>
            </div>
            <h3>${escapeHtml(lane.name)}</h3>
            <p>${escapeHtml((lane.description || "").replace(/<[^>]+>/g, "").slice(0, 200))}</p>
            <div class="lane-card-pricing">
              <strong>${formatMoney(lane.pricePerHour)}/h</strong>
              <span>firma: ${formatMoney(lane.companyPricePerHour)}/h</span>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

export function renderPackageCards(packages = []) {
  return packages
    .map(
      (item) => `
        <article class="strzelnica-card package-card">
          <div class="package-card-header">
            ${item.badge ? `<span class="package-badge">${escapeHtml(item.badge)}</span>` : ""}
            <h3>${escapeHtml(item.title)}</h3>
          </div>
          <p>${escapeHtml((item.description || "").replace(/<[^>]+>/g, "").slice(0, 240))}</p>
          <div class="package-card-footer">
            <strong>${formatMoney(item.price)}</strong>
            <span>firma: ${formatMoney(item.companyPrice)}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

export function renderOfferCards(offers = []) {
  return offers
    .map(
      (item) => `
        <article class="strzelnica-card offer-card">
          <div class="offer-eyebrow">${escapeHtml(item.type === "training" ? "Szkolenie" : "Oferta")}</div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml((item.description || "").replace(/<[^>]+>/g, "").slice(0, 220))}</p>
          <div class="offer-card-footer">
            <strong>${item.paymentMode === "on_site" ? "Płatność na miejscu" : formatMoney(item.price)}</strong>
            <span>${escapeHtml(item.subtitle || "")}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

export function mountHotPayForm(target, hotpay) {
  if (!target || !hotpay?.action || !hotpay?.fields) return;
  target.innerHTML = "";
  const form = document.createElement("form");
  form.action = hotpay.action;
  form.method = hotpay.method || "POST";
  Object.entries(hotpay.fields).forEach(([key, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = String(value ?? "");
    form.appendChild(input);
  });
  target.appendChild(form);
  form.submit();
}

export function createOptionList(items = [], labelKey = "name") {
  return items
    .map((item) => `<option value="${escapeHtml(item.id || item.userId || "")}">${escapeHtml(item[labelKey] || item.displayName || "")}</option>`)
    .join("");
}

export function readFormJson(form) {
  const fd = new FormData(form);
  const out = {};
  for (const [key, value] of fd.entries()) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      if (!Array.isArray(out[key])) out[key] = [out[key]];
      out[key].push(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
