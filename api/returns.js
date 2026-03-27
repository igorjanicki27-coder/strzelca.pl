const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require("./_sso-utils");
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require("./_moderation");

const SUPERADMIN_UID = "nCMUz2fc8MM9WhhMVBLZ1pdR7O43";
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ATTACHMENT_BYTES = 720 * 1024;
const MAX_ATTACHMENTS_PER_EVENT = 5;
const MAX_EVENTS_WITH_ATTACHMENTS = 5;
const RETURNS_TEMPLATE_PREFIX = "return_claim_";
const STATUS = {
  GENERATED: "wygenerowany",
  SUBMITTED: "zlozono",
  IN_PROGRESS: "w_trakcie_realizacji",
  PROPOSED: "zaproponowano_rozwiazanie",
  PROPOSAL_ACCEPTED: "propozycja_zaakceptowana",
  PROPOSAL_REJECTED: "propozycja_odrzucona",
  WAITING_FOR_RETURN: "oczekiwanie_na_zwrot",
  POSITIVE: "rozpatrzono_pozytywnie",
  NEGATIVE: "rozpatrzono_negatywnie",
  CANCELLED_BY_ADMIN: "anulowano_przez_administratora",
  CANCELLED_BY_CLIENT: "anulowano_przez_klienta",
};
const FINAL_STATUSES = new Set([
  STATUS.POSITIVE,
  STATUS.NEGATIVE,
  STATUS.CANCELLED_BY_ADMIN,
  STATUS.CANCELLED_BY_CLIENT,
]);
const USER_EDITABLE_STATUSES = new Set([STATUS.SUBMITTED]);
const GUEST_ALLOWED_STATUSES = new Set([
  STATUS.GENERATED,
  STATUS.PROPOSED,
  STATUS.POSITIVE,
  STATUS.NEGATIVE,
  STATUS.CANCELLED_BY_ADMIN,
  STATUS.CANCELLED_BY_CLIENT,
]);

function getInternalApiBaseUrl() {
  const raw = String(process.env.INTERNAL_API_BASE_URL || process.env.VERCEL_URL || "").trim();
  if (!raw) return "http://localhost:3000";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `https://${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function safeTrim(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function decodeMaybeB64(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return raw;
  }
}

function stripBase64Payload(input) {
  const s = String(input || "").trim();
  const m = s.match(/^data:([a-z0-9.+/=-]+);base64,(.*)$/i);
  return (m ? m[2] : s).replace(/\s/g, "");
}

function verifyImageMagicBytes(buf, mimeType) {
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
    return buf.toString("utf8", 0, 4) === "RIFF" && buf.toString("utf8", 8, 12) === "WEBP";
  }
  return false;
}

function normalizeImageAttachment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mimeType = safeTrim(raw.mimeType || raw.mimetype, 40).toLowerCase();
  const dataBase64 = stripBase64Payload(raw.dataBase64 || raw.data);
  if (!mimeType || !dataBase64) return null;
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error("Dozwolone sa tylko obrazy JPEG, PNG lub WebP.");
  }
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("Zdjecie jest zbyt duze po kompresji.");
  }
  if (!verifyImageMagicBytes(buf, mimeType)) {
    throw new Error("Plik nie zostal rozpoznany jako bezpieczny obraz.");
  }
  return {
    mimeType,
    dataBase64: buf.toString("base64"),
  };
}

function normalizeAttachments(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  if (rawItems.length > MAX_ATTACHMENTS_PER_EVENT) {
    throw new Error(`Mozna dodac maksymalnie ${MAX_ATTACHMENTS_PER_EVENT} zdjec.`);
  }
  return rawItems
    .map((item) => normalizeImageAttachment(item))
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENTS_PER_EVENT);
}

function normalizeEmail(email) {
  const value = safeTrim(email, 320).toLowerCase();
  if (!value) return "";
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(value)) throw new Error("Podaj prawidlowy adres e-mail.");
  return value;
}

function normalizePhone(phone) {
  const raw = safeTrim(phone, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) {
    throw new Error("Podaj prawidlowy numer telefonu.");
  }
  return raw;
}

function ibanLetterValue(ch) {
  return String(ch).toUpperCase().charCodeAt(0) - 55;
}

function validateIbanChecksum(input) {
  const normalized = input.replace(/\s+/g, "").toUpperCase();
  const moved = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const part = /[A-Z]/.test(ch) ? String(ibanLetterValue(ch)) : ch;
    for (const digit of part) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function normalizeBankAccount(value) {
  const raw = safeTrim(value, 64).replace(/\s+/g, "").toUpperCase();
  if (!raw) throw new Error("Numer konta jest wymagany.");
  if (/^\d{26}$/.test(raw)) {
    const iban = `PL${raw}`;
    if (!validateIbanChecksum(iban)) {
      throw new Error("Podaj prawidlowy polski numer konta.");
    }
    return { iban, local: raw };
  }
  if (/^PL\d{26}$/.test(raw)) {
    if (!validateIbanChecksum(raw)) {
      throw new Error("Podaj prawidlowy numer konta w formacie IBAN.");
    }
    return { iban: raw, local: raw.slice(2) };
  }
  throw new Error("Podaj polski numer konta (26 cyfr) lub IBAN zaczynajacy sie od PL.");
}

function formatBankAccountGroups(localDigits) {
  return String(localDigits || "")
    .replace(/\D/g, "")
    .match(/.{1,4}/g)
    ?.join(" ") || "";
}

function normalizeAddress(address) {
  const out = {
    street: safeTrim(address?.street, 160),
    buildingNumber: safeTrim(address?.buildingNumber, 40),
    apartmentNumber: safeTrim(address?.apartmentNumber, 40),
    postalCode: safeTrim(address?.postalCode, 20),
    city: safeTrim(address?.city, 120),
  };
  if (!out.street || !out.buildingNumber || !out.postalCode || !out.city) {
    throw new Error("Uzupelnij pelny adres.");
  }
  if (!/^\d{2}-\d{3}$/.test(out.postalCode)) {
    throw new Error("Kod pocztowy musi byc w formacie 00-000.");
  }
  return out;
}

function getStatusMeta(status, verified) {
  const map = {
    [STATUS.GENERATED]: {
      label: "Wygenerowano",
      color: "text-zinc-300 bg-zinc-300/10 border-zinc-300/30",
      group: "Zlozono",
      closed: false,
    },
    [STATUS.SUBMITTED]: {
      label: "Zlozono",
      color: "text-amber-300 bg-amber-400/10 border-amber-400/30",
      group: "Zlozono",
      closed: false,
    },
    [STATUS.IN_PROGRESS]: {
      label: "W trakcie realizacji",
      color: "text-orange-300 bg-orange-400/10 border-orange-400/30",
      group: "W trakcie realizacji",
      closed: false,
    },
    [STATUS.PROPOSED]: {
      label: "Zaproponowano rozwiazanie",
      color: "text-sky-300 bg-sky-400/10 border-sky-400/30",
      group: "Zaproponowano rozwiazanie",
      closed: false,
    },
    [STATUS.PROPOSAL_ACCEPTED]: {
      label: "Propozycja zaakceptowana",
      color: "text-green-300 bg-green-400/10 border-green-400/30",
      group: "Zaproponowano rozwiazanie",
      closed: false,
    },
    [STATUS.PROPOSAL_REJECTED]: {
      label: "Propozycja odrzucona",
      color: "text-red-300 bg-red-400/10 border-red-400/30",
      group: "Zaproponowano rozwiazanie",
      closed: false,
    },
    [STATUS.WAITING_FOR_RETURN]: {
      label: "Oczekiwanie na zwrot",
      color: "text-violet-300 bg-violet-400/10 border-violet-400/30",
      group: "Oczekiwanie na zwrot",
      closed: false,
    },
    [STATUS.POSITIVE]: {
      label: "Rozpatrzono pozytywnie",
      color: "text-green-300 bg-green-500/10 border-green-500/30",
      group: "Zakonczono",
      closed: true,
    },
    [STATUS.NEGATIVE]: {
      label: "Rozpatrzono negatywnie",
      color: "text-red-300 bg-red-500/10 border-red-500/30",
      group: "Zakonczono",
      closed: true,
    },
    [STATUS.CANCELLED_BY_ADMIN]: {
      label: "Anulowano przez administratora",
      color: "text-red-300 bg-red-500/10 border-red-500/60",
      group: "Anulowano",
      closed: true,
    },
    [STATUS.CANCELLED_BY_CLIENT]: {
      label: "Anulowano przez klienta",
      color: "text-red-300 bg-red-500/10 border-red-500/60",
      group: "Anulowano",
      closed: true,
    },
  };
  const meta = map[status] || {
    label: status,
    color: "text-zinc-300 bg-zinc-300/10 border-zinc-300/30",
    group: "Inne",
    closed: false,
  };
  return {
    ...meta,
    verificationLabel: verified ? "Zweryfikowany" : "Niezweryfikowany",
    verificationBorder: verified ? "border-coyote/50" : "border-sky-500/60",
  };
}

function formatDate(dateValue) {
  if (!dateValue) return "";
  const d = dateValue.toDate ? dateValue.toDate() : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

async function isAdmin(uid) {
  if (!uid) return false;
  const profile = await getUserRoleProfile(admin.firestore(), uid);
  return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, "shop");
}

async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await admin.firestore().collection("userProfiles").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

async function generateReturnClaimNumber(db) {
  const year = new Date().getFullYear();
  const counterRef = db.collection("systemCounters").doc(`returnsClaims-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.value || 0) : 0;
    const value = current + 1;
    tx.set(
      counterRef,
      {
        value,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return value;
  });
  return `ZR-${year}-${String(next).padStart(5, "0")}`;
}

function replaceTemplateVariables(template, variables) {
  let result = String(template || "");
  for (const [key, value] of Object.entries(variables || {})) {
    const ifRegex = new RegExp(`{{\\s*#if\\s+${key}\\s*}}([\\s\\S]*?){{\\s*/if\\s*}}`, "g");
    result = result.replace(ifRegex, value ? "$1" : "");
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), String(value ?? ""));
  }
  result = result.replace(/{{\s*#if\s+[a-zA-Z0-9_]+\s*}}([\s\S]*?){{\s*\/if\s*}}/g, "");
  return result;
}

function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendReturnClaimEmail(claim, eventEntry) {
  const recipient = normalizeEmail(claim.email || "");
  if (!recipient) return;
  const db = admin.firestore();
  const templateId = `${RETURNS_TEMPLATE_PREFIX}${eventEntry.emailTemplateKey || eventEntry.status}`;
  let template = null;
  try {
    const snap = await db.collection("emailTemplates").doc(templateId).get();
    if (snap.exists) template = snap.data();
  } catch (error) {
    console.warn("sendReturnClaimEmail template:", error);
  }
  if (!template) return;

  const variables = {
    claimNumber: claim.claimNumber || "",
    claimType: claim.typeLabel || claim.type || "",
    statusLabel: eventEntry.statusLabel || "",
    statusDescription: eventEntry.statusDescription || "",
    firstName: claim.firstName || "",
    lastName: claim.lastName || "",
    orderNumber: claim.orderNumber || "",
    invoiceNumber: claim.invoiceNumber || "",
    email: claim.email || "",
    phone: claim.phone || "",
    accountNumber: claim.bankAccountFormatted || "",
    solutionText: eventEntry.solutionText || "",
    justification: eventEntry.justification || "",
    refundMethod: eventEntry.refundMethod || "",
    refundExtra: eventEntry.refundExtra || "",
    userResponseReason: eventEntry.userResponseReason || "",
    userResponseExpectations: eventEntry.userResponseExpectations || "",
    adminComment: eventEntry.comment || "",
    supportEmail: "kontakt@strzelca.pl",
    dashboardUrl: claim.userId ? "https://konto.strzelca.pl/profil.html" : "https://dokumenty.strzelca.pl",
    verificationLabel: claim.verified ? "zweryfikowane" : "niezweryfikowane",
  };

  const subject = replaceTemplateVariables(template.subject || "", variables);
  const html = replaceTemplateVariables(template.html || "", variables);
  if (!subject || !html) return;

  try {
    const response = await fetch(`${getInternalApiBaseUrl()}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipient,
        subject,
        html,
        attachments: [],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("sendReturnClaimEmail:", error);
    try {
      const { logEmailDeliveryFailure } = require("./_activity-email-log");
      await logEmailDeliveryFailure({
        category: "return_claim_notification",
        to: recipient,
        subject,
        errorMessage: error.message || String(error),
        meta: {
          claimNumber: String(claim.claimNumber || ""),
          templateId,
          status: String(eventEntry.status || ""),
        },
      });
    } catch (logError) {
      console.error("sendReturnClaimEmail log:", logError);
    }
  }
}

function getReturnClaimAdminNotificationRecipients() {
  const raw = String(
    process.env.RETURNS_ADMIN_NOTIFICATION_EMAIL ||
      process.env.ADMIN_NOTIFICATION_EMAIL ||
      "kontakt@strzelca.pl",
  ).trim();
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

async function sendReturnClaimAdminNotification(claim, eventEntry) {
  const recipients = getReturnClaimAdminNotificationRecipients();
  if (!recipients.length) return;

  const safeRecipients = recipients.filter((email) => {
    try {
      return !!normalizeEmail(email);
    } catch {
      return false;
    }
  });
  if (!safeRecipients.length) return;

  const verificationLabel = claim.verified ? "zweryfikowane" : "niezweryfikowane";
  const statusLabel = eventEntry?.statusLabel || claim.statusLabel || "";
  const subject = `[Zwrot/Reklamacja] ${claim.claimNumber || "Nowe zgłoszenie"} • ${claim.typeLabel || claim.type || ""} • ${verificationLabel}`;
  const html = `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #c19a6b;">Nowe zgłoszenie zwrotu / reklamacji</h2>
  <p>W systemie pojawiło się nowe zgłoszenie.</p>
  <ul>
    <li><strong>Numer formularza:</strong> ${escapeHtmlText(claim.claimNumber || "")}</li>
    <li><strong>Typ:</strong> ${escapeHtmlText(claim.typeLabel || claim.type || "")}</li>
    <li><strong>Status:</strong> ${escapeHtmlText(statusLabel)}</li>
    <li><strong>Weryfikacja:</strong> ${escapeHtmlText(verificationLabel)}</li>
    <li><strong>Klient:</strong> ${escapeHtmlText(`${claim.firstName || ""} ${claim.lastName || ""}`.trim())}</li>
    <li><strong>E-mail:</strong> ${escapeHtmlText(claim.email || "")}</li>
    <li><strong>Telefon:</strong> ${escapeHtmlText(claim.phone || "")}</li>
    <li><strong>Numer zamówienia:</strong> ${escapeHtmlText(claim.orderNumber || "")}</li>
    <li><strong>Numer faktury:</strong> ${escapeHtmlText(claim.invoiceNumber || "")}</li>
    <li><strong>Żądanie:</strong> ${escapeHtmlText(claim.requestKind || "")}</li>
  </ul>
  ${claim.defectDescription ? `<p><strong>Opis wady:</strong><br />${escapeHtmlText(claim.defectDescription).replace(/\n/g, "<br />")}</p>` : ""}
  ${claim.returnReason ? `<p><strong>Powód zwrotu:</strong><br />${escapeHtmlText(claim.returnReason).replace(/\n/g, "<br />")}</p>` : ""}
  ${claim.additionalInfo ? `<p><strong>Dodatkowe informacje:</strong><br />${escapeHtmlText(claim.additionalInfo).replace(/\n/g, "<br />")}</p>` : ""}
  <p><a href="https://strzelca.pl/admin/" style="color: #c19a6b;">Otwórz panel admina</a></p>
</body>
</html>`;

  try {
    const response = await fetch(`${getInternalApiBaseUrl()}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: safeRecipients.join(","),
        subject,
        html,
        attachments: [],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("sendReturnClaimAdminNotification:", error);
    try {
      const { logEmailDeliveryFailure } = require("./_activity-email-log");
      await logEmailDeliveryFailure({
        category: "return_claim_admin_notification",
        to: safeRecipients.join(","),
        subject,
        errorMessage: error.message || String(error),
        meta: {
          claimNumber: String(claim.claimNumber || ""),
          status: String(eventEntry?.status || ""),
        },
      });
    } catch (logError) {
      console.error("sendReturnClaimAdminNotification log:", logError);
    }
  }
}

async function logActivity(action, details, userId, req, targetUserId = null) {
  const doc = {
    action,
    userId: userId || "system",
    details: details || {},
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    userAgent: safeTrim(req.headers["user-agent"] || "", 500),
  };
  if (targetUserId) doc.targetUserId = targetUserId;
  await admin.firestore().collection("activityLogs").add(doc);
}

function sanitizeClaimForList(docSnap) {
  const data = docSnap.data() || {};
  const meta = getStatusMeta(data.status, data.verified !== false);
  return {
    id: docSnap.id,
    claimNumber: data.claimNumber || "",
    type: data.type || "",
    typeLabel: data.typeLabel || "",
    verified: data.verified !== false,
    status: data.status || "",
    statusLabel: meta.label,
    statusColor: meta.color,
    statusGroup: meta.group,
    statusClosed: meta.closed,
    verificationLabel: meta.verificationLabel,
    verificationBorder: meta.verificationBorder,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    email: data.email || "",
    phone: data.phone || "",
    orderNumber: data.orderNumber || "",
    invoiceNumber: data.invoiceNumber || "",
    requestKind: data.requestKind || "",
    proposalSummary: data.proposalSummary || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    createdAtFormatted: formatDate(data.createdAt),
    updatedAtFormatted: formatDate(data.updatedAt),
    stale: false,
    userId: data.userId || null,
  };
}

async function buildClaimDetail(docSnap) {
  const base = sanitizeClaimForList(docSnap);
  const data = docSnap.data() || {};
  const [eventsSnap, attachmentsSnap] = await Promise.all([
    docSnap.ref.collection("events").orderBy("createdAt", "asc").get(),
    docSnap.ref.collection("attachments").orderBy("createdAt", "asc").get(),
  ]);
  const attachmentsByEvent = new Map();
  attachmentsSnap.forEach((attDoc) => {
    const att = attDoc.data() || {};
    const eventId = String(att.eventId || "");
    if (!attachmentsByEvent.has(eventId)) attachmentsByEvent.set(eventId, []);
    attachmentsByEvent.get(eventId).push({
      id: attDoc.id,
      fileName: att.fileName || "",
      label: att.label || "",
      mimeType: att.mimeType || "",
      dataBase64: att.dataBase64 || "",
      createdAtFormatted: formatDate(att.createdAt),
      actorRole: att.actorRole || "",
    });
  });
  const events = eventsSnap.docs.map((eventDoc) => {
    const event = eventDoc.data() || {};
    return {
      id: eventDoc.id,
      type: event.type || "",
      status: event.status || "",
      statusLabel: event.statusLabel || "",
      actorRole: event.actorRole || "",
      actorName: event.actorName || "",
      comment: event.comment || "",
      justification: event.justification || "",
      solutionText: event.solutionText || "",
      refundMethod: event.refundMethod || "",
      refundExtra: event.refundExtra || "",
      userResponseReason: event.userResponseReason || "",
      userResponseExpectations: event.userResponseExpectations || "",
      createdAt: event.createdAt || null,
      createdAtFormatted: formatDate(event.createdAt),
      attachments: attachmentsByEvent.get(eventDoc.id) || [],
    };
  });
  return {
    ...base,
    emailLocked: !!data.emailLocked,
    address: data.address || {},
    bankAccountFormatted: data.bankAccountFormatted || "",
    bankAccountIban: data.bankAccountIban || "",
    defectDescription: data.defectDescription || "",
    returnReason: data.returnReason || "",
    additionalInfo: data.additionalInfo || "",
    profileSnapshot: data.profileSnapshot || null,
    requestKind: data.requestKind || "",
    requestDetails: data.requestDetails || {},
    events,
  };
}

function canUserSeeClaim(claim, sessionUser) {
  return !!(sessionUser && claim.userId && claim.userId === sessionUser.uid);
}

function canUserEditClaim(claim, sessionUser) {
  return !!(
    canUserSeeClaim(claim, sessionUser) &&
    USER_EDITABLE_STATUSES.has(claim.status) &&
    claim.verified !== false
  );
}

async function appendEventWithAttachments(claimRef, eventData, attachments) {
  const eventRef = claimRef.collection("events").doc();
  await eventRef.set({
    ...eventData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  for (let i = 0; i < attachments.length; i += 1) {
    const item = attachments[i];
    await claimRef.collection("attachments").add({
      eventId: eventRef.id,
      fileName: item.fileName || `zalacznik-${i + 1}.jpg`,
      label: item.label || "",
      mimeType: item.mimeType,
      dataBase64: item.dataBase64,
      actorRole: eventData.actorRole || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return eventRef.id;
}

async function enrichFromProfile(uid, baseEmail) {
  const profile = await getUserProfile(uid);
  if (!profile) {
    return {
      email: normalizeEmail(baseEmail || ""),
      profileSnapshot: null,
      autofill: {},
    };
  }
  const autofill = {
    firstName: safeTrim(profile.firstName, 120),
    lastName: safeTrim(profile.lastName, 120),
    phone: decodeMaybeB64(profile.phone),
    address: {
      street: decodeMaybeB64(profile.address?.street),
      buildingNumber: decodeMaybeB64(profile.address?.buildingNumber),
      apartmentNumber: decodeMaybeB64(profile.address?.apartmentNumber),
      postalCode: decodeMaybeB64(profile.address?.postalCode),
      city: decodeMaybeB64(profile.address?.city),
    },
    displayName: safeTrim(profile.displayName, 160),
  };
  return {
    email: normalizeEmail(baseEmail || profile.email || ""),
    profileSnapshot: autofill,
    autofill,
  };
}

function assertStatusAllowedForAdmin(status, verified) {
  const allowed = verified
    ? new Set([
        STATUS.SUBMITTED,
        STATUS.IN_PROGRESS,
        STATUS.PROPOSED,
        STATUS.PROPOSAL_ACCEPTED,
        STATUS.PROPOSAL_REJECTED,
        STATUS.WAITING_FOR_RETURN,
        STATUS.POSITIVE,
        STATUS.NEGATIVE,
        STATUS.CANCELLED_BY_ADMIN,
        STATUS.CANCELLED_BY_CLIENT,
      ])
    : GUEST_ALLOWED_STATUSES;
  if (!allowed.has(status)) {
    throw new Error("Ten status nie jest dostepny dla tego typu formularza.");
  }
}

function buildAdminStatusDescription(status, extra) {
  if (status === STATUS.PROPOSED) return extra.solutionText || "";
  if (status === STATUS.POSITIVE) return extra.justification || "";
  if (status === STATUS.NEGATIVE) return extra.justification || "";
  if (status === STATUS.PROPOSAL_REJECTED) {
    return [extra.userResponseReason, extra.userResponseExpectations].filter(Boolean).join(" | ");
  }
  if (status === STATUS.PROPOSAL_ACCEPTED) return extra.comment || "";
  if (status === STATUS.CANCELLED_BY_ADMIN || status === STATUS.CANCELLED_BY_CLIENT) return extra.comment || "";
  return extra.comment || "";
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: "GET,POST,PUT,DELETE,OPTIONS" });
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    initAdmin();
    const db = admin.firestore();
    const sessionUser = await getSessionUser(req).catch(() => null);
    const adminMode = sessionUser ? await isAdmin(sessionUser.uid).catch(() => false) : false;
    const query = req.query && typeof req.query === "object" ? req.query : {};

    if (req.method === "GET") {
      const claimId = safeTrim(query.id, 120);
      if (claimId) {
        if (!sessionUser) {
          res.status(401).json({ success: false, error: "Unauthorized" });
          return;
        }
        const snap = await db.collection("returnsClaims").doc(claimId).get();
        if (!snap.exists) {
          res.status(404).json({ success: false, error: "Nie znaleziono zgłoszenia." });
          return;
        }
        const claim = snap.data() || {};
        if (!adminMode && !canUserSeeClaim(claim, sessionUser)) {
          res.status(403).json({ success: false, error: "Brak dostepu do zgloszenia." });
          return;
        }
        const detail = await buildClaimDetail(snap);
        res.status(200).json({ success: true, data: detail });
        return;
      }

      if (!sessionUser) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }

      const summary = String(query.summary || "") === "1";
      const statusFilter = safeTrim(query.status, 80);
      const verificationFilter = safeTrim(query.verification, 20);
      const includeClosed = String(query.includeClosed || "") === "1";
      const userIdFilter = safeTrim(query.userId, 120);

      let ref = db.collection("returnsClaims");
      if (!adminMode) {
        ref = ref.where("userId", "==", sessionUser.uid);
      } else if (userIdFilter) {
        ref = ref.where("userId", "==", userIdFilter);
      }
      const snap = await ref.get();
      let items = snap.docs.map((docSnap) => sanitizeClaimForList(docSnap));
      if (statusFilter && statusFilter !== "all") {
        items = items.filter((item) => item.status === statusFilter);
      }
      if (verificationFilter === "verified") {
        items = items.filter((item) => item.verified);
      } else if (verificationFilter === "unverified") {
        items = items.filter((item) => !item.verified);
      }
      if (!includeClosed) {
        items = items.filter((item) => !item.statusClosed);
      }
      const now = Date.now();
      items = items
        .map((item) => {
          const updatedAtMs = item.updatedAt?.seconds ? item.updatedAt.seconds * 1000 : 0;
          return {
            ...item,
            stale: !item.statusClosed && updatedAtMs > 0 && now - updatedAtMs > 7 * 24 * 60 * 60 * 1000,
          };
        })
        .sort((a, b) => {
          const bt = b.updatedAt?.seconds ? b.updatedAt.seconds * 1000 : 0;
          const at = a.updatedAt?.seconds ? a.updatedAt.seconds * 1000 : 0;
          return bt - at;
        });

      if (summary) {
        const counts = {};
        for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
        res.status(200).json({ success: true, data: { counts, total: items.length } });
        return;
      }

      res.status(200).json({ success: true, data: items });
      return;
    }

    if (req.method === "POST") {
      const body = readJsonBody(req) || {};
      const isManualAdminCreate = !!body.manualAdminCreate;
      if (isManualAdminCreate && !adminMode) {
        res.status(403).json({ success: false, error: "Tylko administrator moze dodac formularz recznie." });
        return;
      }

      const manualOwnerUserId = isManualAdminCreate ? safeTrim(body.userId, 160) : "";
      const userId = isManualAdminCreate
        ? (manualOwnerUserId || null)
        : (sessionUser?.uid || null);
      const verified = isManualAdminCreate
        ? (body.verified !== undefined ? !!body.verified : !!userId)
        : !!userId;
      const type = safeTrim(body.type, 32).toLowerCase();
      if (type !== "zwrot" && type !== "reklamacja") {
        throw new Error("Wybierz typ zgloszenia.");
      }

      const profileData = userId ? await enrichFromProfile(userId, body.email || sessionUser?.email) : {
        email: normalizeEmail(body.email),
        profileSnapshot: null,
        autofill: {},
      };
      const firstName = safeTrim(body.firstName || profileData.autofill?.firstName, 120);
      const lastName = safeTrim(body.lastName || profileData.autofill?.lastName, 120);
      const email = normalizeEmail(profileData.email || body.email);
      const phone = normalizePhone(body.phone || profileData.autofill?.phone);
      const address = normalizeAddress({
        street: body.street || body.address?.street || profileData.autofill?.address?.street,
        buildingNumber: body.buildingNumber || body.address?.buildingNumber || profileData.autofill?.address?.buildingNumber,
        apartmentNumber: body.apartmentNumber || body.address?.apartmentNumber || profileData.autofill?.address?.apartmentNumber,
        postalCode: body.postalCode || body.address?.postalCode || profileData.autofill?.address?.postalCode,
        city: body.city || body.address?.city || profileData.autofill?.address?.city,
      });
      const bank = normalizeBankAccount(body.bankAccount || body.bankAccountIban || "");
      const orderNumber = safeTrim(body.orderNumber || body.zamowienie, 160);
      const invoiceNumber = safeTrim(body.invoiceNumber || body.faktura, 160);
      const defectDescription = safeTrim(body.defectDescription || body.opis, 12000);
      const returnReason = safeTrim(body.returnReason || body.powod, 8000);
      const additionalInfo = safeTrim(body.additionalInfo || body.dodatkowe, 8000);
      const requestKind = safeTrim(body.requestKind || body.zadanie, 160);
      if (!orderNumber) throw new Error("Numer zamowienia jest wymagany.");
      if (!invoiceNumber) throw new Error("Numer faktury lub rachunku jest wymagany.");
      if (!requestKind) throw new Error("Uzupelnij zadanie.");
      if (type === "reklamacja" && !defectDescription) throw new Error("Opis wady jest wymagany.");
      if (type === "zwrot" && !returnReason) throw new Error("Powod zwrotu jest wymagany.");

      const requestDetails = {
        value: safeTrim(body.requestValue || "", 120),
        voucherCode: safeTrim(body.voucherCode || "", 120),
        refundMethodOther: safeTrim(body.refundMethodOther || "", 160),
      };

      const attachments = normalizeAttachments(body.images || body.attachments || []);
      const claimNumber = await generateReturnClaimNumber(db);
      const initialStatus = verified ? STATUS.SUBMITTED : STATUS.GENERATED;
      const claimRef = db.collection("returnsClaims").doc();
      const nowTs = admin.firestore.FieldValue.serverTimestamp();
      const typeLabel = type === "zwrot" ? "Zwrot" : "Reklamacja";
      const statusMeta = getStatusMeta(initialStatus, verified);
      const baseData = {
        claimNumber,
        type,
        typeLabel,
        verified,
        emailLocked: !!verified,
        userId,
        status: initialStatus,
        statusLabel: statusMeta.label,
        requestKind,
        requestDetails,
        firstName,
        lastName,
        email,
        phone,
        address,
        bankAccountIban: bank.iban,
        bankAccountFormatted: formatBankAccountGroups(bank.local),
        orderNumber,
        invoiceNumber,
        defectDescription,
        returnReason,
        additionalInfo,
        createdAt: nowTs,
        updatedAt: nowTs,
        profileSnapshot: profileData.profileSnapshot,
        createdByRole: adminMode && isManualAdminCreate ? "admin" : verified ? "user" : "guest",
        latestEventType: "created",
        latestEventAt: nowTs,
        latestComment: "",
      };
      await claimRef.set(baseData);

      const actorName = safeTrim(
        body.actorName ||
          (adminMode && isManualAdminCreate ? "Administrator" : "") ||
          profileData.autofill?.displayName ||
          sessionUser?.email ||
          "Uzytkownik",
        160,
      );
      const eventPayload = {
        type: "created",
        status: initialStatus,
        statusLabel: statusMeta.label,
        statusDescription: verified ? "Formularz zostal przeslany." : "Formularz zostal zapisany jako niezweryfikowany.",
        actorRole: adminMode && isManualAdminCreate ? "admin" : verified ? "user" : "guest",
        actorName,
        actorUid: userId,
        comment: safeTrim(body.comment || "", 4000),
        emailTemplateKey: verified ? "created_verified" : "created_unverified",
      };
      await appendEventWithAttachments(claimRef, eventPayload, attachments.map((item, index) => ({
        ...item,
        fileName: `formularz-${index + 1}.jpg`,
        label: "Zdjecie od klienta",
      })));

      await logActivity(
        verified ? "RETURN_CLAIM_CREATED" : "RETURN_CLAIM_GENERATED_GUEST",
        {
          claimNumber,
          type,
          verified,
          status: initialStatus,
          orderNumber,
        },
        userId || "guest",
        req,
        userId || null,
      );

      const savedSnap = await claimRef.get();
      const detail = await buildClaimDetail(savedSnap);
      void sendReturnClaimEmail(
        {
          ...savedSnap.data(),
          claimNumber,
          email,
          typeLabel,
        },
        eventPayload,
      ).catch(() => {});
      if (!isManualAdminCreate) {
        void sendReturnClaimAdminNotification(
          {
            ...savedSnap.data(),
            claimNumber,
            email,
            typeLabel,
            firstName,
            lastName,
            phone,
            orderNumber,
            invoiceNumber,
            requestKind,
            defectDescription,
            returnReason,
            additionalInfo,
          },
          eventPayload,
        ).catch(() => {});
      }
      res.status(201).json({ success: true, data: detail });
      return;
    }

    if (req.method === "PUT") {
      if (!sessionUser) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      const body = readJsonBody(req) || {};
      const claimId = safeTrim(body.id, 120);
      if (!claimId) {
        res.status(400).json({ success: false, error: "Brak identyfikatora zgloszenia." });
        return;
      }
      const claimRef = db.collection("returnsClaims").doc(claimId);
      const claimSnap = await claimRef.get();
      if (!claimSnap.exists) {
        res.status(404).json({ success: false, error: "Nie znaleziono zgłoszenia." });
        return;
      }
      const claim = claimSnap.data() || {};
      if (!adminMode && !canUserSeeClaim(claim, sessionUser)) {
        res.status(403).json({ success: false, error: "Brak dostepu." });
        return;
      }

      const attachments = normalizeAttachments(body.images || body.attachments || []);
      if (adminMode) {
        const nextStatus = safeTrim(body.status, 80);
        if (!nextStatus) throw new Error("Wybierz status.");
        assertStatusAllowedForAdmin(nextStatus, claim.verified !== false);
        const comment = safeTrim(body.comment, 4000);
        const justification = safeTrim(body.justification, 8000);
        const solutionText = safeTrim(body.solutionText || body.proposedSolution, 8000);
        const refundMethod = safeTrim(body.refundMethod, 120);
        const refundExtra = safeTrim(body.refundExtra, 240);
        if (nextStatus === STATUS.PROPOSED && !solutionText) {
          throw new Error("Przy propozycji rozwiazania podaj tresc rozwiazania.");
        }
        if (nextStatus === STATUS.POSITIVE) {
          if (!justification) throw new Error("Przy pozytywnym rozpatrzeniu podaj uzasadnienie.");
          if (!refundMethod) throw new Error("Przy pozytywnym rozpatrzeniu wybierz forme zwrotu.");
          if ((refundMethod === "voucher" || refundMethod === "obnizka_ceny" || refundMethod === "inne") && !refundExtra) {
            throw new Error("Uzupelnij szczegoly formy zwrotu.");
          }
        }
        if (nextStatus === STATUS.NEGATIVE && !justification) {
          throw new Error("Przy negatywnym rozpatrzeniu podaj uzasadnienie.");
        }

        const statusMeta = getStatusMeta(nextStatus, claim.verified !== false);
        const updateData = {
          status: nextStatus,
          statusLabel: statusMeta.label,
          proposalSummary: nextStatus === STATUS.PROPOSED ? solutionText : claim.proposalSummary || "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          latestEventType: "admin_update",
          latestEventAt: admin.firestore.FieldValue.serverTimestamp(),
          latestComment: comment,
        };
        await claimRef.update(updateData);
        const actorProfile = await getUserProfile(sessionUser.uid).catch(() => null);
        const actorName = safeTrim(actorProfile?.displayName || sessionUser.email || "Administrator", 160);
        const eventData = {
          type: "admin_update",
          status: nextStatus,
          statusLabel: statusMeta.label,
          statusDescription: buildAdminStatusDescription(nextStatus, {
            comment,
            justification,
            solutionText,
          }),
          actorRole: "admin",
          actorName,
          actorUid: sessionUser.uid,
          comment,
          justification,
          solutionText,
          refundMethod,
          refundExtra,
          emailTemplateKey: nextStatus,
        };
        await appendEventWithAttachments(
          claimRef,
          eventData,
          attachments.map((item, index) => ({
            ...item,
            fileName: `status-${index + 1}.jpg`,
            label: "Zalacznik do zmiany statusu",
          })),
        );
        await logActivity(
          "RETURN_CLAIM_STATUS_CHANGED",
          {
            claimNumber: claim.claimNumber || "",
            fromStatus: claim.status || "",
            toStatus: nextStatus,
            verified: claim.verified !== false,
            comment,
          },
          sessionUser.uid,
          req,
          claim.userId || null,
        );
        const savedSnap = await claimRef.get();
        const saved = savedSnap.data() || {};
        void sendReturnClaimEmail(
          {
            ...saved,
            claimNumber: saved.claimNumber,
            email: saved.email,
            typeLabel: saved.typeLabel,
          },
          eventData,
        ).catch(() => {});
        const detail = await buildClaimDetail(savedSnap);
        res.status(200).json({ success: true, data: detail });
        return;
      }

      const mode = safeTrim(body.mode, 40);
      if (mode === "user_response") {
        if (claim.status !== STATUS.PROPOSED) {
          throw new Error("Na tym etapie nie mozna odpowiedziec na propozycje.");
        }
        const decision = safeTrim(body.decision, 20);
        if (decision !== "accept" && decision !== "reject") {
          throw new Error("Nieprawidlowa decyzja.");
        }
        const nextStatus = decision === "accept" ? STATUS.PROPOSAL_ACCEPTED : STATUS.PROPOSAL_REJECTED;
        const userResponseReason = safeTrim(body.userResponseReason, 4000);
        const userResponseExpectations = safeTrim(body.userResponseExpectations, 4000);
        if (decision === "reject") {
          if (userResponseReason.length < 5 || userResponseExpectations.length < 5) {
            throw new Error("Uzupelnij powod odrzucenia i oczekiwania (min. 5 znakow).");
          }
        }
        const statusMeta = getStatusMeta(nextStatus, claim.verified !== false);
        await claimRef.update({
          status: nextStatus,
          statusLabel: statusMeta.label,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          latestEventType: "user_response",
          latestEventAt: admin.firestore.FieldValue.serverTimestamp(),
          latestComment: userResponseReason || "",
        });
        const actorProfile = await getUserProfile(sessionUser.uid).catch(() => null);
        const actorName = safeTrim(actorProfile?.displayName || sessionUser.email || "Uzytkownik", 160);
        const eventData = {
          type: "user_response",
          status: nextStatus,
          statusLabel: statusMeta.label,
          statusDescription: decision === "accept" ? "Klient zaakceptowal propozycje." : "Klient odrzucil propozycje.",
          actorRole: "user",
          actorName,
          actorUid: sessionUser.uid,
          comment: "",
          userResponseReason,
          userResponseExpectations,
          emailTemplateKey: nextStatus,
        };
        await appendEventWithAttachments(
          claimRef,
          eventData,
          attachments.map((item, index) => ({
            ...item,
            fileName: `odpowiedz-${index + 1}.jpg`,
            label: "Zalacznik odpowiedzi klienta",
          })),
        );
        await logActivity(
          decision === "accept" ? "RETURN_CLAIM_PROPOSAL_ACCEPTED" : "RETURN_CLAIM_PROPOSAL_REJECTED",
          {
            claimNumber: claim.claimNumber || "",
            verified: claim.verified !== false,
            reason: userResponseReason,
            expectations: userResponseExpectations,
          },
          sessionUser.uid,
          req,
          claim.userId || null,
        );
        const savedSnap = await claimRef.get();
        const saved = savedSnap.data() || {};
        void sendReturnClaimEmail(
          {
            ...saved,
            claimNumber: saved.claimNumber,
            email: saved.email,
            typeLabel: saved.typeLabel,
          },
          eventData,
        ).catch(() => {});
        const detail = await buildClaimDetail(savedSnap);
        res.status(200).json({ success: true, data: detail });
        return;
      }

      if (!canUserEditClaim(claim, sessionUser)) {
        res.status(403).json({ success: false, error: "To zgloszenie nie moze juz byc edytowane." });
        return;
      }

      const updateData = {};
      if (body.firstName !== undefined) updateData.firstName = safeTrim(body.firstName, 120);
      if (body.lastName !== undefined) updateData.lastName = safeTrim(body.lastName, 120);
      if (body.phone !== undefined) updateData.phone = normalizePhone(body.phone);
      if (
        body.street !== undefined ||
        body.buildingNumber !== undefined ||
        body.apartmentNumber !== undefined ||
        body.postalCode !== undefined ||
        body.city !== undefined ||
        body.address
      ) {
        updateData.address = normalizeAddress({
          street: body.street ?? body.address?.street ?? claim.address?.street,
          buildingNumber: body.buildingNumber ?? body.address?.buildingNumber ?? claim.address?.buildingNumber,
          apartmentNumber: body.apartmentNumber ?? body.address?.apartmentNumber ?? claim.address?.apartmentNumber,
          postalCode: body.postalCode ?? body.address?.postalCode ?? claim.address?.postalCode,
          city: body.city ?? body.address?.city ?? claim.address?.city,
        });
      }
      if (body.bankAccount !== undefined || body.bankAccountIban !== undefined) {
        const bank = normalizeBankAccount(body.bankAccount || body.bankAccountIban);
        updateData.bankAccountIban = bank.iban;
        updateData.bankAccountFormatted = formatBankAccountGroups(bank.local);
      }
      if (body.orderNumber !== undefined) updateData.orderNumber = safeTrim(body.orderNumber, 160);
      if (body.invoiceNumber !== undefined) updateData.invoiceNumber = safeTrim(body.invoiceNumber, 160);
      if (body.defectDescription !== undefined) updateData.defectDescription = safeTrim(body.defectDescription, 12000);
      if (body.returnReason !== undefined) updateData.returnReason = safeTrim(body.returnReason, 8000);
      if (body.additionalInfo !== undefined) updateData.additionalInfo = safeTrim(body.additionalInfo, 8000);
      if (body.requestKind !== undefined) updateData.requestKind = safeTrim(body.requestKind, 160);
      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      updateData.latestEventType = "edited_by_user";
      updateData.latestEventAt = admin.firestore.FieldValue.serverTimestamp();
      updateData.latestComment = safeTrim(body.comment, 4000);
      await claimRef.update(updateData);
      const actorProfile = await getUserProfile(sessionUser.uid).catch(() => null);
      const eventData = {
        type: "edited_by_user",
        status: claim.status,
        statusLabel: claim.statusLabel || getStatusMeta(claim.status, claim.verified !== false).label,
        statusDescription: "Klient zaktualizowal formularz.",
        actorRole: "user",
        actorName: safeTrim(actorProfile?.displayName || sessionUser.email || "Uzytkownik", 160),
        actorUid: sessionUser.uid,
        comment: safeTrim(body.comment, 4000),
        emailTemplateKey: "edited_by_user",
      };
      await appendEventWithAttachments(
        claimRef,
        eventData,
        attachments.map((item, index) => ({
          ...item,
          fileName: `edycja-${index + 1}.jpg`,
          label: "Zalacznik do edycji klienta",
        })),
      );
      await logActivity(
        "RETURN_CLAIM_EDITED_BY_USER",
        {
          claimNumber: claim.claimNumber || "",
          verified: claim.verified !== false,
        },
        sessionUser.uid,
        req,
        claim.userId || null,
      );
      const savedSnap = await claimRef.get();
      const saved = savedSnap.data() || {};
      void sendReturnClaimEmail(
        {
          ...saved,
          claimNumber: saved.claimNumber,
          email: saved.email,
          typeLabel: saved.typeLabel,
        },
        eventData,
      ).catch(() => {});
      const detail = await buildClaimDetail(savedSnap);
      res.status(200).json({ success: true, data: detail });
      return;
    }

    if (req.method === "DELETE") {
      if (!sessionUser) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      const claimId = safeTrim(query.id, 120);
      if (!claimId) {
        res.status(400).json({ success: false, error: "Brak identyfikatora zgloszenia." });
        return;
      }
      const claimRef = db.collection("returnsClaims").doc(claimId);
      const claimSnap = await claimRef.get();
      if (!claimSnap.exists) {
        res.status(404).json({ success: false, error: "Nie znaleziono zgłoszenia." });
        return;
      }
      const claim = claimSnap.data() || {};
      if (adminMode) {
        await claimRef.delete();
        await logActivity(
          "RETURN_CLAIM_HARD_DELETED",
          { claimNumber: claim.claimNumber || "" },
          sessionUser.uid,
          req,
          claim.userId || null,
        );
        res.status(200).json({ success: true });
        return;
      }
      if (!canUserEditClaim(claim, sessionUser)) {
        res.status(403).json({ success: false, error: "To zgloszenie nie moze zostac anulowane." });
        return;
      }
      const statusMeta = getStatusMeta(STATUS.CANCELLED_BY_CLIENT, claim.verified !== false);
      await claimRef.update({
        status: STATUS.CANCELLED_BY_CLIENT,
        statusLabel: statusMeta.label,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        latestEventType: "cancelled_by_user",
        latestEventAt: admin.firestore.FieldValue.serverTimestamp(),
        latestComment: "",
      });
      const actorProfile = await getUserProfile(sessionUser.uid).catch(() => null);
      const eventData = {
        type: "cancelled_by_user",
        status: STATUS.CANCELLED_BY_CLIENT,
        statusLabel: statusMeta.label,
        statusDescription: "Klient anulowal zgloszenie.",
        actorRole: "user",
        actorName: safeTrim(actorProfile?.displayName || sessionUser.email || "Uzytkownik", 160),
        actorUid: sessionUser.uid,
        comment: "",
        emailTemplateKey: STATUS.CANCELLED_BY_CLIENT,
      };
      await appendEventWithAttachments(claimRef, eventData, []);
      await logActivity(
        "RETURN_CLAIM_CANCELLED_BY_USER",
        { claimNumber: claim.claimNumber || "" },
        sessionUser.uid,
        req,
        claim.userId || null,
      );
      const savedSnap = await claimRef.get();
      const saved = savedSnap.data() || {};
      void sendReturnClaimEmail(
        {
          ...saved,
          claimNumber: saved.claimNumber,
          email: saved.email,
          typeLabel: saved.typeLabel,
        },
        eventData,
      ).catch(() => {});
      const detail = await buildClaimDetail(savedSnap);
      res.status(200).json({ success: true, data: detail });
      return;
    }

    res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("returns api:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
};
