import {
  getHeaderProfileFromCache,
  setHeaderProfileCache,
} from "https://strzelca.pl/header-profile-cache.mjs?v=2026-03-21-1";
import { resolveStrzelcaAuthDomain } from "https://strzelca.pl/strzelca-firebase-helpers.mjs?v=2026-04-12-1";

const API_URL = "https://strzelca.pl/api/me";
const PROFILE_URL = "https://konto.strzelca.pl/profil.html";
const LOGOUT_URL = "https://strzelca.pl/api/sso-session-logout";
const SSO_CLIENT_MOD = "https://strzelca.pl/sso-client.mjs?v=2026-04-12-3";
const GOOGLE_PROVISION_MOD =
  "https://strzelca.pl/google-account-provision.mjs?v=2026-04-11-1";
/** Po pierwszym nieudanym logowaniu hasłem pokaż „Zapomniałem hasła” (sesja karty). */
const SESSION_SHOW_FORGOT_PASSWORD = "strzelca_login_modal_show_forgot";
const FIREBASE_CONFIG_BASE = {
  projectId: "strzelca-pl",
  storageBucket: "strzelca-pl.appspot.com",
  messagingSenderId: "511362047688",
  appId: "1:511362047688:web:9b82c0a4d19c1a3a878ffd",
  measurementId: "G-9EJ2R3JPVD",
};

const notificationState = {
  runtime: null,
  user: null,
  profile: null,
  notifications: [],
  allNotifications: [],
  allNotificationsLoaded: false,
  activeInfo: null,
  unsubscribeNotifications: null,
  markReadInFlight: false,
};
let loginModalBound = false;

function ensureStyles() {
  if (document.getElementById("strzelca-auth-widget-style")) return;
  const style = document.createElement("style");
  style.id = "strzelca-auth-widget-style";
  style.textContent = `
    /*
     * Starsze szablony mają własny #login-button / #user-panel obok widgetu.
     * Gdy użytkownik jest w sesji SSO/API, inline onAuth często ma user=null — skrypt
     * odkrywał z powrotem strzałkę. Ukrywamy duplikat zawsze, gdy widget jest w DOM.
     */
    body:has(#strzelca-auth-widget) #login-button,
    body:has(#strzelca-auth-widget) #user-panel {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    #strzelca-auth-widget {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    #strzelca-auth-widget a,
    #strzelca-auth-widget button {
      font: inherit;
    }
    .strzelca-auth-pill {
      background: rgba(10, 10, 10, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 999px;
      padding: 8px 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
    .strzelca-auth-pill--avatar-only {
      background: transparent;
      border: none;
      padding: 0;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .strzelca-auth-text {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .strzelca-auth-login-icon {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(193, 154, 107, 0.95);
      color: #0b0b0b;
      font-size: 16px;
      font-weight: 900;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
    }
    .strzelca-auth-login-split {
      position: relative;
      width: 192px;
      height: 46px;
      border-radius: 999px;
      display: block;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.2);
      box-shadow: 0 12px 30px rgba(0,0,0,0.42);
      padding: 0;
      cursor: pointer;
    }
    .strzelca-auth-login-split:disabled {
      cursor: not-allowed;
      opacity: 0.88;
    }
    .strzelca-auth-login-plain {
      border: none;
      background: transparent;
      color: #c19a6b;
      font-size: 34px;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: transform 0.2s ease, color 0.2s ease;
      text-decoration: none;
    }
    .strzelca-auth-login-plain:hover {
      transform: scale(1.14);
      color: #d4b896;
    }
    .strzelca-auth-login-main,
    .strzelca-auth-login-google {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      border: none;
      margin: 0;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transform: scale(1);
      transition: transform 0.2s ease, filter 0.2s ease;
    }
    .strzelca-auth-login-main {
      z-index: 1;
      /* Szerszy lewy klin; lekkie nachodzenie na prawy klin zapobiega szczelinie przy scale */
      clip-path: polygon(0 0, 63.8% 0, 55% 100%, 0 100%);
      background: rgba(193, 154, 107, 0.98);
      color: #0b0b0b;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      transform-origin: 35% 50%;
      justify-content: flex-start;
      align-items: stretch;
      padding: 0;
    }
    .strzelca-auth-login-main-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 61%;
      height: 100%;
      box-sizing: border-box;
      padding: 0 8px 0 10px;
      white-space: nowrap;
    }
    .strzelca-auth-login-google {
      z-index: 2;
      clip-path: polygon(62.2% 0, 100% 0, 100% 100%, 53% 100%);
      background: #dc2626;
      color: #fff;
      transform-origin: 78% 50%;
      justify-content: flex-end;
      align-items: stretch;
      padding: 0;
    }
    .strzelca-auth-login-google-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 38%;
      height: 100%;
      box-sizing: border-box;
      padding: 0 10px 0 6px;
      flex-shrink: 0;
    }
    .strzelca-auth-login-split:not(:disabled) .strzelca-auth-login-main:hover {
      transform: scale(1.11);
      filter: brightness(1.04);
    }
    .strzelca-auth-login-split:not(:disabled) .strzelca-auth-login-google:hover {
      transform: scale(1.11);
      filter: brightness(1.04);
    }
    .strzelca-auth-google-g {
      display: block;
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    .strzelca-auth-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .strzelca-auth-login-main:focus-visible,
    .strzelca-auth-login-google:focus-visible {
      outline: 2px solid #fff;
      outline-offset: -2px;
    }
    .strzelca-auth-spinner {
      width: 16px;
      height: 16px;
      border-radius: 999px;
      border: 2px solid rgba(255,255,255,0.22);
      border-top-color: rgba(255,255,255,0.9);
      animation: strzelcaAuthSpin 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes strzelcaAuthSpin {
      to { transform: rotate(360deg); }
    }
    .strzelca-auth-avatar-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .strzelca-auth-avatar-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
    }
    .strzelca-auth-avatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(193, 154, 107, 0.95);
      color: #111;
      font-weight: 900;
      box-shadow: 0 10px 24px rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .strzelca-auth-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .strzelca-auth-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      padding: 0 5px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #dc2626;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      border: 2px solid rgba(10, 10, 10, 0.9);
      box-shadow: 0 8px 16px rgba(220,38,38,0.35);
    }
    .strzelca-auth-badge[hidden] {
      display: none !important;
    }
    .strzelca-auth-menu {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: min(280px, calc(100vw - 28px));
      padding: 10px;
      border-radius: 18px;
      background: rgba(10, 10, 10, 0.96);
      border: 1px solid rgba(255,255,255,0.12);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 22px 60px rgba(0,0,0,0.45);
    }
    .strzelca-auth-menu[hidden] {
      display: none !important;
    }
    .strzelca-auth-menu-item,
    .strzelca-auth-menu-link {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      color: #f4f4f5;
      text-decoration: none;
      border: none;
      background: transparent;
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease;
      text-align: left;
    }
    .strzelca-auth-menu-item:hover,
    .strzelca-auth-menu-link:hover {
      background: rgba(193, 154, 107, 0.12);
      color: #fff;
    }
    .strzelca-auth-menu-item[disabled] {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .strzelca-auth-menu-item-main {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .strzelca-auth-menu-kicker {
      display: inline-flex;
      min-width: 22px;
      height: 22px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(220, 38, 38, 0.18);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 800;
      padding: 0 7px;
    }
    .strzelca-auth-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .strzelca-auth-modal[hidden] {
      display: none !important;
    }
    .strzelca-auth-modal-card {
      width: min(532px, 100%);
      max-height: min(90vh, 900px);
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, rgba(19,19,19,0.98) 0%, rgba(10,10,10,0.98) 100%);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.48);
      overflow: hidden;
    }
    .strzelca-auth-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 22px 24px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .strzelca-auth-modal-title {
      color: #f4f4f5;
      font-size: 22px;
      font-weight: 800;
      margin: 0;
      flex: 1;
      min-width: 0;
    }
    .strzelca-auth-modal-subtitle {
      color: #a1a1aa;
      font-size: 14px;
      margin: 6px 0 0;
    }
    .strzelca-auth-modal-close {
      border: none;
      background: rgba(255,255,255,0.06);
      color: #d4d4d8;
      width: 40px;
      height: 40px;
      border-radius: 999px;
      cursor: pointer;
      flex: 0 0 auto;
    }
    .strzelca-auth-modal-body {
      padding: 18px 24px 24px;
      overflow: auto;
      color: #e4e4e7;
    }
    .strzelca-auth-login-form {
      display: grid;
      gap: 12px;
    }
    .strzelca-auth-login-submit-wrap {
      display: flex;
      justify-content: center;
      width: 100%;
    }
    .strzelca-auth-login-field-label {
      color: #a1a1aa;
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 700;
      margin-bottom: 6px;
      display: block;
    }
    .strzelca-auth-login-input {
      width: 100%;
      min-height: 44px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.04);
      color: #f4f4f5;
      padding: 11px 14px;
      outline: none;
    }
    .strzelca-auth-login-input:focus {
      border-color: rgba(193,154,107,0.9);
      box-shadow: 0 0 0 2px rgba(193,154,107,0.2);
    }
    .strzelca-auth-login-status {
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: #e4e4e7;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.45;
      text-align: center;
    }
    .strzelca-auth-login-status.is-error {
      border-color: rgba(239,68,68,0.55);
      background: rgba(127,29,29,0.25);
      color: #fecaca;
    }
    .strzelca-auth-login-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px 28px;
      margin-top: 10px;
      width: 100%;
    }
    .strzelca-auth-login-actions--solo {
      justify-content: center;
    }
    .strzelca-auth-login-actions:not(.strzelca-auth-login-actions--solo) {
      justify-content: space-between;
    }
    .strzelca-auth-login-reset {
      border: none;
      background: transparent;
      color: #d4b896;
      font-size: 13px;
      cursor: pointer;
      padding: 0;
      text-decoration: none;
      font: inherit;
    }
    a.strzelca-auth-login-reset {
      display: inline;
    }
    .strzelca-auth-login-reset:hover {
      color: #f5e7d5;
      text-decoration: underline;
    }
    .strzelca-auth-empty {
      padding: 32px 16px;
      text-align: center;
      color: #a1a1aa;
      border: 1px dashed rgba(255,255,255,0.12);
      border-radius: 18px;
      background: rgba(255,255,255,0.02);
    }
    .strzelca-auth-notification-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .strzelca-auth-list-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #a1a1aa;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 2px 0;
    }
    .strzelca-auth-list-divider::before,
    .strzelca-auth-list-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: rgba(255,255,255,0.12);
    }
    .strzelca-auth-notification-item {
      width: 100%;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      background: rgba(255,255,255,0.03);
      color: inherit;
      cursor: default;
      padding: 16px 18px;
      text-align: left;
      transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .strzelca-auth-notification-item:hover {
      transform: translateY(-1px);
      border-color: rgba(193,154,107,0.32);
      background: rgba(193,154,107,0.06);
    }
    .strzelca-auth-notification-item.is-new {
      border-color: rgba(239,68,68,0.48);
      box-shadow: inset 0 0 0 1px rgba(239,68,68,0.14);
    }
    .strzelca-auth-notification-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      color: #a1a1aa;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .strzelca-auth-notification-category {
      color: #d4b896;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .strzelca-auth-notification-title {
      font-size: 16px;
      font-weight: 800;
      color: #fafafa;
      margin-bottom: 6px;
    }
    .strzelca-auth-notification-body {
      color: #d4d4d8;
      font-size: 14px;
      line-height: 1.55;
    }
    .strzelca-auth-notification-body p {
      margin: 0.45em 0;
    }
    .strzelca-auth-notification-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 14px;
      padding: 8px 16px;
      border-radius: 999px;
      border: 1px solid rgba(193,154,107,0.45);
      background: rgba(193,154,107,0.12);
      color: #f5e6d0;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .strzelca-auth-notification-link:hover {
      background: rgba(193,154,107,0.22);
      border-color: rgba(193,154,107,0.65);
      color: #fffaf2;
    }
    .strzelca-auth-notification-footer {
      display: flex;
      justify-content: center;
      padding-top: 10px;
    }
    .strzelca-auth-secondary-btn,
    .strzelca-auth-primary-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 42px;
      border-radius: 999px;
      padding: 0 18px;
      border: 1px solid rgba(255,255,255,0.14);
      cursor: pointer;
      text-decoration: none;
      font-weight: 700;
    }
    .strzelca-auth-secondary-btn {
      background: rgba(255,255,255,0.05);
      color: #f4f4f5;
    }
    .strzelca-auth-primary-btn {
      background: rgba(193,154,107,0.92);
      color: #111;
      border-color: rgba(193,154,107,0.92);
    }
    .strzelca-auth-filters {
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 18px;
    }
    #strzelca-notifications-all-modal .strzelca-auth-modal-card {
      width: min(760px, 100%);
    }
    #strzelca-notifications-all-modal .strzelca-auth-filters {
      grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(170px, 1fr));
    }
    .strzelca-auth-input,
    .strzelca-auth-select {
      width: 100%;
      min-height: 42px;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.04);
      color: #f4f4f5;
      outline: none;
    }
    .strzelca-auth-info-content {
      color: #e4e4e7;
      font-size: 15px;
      line-height: 1.65;
    }
    .strzelca-auth-info-content p {
      margin: 0.6em 0;
    }
    .strzelca-auth-info-content a {
      color: #d4b896;
    }
    .strzelca-auth-info-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }
    #strzelca-admin-fab {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 54px;
      height: 54px;
      border-radius: 999px;
      border: 1px solid rgba(239,68,68,0.35);
      background: rgba(10, 10, 10, 0.78);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 14px 40px rgba(0,0,0,0.45);
      display: none;
      align-items: center;
      justify-content: center;
      color: #fecaca;
      cursor: pointer;
      text-decoration: none;
      font-weight: 900;
      user-select: none;
    }
    #strzelca-admin-fab:hover {
      border-color: rgba(239,68,68,0.7);
      color: #fff;
    }
    #strzelca-admin-fab span {
      font-size: 20px;
      line-height: 1;
    }
    @media (max-width: 640px) {
      #strzelca-auth-widget {
        top: 10px;
        right: 10px;
      }
      .strzelca-auth-modal {
        padding: 10px;
      }
      .strzelca-auth-modal-card {
        max-height: 94vh;
        border-radius: 18px;
      }
      .strzelca-auth-modal-header,
      .strzelca-auth-modal-body {
        padding-left: 16px;
        padding-right: 16px;
      }
      .strzelca-auth-filters {
        grid-template-columns: 1fr;
      }
      #strzelca-notifications-all-modal .strzelca-auth-filters {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function hideLegacyAuthUiIfPresent() {
  const legacy = ["user-panel", "login-button"];
  for (const id of legacy) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Zgadne z api/_notifications.js sanitizeLinkUrl — tylko http(s) lub ścieżka od / (bez //). */
function notificationSafeHref(raw) {
  const u = String(raw || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return "";
  if (u.startsWith("/")) return u;
  const head = u.slice(0, 8).toLowerCase();
  if (head.startsWith("https://") || head.startsWith("http://")) return u;
  return "";
}

function firstLetter(name) {
  const s = (name || "").toString().trim();
  if (!s) return "U";
  return s[0].toUpperCase();
}

function formatDate(value) {
  const date = timestampToDate(value);
  if (!date) return "przed chwilą";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {}
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function badgeLabel(count) {
  if (!count || count < 1) return "";
  return count > 99 ? "99+" : String(count);
}

function mapNotificationCategory(category) {
  switch (String(category || "").toLowerCase()) {
    case "system":
      return "System";
    case "account":
      return "Konto";
    case "profile":
      return "Profil";
    case "blog":
      return "Blog";
    case "events":
      return "Wydarzenia";
    case "bazaar":
      return "Bazar";
    case "admin":
      return "Admin";
    default:
      return "Powiadomienie";
  }
}

function isAdminRole(role) {
  const value = String(role || "").toLowerCase();
  return (
    value === "admin" ||
    value === "administrator" ||
    value === "superadmin" ||
    value === "moderator" ||
    value === "operator"
  );
}

function audienceMatches(data, uid, role) {
  if (!data) return false;
  if (data.audienceAll === true) return true;
  const roles = Array.isArray(data.targetRoles) ? data.targetRoles : [];
  const userIds = Array.isArray(data.targetUserIds) ? data.targetUserIds : [];
  return roles.includes(String(role || "").toLowerCase()) || userIds.includes(uid);
}

async function getFirebaseApiKey() {
  const isMain = (typeof window !== "undefined" && window.location?.hostname) === "strzelca.pl";
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
      if (data && typeof data.apiKey === "string" && data.apiKey.length > 10) {
        return data.apiKey;
      }
    } catch {}
  }
  return null;
}

async function tryGetFirebaseSession() {
  try {
    const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
    ]);
    const { getAuth, browserLocalPersistence, setPersistence, getRedirectResult } = authMod;
    const { initializeFirestore, getFirestore, doc, getDoc } = fsMod;

    let app = getApps()[0] || null;
    if (!app) {
      const apiKey = await getFirebaseApiKey();
      if (!apiKey) return null;
      app = initializeApp({
        ...FIREBASE_CONFIG_BASE,
        apiKey,
        authDomain: resolveStrzelcaAuthDomain(),
      });
    }

    const auth = getAuth(app);

    /* OAuth redirect przed setPersistence — spójnie z auth-init.mjs */
    try {
      if (typeof getRedirectResult === "function") {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult?.user) {
          const { syncSessionCookieFromFirebaseUser } = await import(SSO_CLIENT_MOD);
          let sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
          if (sync?.status !== "ok") {
            await new Promise((r) => setTimeout(r, 200));
            sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
          }
          try {
            const { ensureGoogleUserProfileIfNeeded } = await import(GOOGLE_PROVISION_MOD);
            await ensureGoogleUserProfileIfNeeded(app, redirectResult.user);
          } catch (provErr) {
            console.warn("Google profile provision (auth-widget):", provErr?.message || provErr);
          }
        }
      }
    } catch (e) {
      const code = String(e?.code || "");
      if (code === "auth/account-exists-with-different-credential") {
        try {
          sessionStorage.setItem(
            "strzelca_oauth_redirect_error",
            JSON.stringify({ code, t: Date.now() }),
          );
        } catch {}
      }
      console.warn("getRedirectResult (auth-widget):", code || "(no code)", e?.message || e);
    }

    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {}

    try {
      const { ensureFirebaseSSO } = await import(SSO_CLIENT_MOD);
      await ensureFirebaseSSO(auth);
    } catch {}

    try {
      await auth.authStateReady();
    } catch {}

    let db;
    try {
      db = initializeFirestore(app, {
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

    const user = auth.currentUser;
    if (!user) {
      return {
        authenticated: false,
        runtime: { app, auth, db, fsMod, authMod },
      };
    }

    const cached = getHeaderProfileFromCache(user.uid);
    if (cached) {
      return {
        authenticated: true,
        user,
        profile: {
          displayName: cached.displayName || undefined,
          avatar: cached.avatar || undefined,
          role: cached.role || undefined,
        },
        runtime: { app, auth, db, fsMod, authMod },
      };
    }

    let profile = null;
    try {
      const snap = await getDoc(doc(db, "userProfiles", user.uid));
      if (snap.exists()) {
        profile = snap.data();
        setHeaderProfileCache(user.uid, {
          displayName: profile.displayName || "",
          avatar: profile.avatar || "",
          gender: profile.gender ?? null,
          role: profile.role || "user",
          profileExists: true,
        });
      } else {
        const fallbackName = user.displayName || user.email?.split("@")[0] || "";
        setHeaderProfileCache(user.uid, {
          displayName: fallbackName,
          avatar: "",
          gender: null,
          role: "user",
          profileExists: false,
        });
      }
    } catch {}

    return {
      authenticated: true,
      user,
      profile,
      runtime: { app, auth, db, fsMod, authMod },
    };
  } catch {
    return null;
  }
}

function renderLoading(root) {
  root.innerHTML = `
    <div class="strzelca-auth-pill" role="status" aria-live="polite" aria-label="Sprawdzanie logowania">
      <span style="display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:inherit;">
        <span class="strzelca-auth-spinner" aria-hidden="true"></span>
      </span>
    </div>
  `;
}

function renderLoggedOut(root) {
  root.innerHTML = `
    <div class="strzelca-auth-pill strzelca-auth-pill--avatar-only">
      <button id="strzelca-open-login-modal" type="button" class="strzelca-auth-login-plain" aria-label="Zaloguj się">
        <span aria-hidden="true">➜</span>
      </button>
    </div>
  `;
}

function ensureLoginModal() {
  if (document.getElementById("strzelca-login-modal")) return;
  const modal = document.createElement("div");
  modal.id = "strzelca-login-modal";
  modal.className = "strzelca-auth-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="strzelca-auth-modal-card">
      <div class="strzelca-auth-modal-header">
        <h2 class="strzelca-auth-modal-title">Logowanie</h2>
        <button id="strzelca-login-close" class="strzelca-auth-modal-close" type="button" aria-label="Zamknij">✕</button>
      </div>
      <div class="strzelca-auth-modal-body">
        <form id="strzelca-login-form" class="strzelca-auth-login-form">
          <div>
            <label class="strzelca-auth-login-field-label" for="strzelca-login-email">Adres e-mail</label>
            <input id="strzelca-login-email" class="strzelca-auth-login-input" type="email" autocomplete="email" required />
          </div>
          <div>
            <label class="strzelca-auth-login-field-label" for="strzelca-login-password">Hasło</label>
            <input id="strzelca-login-password" class="strzelca-auth-login-input" type="password" autocomplete="current-password" required />
          </div>
          <div class="strzelca-auth-login-submit-wrap">
            <button id="strzelca-login-submit" type="submit" class="strzelca-auth-login-split" aria-label="Zaloguj się">
              <span class="strzelca-auth-login-main">
                <span class="strzelca-auth-login-main-inner">Zaloguj się</span>
              </span>
              <span class="strzelca-auth-login-google">
                <span class="strzelca-auth-sr-only">Logowanie przez Google</span>
                <span class="strzelca-auth-login-google-inner">
                  <svg class="strzelca-auth-google-g" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </span>
              </span>
            </button>
          </div>
          <div class="strzelca-auth-login-actions strzelca-auth-login-actions--solo">
            <a href="https://konto.strzelca.pl/rejestracja.html" class="strzelca-auth-login-reset">Zarejestruj się</a>
            <button id="strzelca-login-reset" type="button" class="strzelca-auth-login-reset" hidden aria-hidden="true">Zapomniałem hasła</button>
          </div>
          <div id="strzelca-login-status" class="strzelca-auth-login-status" hidden></div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  applyLoginFooterVisibility();
}

function openLoginModal() {
  try {
    document.getElementById("order-login-modal")?.remove();
  } catch {}
  try {
    const rcAuth = document.getElementById("return-claim-auth-choice-modal");
    if (rcAuth && !rcAuth.classList.contains("hidden")) {
      rcAuth.classList.add("hidden");
      rcAuth.setAttribute("aria-hidden", "true");
      const rcForm = document.getElementById("return-claim-form-modal");
      if (rcForm && rcForm.classList.contains("hidden")) {
        document.body.classList.remove("overflow-hidden");
      }
    }
  } catch {}
  ensureLoginModal();
  applyLoginFooterVisibility();
  const modal = document.getElementById("strzelca-login-modal");
  if (!modal) return;
  modal.hidden = false;
  const email = document.getElementById("strzelca-login-email");
  if (email) email.focus();
}

function closeLoginModal() {
  const modal = document.getElementById("strzelca-login-modal");
  if (modal) modal.hidden = true;
}

if (typeof window !== "undefined") {
  window.strzelcaOpenLoginModal = openLoginModal;
  window.strzelcaCloseLoginModal = closeLoginModal;
}

function setLoginStatus(message, isError = false) {
  const status = document.getElementById("strzelca-login-status");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.classList.toggle("is-error", !!isError);
}

function shouldShowForgotPasswordLink() {
  try {
    return sessionStorage.getItem(SESSION_SHOW_FORGOT_PASSWORD) === "1";
  } catch {
    return false;
  }
}

function applyLoginFooterVisibility() {
  const actions = document.querySelector("#strzelca-login-form .strzelca-auth-login-actions");
  const resetBtn = document.getElementById("strzelca-login-reset");
  if (!actions || !resetBtn) return;
  const show = shouldShowForgotPasswordLink();
  resetBtn.hidden = !show;
  resetBtn.setAttribute("aria-hidden", show ? "false" : "true");
  actions.classList.toggle("strzelca-auth-login-actions--solo", !show);
}

/** Po nieudanym redirect OAuth (np. konto już z hasłem) — pokaż komunikat w modalu. */
function flushOAuthRedirectErrorToModal() {
  try {
    const raw = sessionStorage.getItem("strzelca_oauth_redirect_error");
    if (!raw) return;
    sessionStorage.removeItem("strzelca_oauth_redirect_error");
    const o = JSON.parse(raw);
    if (o?.code !== "auth/account-exists-with-different-credential") return;
    ensureLoginModal();
    setLoginStatus(
      "To konto jest już powiązane z inną metodą logowania (np. hasłem). Zaloguj się hasłem — Google możesz dodać w profilu na konto.strzelca.pl.",
      true,
    );
  } catch {}
}

/** Rozpoznaje href do stron logowania na konto.strzelca.pl (z parametrami query). */
function isKontoLoginPageHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const base = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://strzelca.pl";
    const u = raw.startsWith("//") ? new URL(`https:${raw}`) : new URL(raw, base);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "konto.strzelca.pl") return false;
    const path = (u.pathname || "").replace(/\/+$/, "") || "/";
    return ["/login.html", "/login", "/logowanie.html", "/logowanie"].includes(path);
  } catch {
    return false;
  }
}

function bindGlobalLoginTriggers() {
  if (loginModalBound) return;
  loginModalBound = true;
  const LOGIN_TRIGGER_SELECTOR = [
    "#strzelca-open-login-modal",
    "[data-open-login-modal]",
    'a[href*="konto.strzelca.pl/login"]',
    'a[href*="konto.strzelca.pl/logowanie"]',
  ].join(", ");

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented) return;
      const trigger = event.target?.closest?.(LOGIN_TRIGGER_SELECTOR);
      if (!trigger) return;
      if (trigger.hasAttribute?.("data-strzelca-skip-login-modal")) return;
      if (trigger.tagName === "A") {
        const hrefAttr = trigger.getAttribute("href");
        const explicitModal = trigger.hasAttribute("data-open-login-modal");
        if (!explicitModal && !isKontoLoginPageHref(hrefAttr)) return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      openLoginModal();
    },
    false,
  );
}

/** Zapis cookie SSO po zalogowaniu — wynik `ok` musi być przed `ensureFirebaseSSO`, inaczej nastąpi wylogowanie. */
async function syncSsoCookie(auth) {
  const { syncSessionCookieFromFirebaseUser } = await import(SSO_CLIENT_MOD);
  let sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
  if (sync?.status !== "ok") {
    await new Promise((r) => setTimeout(r, 200));
    sync = await syncSessionCookieFromFirebaseUser(auth, { minIntervalMinutes: 0 });
  }
  return sync;
}

async function refreshWidgetAfterLogin(root) {
  const session = await tryGetFirebaseSession();
  if (!session || session.authenticated !== true) return;
  const displayName =
    session?.profile?.displayName ||
    session?.user?.displayName ||
    session?.user?.email?.split("@")[0] ||
    null;
  const avatarUrl = session?.profile?.avatar || null;
  await setupLoggedInState(root, session, { avatarUrl, displayName });
}

async function bindLoginModal(root) {
  ensureLoginModal();
  const modal = document.getElementById("strzelca-login-modal");
  const closeButton = document.getElementById("strzelca-login-close");
  const form = document.getElementById("strzelca-login-form");
  const submitButton = document.getElementById("strzelca-login-submit");
  const googleSplitButton = submitButton?.querySelector(".strzelca-auth-login-google");
  const resetButton = document.getElementById("strzelca-login-reset");
  const emailInput = document.getElementById("strzelca-login-email");
  const passwordInput = document.getElementById("strzelca-login-password");
  if (!modal || !closeButton || !form || !submitButton || !emailInput || !passwordInput) return;

  closeButton.addEventListener("click", closeLoginModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeLoginModal();
  });

  let inFlight = false;
  async function signInGoogle() {
    if (inFlight) return;
    inFlight = true;
    setLoginStatus("Łączenie z Google...");
    try {
      const runtime = await tryGetFirebaseSession();
      const auth = runtime?.runtime?.auth;
      const authMod = runtime?.runtime?.authMod;
      if (!auth || !authMod?.GoogleAuthProvider || typeof authMod.signInWithRedirect !== "function") {
        throw new Error("Brak inicjalizacji Firebase Auth");
      }
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      /* Redirect jak na konto.strzelca.pl — popup bywa blokowany (Safari, COOP, blokady okien). */
      setLoginStatus("Przekierowanie do Google…");
      await authMod.signInWithRedirect(auth, provider);
      return;
    } catch (error) {
      const code = String(error?.code || "");
      if (code === "auth/popup-closed-by-user") {
        setLoginStatus("Logowanie Google zostało przerwane.", true);
      } else if (code === "auth/unauthorized-domain") {
        setLoginStatus(
          "Ta domena nie jest dozwolona w konfiguracji logowania. Skontaktuj się z administratorem.",
          true,
        );
      } else if (code === "auth/operation-not-allowed") {
        setLoginStatus("Logowanie Google jest wyłączone w konfiguracji projektu.", true);
      } else if (code === "auth/network-request-failed") {
        setLoginStatus("Brak połączenia z siecią. Sprawdź internet i spróbuj ponownie.", true);
      } else if (code) {
        setLoginStatus(`Nie udało się zalogować przez Google (${code}). Spróbuj ponownie.`, true);
      } else {
        setLoginStatus("Nie udało się zalogować przez Google. Spróbuj ponownie.", true);
      }
    } finally {
      inFlight = false;
    }
  }

  if (googleSplitButton) {
    googleSplitButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      signInGoogle();
    });
  }
  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      const email = String(emailInput.value || "").trim();
      if (!email) {
        setLoginStatus("Wpisz adres e-mail, aby zresetować hasło.", true);
        emailInput.focus();
        return;
      }
      try {
        const runtime = await tryGetFirebaseSession();
        const auth = runtime?.runtime?.auth;
        const authMod = runtime?.runtime?.authMod;
        if (!auth || !authMod?.sendPasswordResetEmail) {
          throw new Error("Brak inicjalizacji Firebase Auth");
        }
        await authMod.sendPasswordResetEmail(auth, email, {
          url: "https://konto.strzelca.pl/akcja.html?mode=resetPassword",
          handleCodeInApp: true,
        });
        setLoginStatus("Wysłano link resetujący hasło na podany adres e-mail.");
      } catch {
        setLoginStatus("Nie udało się wysłać linku resetującego. Sprawdź adres i spróbuj ponownie.", true);
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inFlight) return;
    inFlight = true;
    submitButton.setAttribute("disabled", "true");
    setLoginStatus("Logowanie...");
    try {
      const runtime = await tryGetFirebaseSession();
      const auth = runtime?.runtime?.auth;
      const authMod = runtime?.runtime?.authMod;
      if (!auth || !authMod?.signInWithEmailAndPassword) {
        throw new Error("Brak inicjalizacji Firebase Auth");
      }
      const credential = await authMod.signInWithEmailAndPassword(
        auth,
        String(emailInput.value || "").trim(),
        String(passwordInput.value || ""),
      );
      if (!credential?.user?.emailVerified) {
        setLoginStatus("Potwierdź e-mail. Otwieram stronę weryfikacji konta.", true);
        window.location.href = "https://konto.strzelca.pl/weryfikacja.html";
        return;
      }
      const syncResult = await syncSsoCookie(auth);
      if (syncResult?.status !== "ok") {
        setLoginStatus(
          "Zalogowano lokalnie, ale nie udało się zapisać sesji na strzelca.pl. Odśwież stronę i spróbuj ponownie.",
          true,
        );
        return;
      }
      await refreshWidgetAfterLogin(root);
      closeLoginModal();
    } catch (error) {
      const code = String(error?.code || "");
      const errMsg = String(error?.message || "");
      let message = "Wystąpił błąd podczas logowania.";
      if (errMsg.includes("Brak inicjalizacji Firebase")) {
        message = "Nie udało się uruchomić logowania. Odśwież stronę lub sprawdź połączenie.";
      } else if (code === "auth/user-not-found") message = "Nie znaleziono konta z tym adresem e-mail.";
      else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        message = "Nieprawidłowy e-mail lub hasło.";
      } else if (code === "auth/invalid-email") message = "Nieprawidłowy adres e-mail.";
      else if (code === "auth/too-many-requests") message = "Za dużo prób logowania. Spróbuj później.";
      else if (code === "auth/user-disabled") message = "To konto zostało wyłączone.";
      else if (code === "auth/network-request-failed") {
        message = "Brak połączenia z siecią. Spróbuj ponownie.";
      } else if (code) message = `Logowanie nie powiodło się (${code}).`;
      setLoginStatus(message, true);
      if (
        code === "auth/user-not-found" ||
        code === "auth/wrong-password" ||
        code === "auth/invalid-credential"
      ) {
        try {
          sessionStorage.setItem(SESSION_SHOW_FORGOT_PASSWORD, "1");
        } catch {}
        applyLoginFooterVisibility();
      }
    } finally {
      inFlight = false;
      submitButton.removeAttribute("disabled");
    }
  });

  applyLoginFooterVisibility();
}

function renderLoggedIn(root, { avatarUrl, displayName, notificationsEnabled }) {
  const letter = firstLetter(displayName);
  const avatar = avatarUrl
    ? `<span class="strzelca-auth-avatar"><img src="${avatarUrl}" alt="Avatar" /></span>`
    : `<span class="strzelca-auth-avatar" aria-hidden="true">${letter}</span>`;

  root.innerHTML = `
    <div class="strzelca-auth-pill strzelca-auth-pill--avatar-only">
      <div class="strzelca-auth-avatar-wrap">
        <button
          id="strzelca-auth-avatar-btn"
          class="strzelca-auth-avatar-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label="Otwórz menu użytkownika"
        >
          ${avatar}
          <span id="strzelca-auth-badge" class="strzelca-auth-badge" hidden>0</span>
        </button>
        <div id="strzelca-auth-menu" class="strzelca-auth-menu" hidden>
          <button
            id="strzelca-auth-open-notifications"
            class="strzelca-auth-menu-item"
            type="button"
            ${notificationsEnabled ? "" : "disabled"}
          >
            <span class="strzelca-auth-menu-item-main">
              <span>Powiadomienia</span>
            </span>
            <span id="strzelca-auth-menu-kicker" class="strzelca-auth-menu-kicker" hidden>0</span>
          </button>
          <a href="${PROFILE_URL}" class="strzelca-auth-menu-link" aria-label="Przejdź do profilu">
            <span class="strzelca-auth-menu-item-main">
              <span>Profil</span>
            </span>
          </a>
          <button id="strzelca-auth-logout" class="strzelca-auth-menu-item" type="button">
            <span class="strzelca-auth-menu-item-main">
              <span>Wyloguj</span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <div id="strzelca-notifications-modal" class="strzelca-auth-modal" hidden>
      <div class="strzelca-auth-modal-card">
        <div class="strzelca-auth-modal-header">
          <div>
            <h2 class="strzelca-auth-modal-title">Powiadomienia</h2>
          </div>
          <button id="strzelca-notifications-close" class="strzelca-auth-modal-close" type="button" aria-label="Zamknij">✕</button>
        </div>
        <div id="strzelca-notifications-modal-body" class="strzelca-auth-modal-body"></div>
      </div>
    </div>

    <div id="strzelca-notifications-all-modal" class="strzelca-auth-modal" hidden>
      <div class="strzelca-auth-modal-card">
        <div class="strzelca-auth-modal-header">
          <div>
            <h2 class="strzelca-auth-modal-title">Wszystkie powiadomienia</h2>
            <p class="strzelca-auth-modal-subtitle">Filtruj po tekście, kategorii i statusie przeczytania.</p>
          </div>
          <button id="strzelca-notifications-all-close" class="strzelca-auth-modal-close" type="button" aria-label="Zamknij">✕</button>
        </div>
        <div class="strzelca-auth-modal-body">
          <div class="strzelca-auth-filters">
            <input id="strzelca-notifications-search" class="strzelca-auth-input" type="search" placeholder="Szukaj w treści lub tytule" />
            <select id="strzelca-notifications-category" class="strzelca-auth-select">
              <option value="all">Wszystkie kategorie</option>
            </select>
            <select id="strzelca-notifications-status" class="strzelca-auth-select">
              <option value="all">Wszystkie statusy</option>
              <option value="unread">Nowe</option>
              <option value="read">Przeczytane</option>
            </select>
          </div>
          <div id="strzelca-notifications-all-body"></div>
        </div>
      </div>
    </div>

    <div id="strzelca-info-modal" class="strzelca-auth-modal" hidden>
      <div class="strzelca-auth-modal-card">
        <div class="strzelca-auth-modal-header">
          <div>
            <h2 id="strzelca-info-title" class="strzelca-auth-modal-title">Informacja</h2>
            <p class="strzelca-auth-modal-subtitle">Ta wiadomość pojawiła się po wejściu na stronę.</p>
          </div>
        </div>
        <div class="strzelca-auth-modal-body">
          <div id="strzelca-info-body" class="strzelca-auth-info-content"></div>
          <div class="strzelca-auth-info-actions">
            <button id="strzelca-info-ack" class="strzelca-auth-primary-btn" type="button">Zrozumiałem</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function ensureAdminFab() {
  if (isAdminPanelPage()) return null;
  let el = document.getElementById("strzelca-admin-fab");
  if (el) return el;
  el = document.createElement("a");
  el.id = "strzelca-admin-fab";
  el.href = "https://strzelca.pl/admin/index.html";
  el.setAttribute("aria-label", "Panel administratora");
  el.title = "Panel administratora";
  el.innerHTML = `<span>⚙</span>`;
  document.body.appendChild(el);
  return el;
}

function isAdminPanelPage() {
  try {
    const host = (window.location?.hostname || "").toLowerCase();
    const path = (window.location?.pathname || "").toLowerCase();
    return host === "strzelca.pl" && (path === "/admin" || path.startsWith("/admin/"));
  } catch {
    return false;
  }
}

function closeUserMenu() {
  const menu = document.getElementById("strzelca-auth-menu");
  const button = document.getElementById("strzelca-auth-avatar-btn");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function renderNotificationCard(item) {
  const safeHref = notificationSafeHref(item.linkUrl);
  const linkLabel = String(item.linkLabel || "").trim() || "Otwórz link";
  const linkAttrs =
    safeHref && safeHref.startsWith("http")
      ? `target="_blank" rel="noopener noreferrer"`
      : "";
  const linkBlock = safeHref
    ? `<a class="strzelca-auth-notification-link" href="${escapeHtml(safeHref)}" ${linkAttrs}>${escapeHtml(linkLabel)}</a>`
    : "";

  return `
    <div class="strzelca-auth-notification-item ${item.isRead ? "" : "is-new"}" data-notification-id="${escapeHtml(item.id)}">
      <div class="strzelca-auth-notification-meta">
        <span class="strzelca-auth-notification-category">${escapeHtml(mapNotificationCategory(item.category))}</span>
        <span>${escapeHtml(formatDate(item.createdAt))}</span>
      </div>
      <div class="strzelca-auth-notification-title">${escapeHtml(item.title || "Powiadomienie")}</div>
      <div class="strzelca-auth-notification-body">${item.bodyHtml || ""}</div>
      ${linkBlock}
    </div>
  `;
}

function renderNotificationGroups(items) {
  if (!items.length) {
    return `<div class="strzelca-auth-empty">Nie masz jeszcze żadnych powiadomień.</div>`;
  }

  const unread = items.filter((item) => !item.isRead);
  const read = items.filter((item) => item.isRead);
  const parts = [];
  if (unread.length) {
    parts.push(unread.map(renderNotificationCard).join(""));
  }
  if (unread.length && read.length) {
    parts.push(`<div class="strzelca-auth-list-divider">Starsze</div>`);
  }
  if (read.length) {
    parts.push(read.map(renderNotificationCard).join(""));
  }
  return `<div class="strzelca-auth-notification-list">${parts.join("")}</div>`;
}

function updateNotificationBadge() {
  const unreadCount = notificationState.notifications.filter((item) => !item.isRead).length;
  const badge = document.getElementById("strzelca-auth-badge");
  const menuBadge = document.getElementById("strzelca-auth-menu-kicker");
  const label = badgeLabel(unreadCount);

  if (badge) {
    badge.hidden = unreadCount < 1;
    badge.textContent = label || "0";
  }
  if (menuBadge) {
    menuBadge.hidden = unreadCount < 1;
    menuBadge.textContent = label || "0";
  }
}

function renderQuickNotificationsModal() {
  const container = document.getElementById("strzelca-notifications-modal-body");
  if (!container) return;
  const latest = notificationState.notifications.slice(0, 10);
  container.innerHTML = `
    ${renderNotificationGroups(latest)}
    <div class="strzelca-auth-notification-footer">
      <button id="strzelca-notifications-show-all" class="strzelca-auth-secondary-btn" type="button">Pokaż wszystkie</button>
    </div>
  `;
  const showAllButton = document.getElementById("strzelca-notifications-show-all");
  if (showAllButton) {
    showAllButton.addEventListener("click", async () => {
      closeModal("strzelca-notifications-modal");
      await openAllNotificationsModal();
    });
  }
}

function renderAllNotificationsModal() {
  const categorySelect = document.getElementById("strzelca-notifications-category");
  const container = document.getElementById("strzelca-notifications-all-body");
  if (!container || !categorySelect) return;

  const list = notificationState.allNotificationsLoaded
    ? notificationState.allNotifications
    : notificationState.notifications;

  const categories = Array.from(new Set(list.map((item) => item.category).filter(Boolean)));
  const currentCategory = categorySelect.value || "all";
  categorySelect.innerHTML = `
    <option value="all">Wszystkie kategorie</option>
    ${categories
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(mapNotificationCategory(category))}</option>`)
      .join("")}
  `;
  categorySelect.value = categories.includes(currentCategory) ? currentCategory : "all";

  const searchValue = String(document.getElementById("strzelca-notifications-search")?.value || "").toLowerCase().trim();
  const statusValue = String(document.getElementById("strzelca-notifications-status")?.value || "all");
  const filtered = list.filter((item) => {
    if (categorySelect.value !== "all" && item.category !== categorySelect.value) return false;
    if (statusValue === "unread" && item.isRead) return false;
    if (statusValue === "read" && !item.isRead) return false;
    if (!searchValue) return true;
    const haystack = `${item.title || ""} ${item.bodyText || ""}`.toLowerCase();
    return haystack.includes(searchValue);
  });

  container.innerHTML = renderNotificationGroups(filtered);
}

function mapNotificationDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    title: String(data.title || ""),
    bodyHtml: String(data.bodyHtml || ""),
    bodyText: String(data.bodyText || ""),
    category: String(data.category || "general"),
    linkUrl: String(data.linkUrl || ""),
    linkLabel: String(data.linkLabel || ""),
    isRead: data.isRead === true,
    createdAt: data.createdAt || null,
  };
}

async function loadAllNotifications(force = false) {
  if (!force && notificationState.allNotificationsLoaded) return;
  if (!notificationState.runtime?.db || !notificationState.user?.uid) return;
  const { collection, query, where, orderBy, getDocs } = notificationState.runtime.fsMod;
  const snap = await getDocs(
    query(
      collection(notificationState.runtime.db, "userNotifications"),
      where("userId", "==", notificationState.user.uid),
      orderBy("createdAt", "desc"),
    ),
  );
  notificationState.allNotifications = snap.docs.map(mapNotificationDoc);
  notificationState.allNotificationsLoaded = true;
  renderAllNotificationsModal();
}

async function markAllNotificationsAsRead() {
  if (!notificationState.runtime?.db || !notificationState.user?.uid || notificationState.markReadInFlight) return;
  notificationState.markReadInFlight = true;

  try {
    const { collection, query, where, limit, getDocs, writeBatch, serverTimestamp } = notificationState.runtime.fsMod;
    while (true) {
      const unreadSnap = await getDocs(
        query(
          collection(notificationState.runtime.db, "userNotifications"),
          where("userId", "==", notificationState.user.uid),
          where("isRead", "==", false),
          limit(250),
        ),
      );
      if (unreadSnap.empty) break;
      const batch = writeBatch(notificationState.runtime.db);
      unreadSnap.docs.forEach((docSnap) => {
        batch.update(docSnap.ref, {
          isRead: true,
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
      if (unreadSnap.size < 250) break;
    }
  } catch (error) {
    console.warn("markAllNotificationsAsRead:", error);
  } finally {
    notificationState.markReadInFlight = false;
  }
}

async function openAllNotificationsModal() {
  await loadAllNotifications();
  renderAllNotificationsModal();
  openModal("strzelca-notifications-all-modal");
  await markAllNotificationsAsRead();
}

async function bindNotifications(root) {
  if (!notificationState.runtime?.db || !notificationState.user?.uid) return;
  const { collection, query, where, orderBy, limit, onSnapshot } = notificationState.runtime.fsMod;

  const notificationsQuery = query(
    collection(notificationState.runtime.db, "userNotifications"),
    where("userId", "==", notificationState.user.uid),
    orderBy("createdAt", "desc"),
    limit(100),
  );

  notificationState.unsubscribeNotifications = onSnapshot(
    notificationsQuery,
    (snapshot) => {
      notificationState.notifications = snapshot.docs.map(mapNotificationDoc);
      notificationState.allNotificationsLoaded = false;
      updateNotificationBadge();
      renderQuickNotificationsModal();
      renderAllNotificationsModal();
    },
    (error) => {
      console.warn("userNotifications snapshot:", error);
    },
  );

  const openButton = document.getElementById("strzelca-auth-open-notifications");
  if (openButton) {
    openButton.addEventListener("click", async () => {
      closeUserMenu();
      renderQuickNotificationsModal();
      openModal("strzelca-notifications-modal");
      await markAllNotificationsAsRead();
    });
  }

  const quickClose = document.getElementById("strzelca-notifications-close");
  if (quickClose) quickClose.addEventListener("click", () => closeModal("strzelca-notifications-modal"));
  const allClose = document.getElementById("strzelca-notifications-all-close");
  if (allClose) allClose.addEventListener("click", () => closeModal("strzelca-notifications-all-modal"));

  ["strzelca-notifications-search", "strzelca-notifications-category", "strzelca-notifications-status"].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener("input", () => renderAllNotificationsModal());
    element.addEventListener("change", () => renderAllNotificationsModal());
  });

  ["strzelca-notifications-modal", "strzelca-notifications-all-modal"].forEach((id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(id);
    });
  });

  renderQuickNotificationsModal();
  await maybeShowInfoAnnouncement();
}

async function maybeShowInfoAnnouncement() {
  if (!notificationState.runtime?.db || !notificationState.user?.uid) return;
  const { collection, query, where, orderBy, limit, getDocs, doc, getDoc, setDoc, serverTimestamp } =
    notificationState.runtime.fsMod;

  const snap = await getDocs(
    query(
      collection(notificationState.runtime.db, "infoAnnouncements"),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
      limit(12),
    ),
  );

  const role = String(notificationState.profile?.role || "user").toLowerCase();
  let nextInfo = null;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (!audienceMatches(data, notificationState.user.uid, role)) continue;
    const ackRef = doc(notificationState.runtime.db, "userInfoAnnouncementAcks", `${notificationState.user.uid}__${docSnap.id}`);
    const ackSnap = await getDoc(ackRef);
    if (!ackSnap.exists()) {
      nextInfo = { id: docSnap.id, ...data, ackRef, setDoc, serverTimestamp };
      break;
    }
  }

  notificationState.activeInfo = nextInfo;
  if (!nextInfo) return;

  const modal = document.getElementById("strzelca-info-modal");
  const title = document.getElementById("strzelca-info-title");
  const body = document.getElementById("strzelca-info-body");
  const button = document.getElementById("strzelca-info-ack");
  if (!modal || !title || !body || !button) return;

  title.textContent = nextInfo.title || "Informacja";
  body.innerHTML = nextInfo.bodyHtml || "";
  modal.hidden = false;

  button.onclick = async () => {
    try {
      await setDoc(
        nextInfo.ackRef,
        {
          announcementId: nextInfo.id,
          userId: notificationState.user.uid,
          acknowledgedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.warn("info acknowledgement:", error);
    }
    modal.hidden = true;
    notificationState.activeInfo = null;
    await maybeShowInfoAnnouncement();
  };
}

function bindAvatarMenu(root) {
  const avatarButton = document.getElementById("strzelca-auth-avatar-btn");
  const menu = document.getElementById("strzelca-auth-menu");
  const logoutButton = document.getElementById("strzelca-auth-logout");

  if (avatarButton && menu) {
    avatarButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextHidden = !menu.hidden;
      menu.hidden = nextHidden;
      avatarButton.setAttribute("aria-expanded", String(!nextHidden));
    });
  }

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) {
      closeUserMenu();
    }
  });

  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      closeUserMenu();
      await logoutCurrentUser();
    });
  }
}

async function logoutCurrentUser() {
  try {
    const { logoutWithSSO } = await import(SSO_CLIENT_MOD);
    await logoutWithSSO(notificationState.runtime?.auth || null);
  } catch {}

  window.location.reload();
}

async function bootstrapMessagesWidget() {
  try {
    if (!window.__strzelcaMessagesWidgetBootstrap) {
      window.__strzelcaMessagesWidgetBootstrap = true;
      import("https://strzelca.pl/messages-widget.mjs?v=2026-03-23-1").catch(() => {});
    }
  } catch {}
}

async function setupLoggedInState(root, session, { avatarUrl, displayName }) {
  notificationState.runtime = session.runtime || null;
  notificationState.user = session.user || null;
  notificationState.profile = session.profile || null;

  renderLoggedIn(root, {
    avatarUrl,
    displayName,
    notificationsEnabled: !!(session.runtime?.db && session.user?.uid),
  });
  bindAvatarMenu(root);
  await bootstrapMessagesWidget();

  try {
    const fab = ensureAdminFab();
    if (!fab) {
      // no-op on admin panel
    } else if (isAdminRole(session?.profile?.role)) {
      fab.style.display = "inline-flex";
    } else {
      fab.style.display = "none";
    }
  } catch {}

  if (session.runtime?.db && session.user?.uid) {
    await bindNotifications(root);
  }
}

async function fetchMeWithTimeout(ms = 4500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(API_URL, {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    return await res.json().catch(() => null);
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  ensureStyles();
  hideLegacyAuthUiIfPresent();
  bindGlobalLoginTriggers();

  const root = document.createElement("div");
  root.id = "strzelca-auth-widget";
  document.body.appendChild(root);

  renderLoading(root);
  await bindLoginModal(root);

  try {
    const firebase = await tryGetFirebaseSession();
    flushOAuthRedirectErrorToModal();
    if (firebase && firebase.authenticated === true) {
      const displayName =
        firebase?.profile?.displayName ||
        firebase?.user?.displayName ||
        firebase?.user?.email?.split("@")[0] ||
        null;
      const avatarUrl = firebase?.profile?.avatar || null;
      await setupLoggedInState(root, firebase, { avatarUrl, displayName });
      return;
    }

    if (firebase && firebase.authenticated === false) {
      renderLoggedOut(root);
      try {
        const fab = ensureAdminFab();
        if (fab) fab.style.display = "none";
      } catch {}
      return;
    }

    const data = await fetchMeWithTimeout();
    if (data && data.success === true && data.authenticated === true) {
      await setupLoggedInState(
        root,
        {
          runtime: null,
          user: null,
          profile: data?.profile || null,
        },
        {
          avatarUrl: data?.profile?.avatar || null,
          displayName: data?.profile?.displayName || null,
        },
      );
      try {
        const fab = ensureAdminFab();
        if (!fab) {
          // no-op
        } else if (data?.isAdmin === true) {
          fab.style.display = "inline-flex";
        } else {
          fab.style.display = "none";
        }
      } catch {}
      return;
    }

    renderLoggedOut(root);
    try {
      const fab = ensureAdminFab();
      if (fab) fab.style.display = "none";
    } catch {}
  } catch {
    renderLoggedOut(root);
    try {
      const fab = ensureAdminFab();
      if (fab) fab.style.display = "none";
    } catch {}
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
