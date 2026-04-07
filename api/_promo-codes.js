const crypto = require('crypto');
const { initAdmin, admin } = require('./_sso-utils');
const { sendTransactionalEmail } = require('./_transactional-mail');

const PROMO_CODES_COLLECTION = 'promoCodes';
const PROMO_CODE_USAGES_COLLECTION = 'promoCodeUsages';
const ENCRYPTION_PREFIX = 'pc1:';
const SHOP_TRAINING_REDIRECT_URL = 'https://szkolenia.strzelca.pl';

function getPromoCodeLookupSecret() {
  const secret = String(
    process.env.PROMO_CODE_LOOKUP_SECRET ||
      process.env.PROMO_CODES_LOOKUP_SECRET ||
      '',
  ).trim();
  if (secret) return secret;
  // Fallback keeps promo codes operational when env is not configured yet.
  return `promo-codes-fallback-${String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || process.env.GCLOUD_PROJECT || 'strzelca-pl').trim()}`;
}

function getPromoCodeEncryptionKeyBuffer() {
  const raw = String(
    process.env.PROMO_CODE_ENCRYPTION_KEY ||
      process.env.PROMO_CODES_ENCRYPTION_KEY ||
      '',
  ).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

function normalizePromoCode(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function generatePromoCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let generated = '';
  for (let i = 0; i < 8; i += 1) {
    generated += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return `${generated}-STRZELCA.pl`;
}

function computePromoCodeLookupHash(normalizedCode) {
  return crypto
    .createHmac('sha256', getPromoCodeLookupSecret())
    .update(String(normalizedCode || ''), 'utf8')
    .digest('hex');
}

function encryptPromoCode(normalizedCode) {
  const key = getPromoCodeEncryptionKeyBuffer();
  if (!key) {
    return `raw1:${Buffer.from(String(normalizedCode || ''), 'utf8').toString('base64')}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(normalizedCode || ''), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_PREFIX + Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function decryptPromoCode(payload) {
  if (typeof payload === 'string' && payload.startsWith('raw1:')) {
    try {
      return Buffer.from(payload.slice(5), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  if (typeof payload !== 'string' || !payload.startsWith(ENCRYPTION_PREFIX)) {
    return '';
  }
  const key = getPromoCodeEncryptionKeyBuffer();
  if (!key) return '';
  const raw = Buffer.from(payload.slice(ENCRYPTION_PREFIX.length), 'base64');
  if (raw.length < 29) return '';
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function maskPromoCode(normalizedCode) {
  const value = String(normalizedCode || '').trim();
  if (!value) return '';
  const visibleStart = value.slice(0, 4);
  const visibleEnd = value.slice(-4);
  return `${visibleStart}***${visibleEnd}`;
}

function promoCodeUsageDocId(codeId, userId) {
  return `${String(codeId || '').trim()}__${String(userId || '').trim()}`;
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function toDate(value) {
  const millis = toMillis(value);
  return millis == null ? null : new Date(millis);
}

function formatDateTimeForAdmin(value) {
  const date = toDate(value);
  if (!date) return 'Bez terminu';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

function isPromoCodeExpired(data, nowMs = Date.now()) {
  if (!data || data.isPerpetual === true) return false;
  const expiresAtMs = toMillis(data.expiresAt);
  if (expiresAtMs == null) return false;
  return expiresAtMs < nowMs;
}

function parseUsageLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.floor(parsed));
}

function parseDiscountValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function parseMinimumOrderValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function sanitizePromoCodeInput(input, currentData = null) {
  const rawCode = String(input?.code || currentData?.code || '').trim();
  const normalizedCode = normalizePromoCode(rawCode);
  if (!normalizedCode) {
    throw new Error('Kod jest wymagany.');
  }

  const purpose = String(input?.purpose || currentData?.purpose || '').trim();
  if (purpose !== 'training_access' && purpose !== 'discount') {
    throw new Error('Wybierz przeznaczenie kodu.');
  }

  const isPerpetual = input?.isPerpetual === true;
  const expiresAtRaw = input?.expiresAt || null;
  let expiresAt = null;
  if (!isPerpetual) {
    const parsedDate = toDate(expiresAtRaw);
    if (!parsedDate) {
      throw new Error('Podaj termin ważności kodu lub zaznacz kod bezterminowy.');
    }
    expiresAt = admin.firestore.Timestamp.fromDate(parsedDate);
  }

  const usageLimit = parseUsageLimit(input?.usageLimit);
  const isActive =
    input?.isActive === undefined
      ? currentData?.isActive !== false
      : input.isActive === true;

  const base = {
    code: normalizedCode,
    lookupHash: computePromoCodeLookupHash(normalizedCode),
    encryptedCode: encryptPromoCode(normalizedCode),
    maskedCode: maskPromoCode(normalizedCode),
    purpose,
    isPerpetual,
    expiresAt,
    usageLimit,
    isActive,
    targetTrainingId: '',
    targetTrainingTitle: '',
    discountType: '',
    discountValue: 0,
    minOrderValue: 0,
  };

  if (purpose === 'training_access') {
    const targetTrainingId = String(input?.targetTrainingId || '').trim();
    const targetTrainingTitle = String(input?.targetTrainingTitle || '').trim();
    if (!targetTrainingId) {
      throw new Error('Wybierz szkolenie, które ma zostać odblokowane.');
    }
    base.targetTrainingId = targetTrainingId;
    base.targetTrainingTitle = targetTrainingTitle;
  }

  if (purpose === 'discount') {
    const discountType = String(input?.discountType || '').trim();
    if (discountType !== 'percent' && discountType !== 'amount') {
      throw new Error('Wybierz typ rabatu.');
    }
    const discountValue = parseDiscountValue(input?.discountValue);
    if (discountValue <= 0) {
      throw new Error('Podaj wartość rabatu większą od zera.');
    }
    if (discountType === 'percent' && discountValue > 100) {
      throw new Error('Rabat procentowy nie może przekraczać 100%.');
    }
    base.discountType = discountType;
    base.discountValue = discountValue;
    base.minOrderValue = parseMinimumOrderValue(
      input?.minOrderValue === undefined ? currentData?.minOrderValue : input?.minOrderValue,
    );
  }

  return base;
}

function mapPromoCodeReasonToMessage(reason, extra = {}) {
  if (reason === 'expired') {
    return {
      ok: false,
      reason,
      message: 'Kod przeterminowany.',
    };
  }
  if (reason === 'already_used') {
    return {
      ok: false,
      reason,
      message: 'Ten kod został już wykorzystany na tym koncie.',
    };
  }
  if (reason === 'usage_exhausted') {
    return {
      ok: false,
      reason,
      message: 'Wyczerpała się pula dostępności tego kodu.',
    };
  }
  if (reason === 'training_access_shop_only') {
    return {
      ok: false,
      reason,
      message:
        'Ten kod służy do uzyskania dostępu do szkolenia - przejdź do strony SZKOLENIA.STRZELCA.pl.',
      actionLabel: 'Otwórz szkolenia',
      actionUrl: SHOP_TRAINING_REDIRECT_URL,
    };
  }
  if (reason === 'training_access_other_training') {
    const title = String(extra?.trainingTitle || '').trim();
    return {
      ok: false,
      reason,
      message: title
        ? `Ten kod służy do uzyskania dostępu do innego szkolenia: ${title}.`
        : 'Ten kod służy do uzyskania dostępu do innego szkolenia.',
    };
  }
  if (reason === 'minimum_order_not_met') {
    const minOrderValue = Math.max(0, Number(extra?.minOrderValue) || 0);
    return {
      ok: false,
      reason,
      message:
        minOrderValue > 0
          ? `Minimalna wartość zamówienia dla tego kodu to ${minOrderValue.toFixed(2)} PLN.`
          : 'Minimalna wartość zamówienia dla tego kodu nie została spełniona.',
    };
  }
  return {
    ok: false,
    reason: reason || 'invalid',
    message: 'Kupon nieprawidłowy.',
  };
}

function computeDiscount(basePrice, data) {
  const price = Math.max(0, Number(basePrice) || 0);
  if (data.discountType === 'percent') {
    return Math.min(price, Math.ceil(price * data.discountValue) / 100);
  }
  if (data.discountType === 'amount') {
    return Math.min(price, Math.ceil((Number(data.discountValue) || 0) * 100) / 100);
  }
  return 0;
}

async function findPromoCodeByNormalized({ db, tx = null, normalizedCode }) {
  const lookupHash = computePromoCodeLookupHash(normalizedCode);
  const ref = db.collection(PROMO_CODES_COLLECTION).where('lookupHash', '==', lookupHash).limit(1);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ref: doc.ref,
    data: doc.data() || {},
  };
}

async function getPromoCodeUsageForUser({ db, tx = null, codeId, userId }) {
  const usageRef = db.collection(PROMO_CODE_USAGES_COLLECTION).doc(promoCodeUsageDocId(codeId, userId));
  const snap = tx ? await tx.get(usageRef) : await usageRef.get();
  return {
    ref: usageRef,
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : null,
  };
}

async function evaluatePromoCodeForOrder({
  db,
  tx = null,
  rawCode,
  userId,
  context,
  trainingId,
  basePrice,
  nowMs = Date.now(),
}) {
  const normalizedCode = normalizePromoCode(rawCode);
  if (!normalizedCode) {
    return mapPromoCodeReasonToMessage('invalid');
  }

  const found = await findPromoCodeByNormalized({ db, tx, normalizedCode });
  if (!found) {
    return mapPromoCodeReasonToMessage('invalid');
  }

  const data = found.data;
  if (data.isActive === false) {
    return mapPromoCodeReasonToMessage('invalid');
  }

  if (isPromoCodeExpired(data, nowMs)) {
    return mapPromoCodeReasonToMessage('expired');
  }

  const usageInfo = await getPromoCodeUsageForUser({ db, tx, codeId: found.id, userId });
  if (usageInfo.exists) {
    return mapPromoCodeReasonToMessage('already_used');
  }

  const currentUsed = Math.max(0, Number(data.redemptionCount) || 0);
  const usageLimit = parseUsageLimit(data.usageLimit);
  if (usageLimit > 0 && currentUsed >= usageLimit) {
    return mapPromoCodeReasonToMessage('usage_exhausted');
  }

  if (data.purpose === 'training_access') {
    if (context !== 'training') {
      return mapPromoCodeReasonToMessage('training_access_shop_only');
    }
    if (!trainingId || String(data.targetTrainingId || '').trim() !== String(trainingId || '').trim()) {
      return mapPromoCodeReasonToMessage('training_access_other_training', {
        trainingTitle: data.targetTrainingTitle,
      });
    }

    return {
      ok: true,
      codeId: found.id,
      codeRef: found.ref,
      codeData: data,
      normalizedCode,
      usageRef: usageInfo.ref,
      application: 'training_access',
      discountAmount: Math.max(0, Number(basePrice) || 0),
      finalPrice: 0,
      customerMessage: `Kupon: dostep do szkolenia ${String(
        data.targetTrainingTitle || '',
      ).trim()} - dokoncz skladanie zamowienia i odswiez strone, aby uzyskac dostep.`,
    };
  }

  if (data.purpose === 'discount') {
    const price = Math.max(0, Number(basePrice) || 0);
    const minOrderValue = parseMinimumOrderValue(data.minOrderValue);
    if (minOrderValue > 0 && price < minOrderValue) {
      return mapPromoCodeReasonToMessage('minimum_order_not_met', { minOrderValue });
    }
    const discountAmount = computeDiscount(basePrice, data);
    return {
      ok: true,
      codeId: found.id,
      codeRef: found.ref,
      codeData: data,
      normalizedCode,
      usageRef: usageInfo.ref,
      application: 'discount',
      discountAmount,
      finalPrice:
        Math.round((Math.max(0, (Number(basePrice) || 0) - discountAmount) + Number.EPSILON) * 100) /
        100,
      customerMessage:
        data.discountType === 'percent'
          ? `Kupon rabatowy aktywny: -${data.discountValue}%`
          : `Kupon rabatowy aktywny: -${Number(data.discountValue || 0).toFixed(2)} PLN`,
    };
  }

  return mapPromoCodeReasonToMessage('invalid');
}

async function grantTrainingAccessInTransaction({
  db,
  tx,
  trainingId,
  userId,
  grantedBy,
}) {
  const accessQuery = db
    .collection('trainingAccess')
    .where('trainingId', '==', String(trainingId || '').trim())
    .where('userId', '==', String(userId || '').trim())
    .limit(1);
  const existingAccess = await tx.get(accessQuery);
  if (!existingAccess.empty) return false;

  const accessRef = db.collection('trainingAccess').doc();
  tx.set(accessRef, {
    trainingId: String(trainingId || '').trim(),
    userId: String(userId || '').trim(),
    grantedAt: admin.firestore.FieldValue.serverTimestamp(),
    grantedBy: String(grantedBy || 'system').trim() || 'system',
    grantedVia: 'promo_code',
  });
  return true;
}

async function redeemPromoCodeForOrder({
  db,
  tx,
  evaluation,
  userId,
  orderId,
  orderNumber,
  orderContext,
  orderItemTitle,
  grantedBy,
}) {
  if (!evaluation?.ok) {
    throw new Error('Cannot redeem invalid promo code');
  }

  const usagePayload = {
    codeId: evaluation.codeId,
    userId: String(userId || '').trim(),
    orderId: String(orderId || '').trim(),
    orderNumber: String(orderNumber || '').trim(),
    context: String(orderContext || '').trim(),
    itemTitle: String(orderItemTitle || '').trim(),
    purpose: String(evaluation.codeData?.purpose || '').trim(),
    redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
    normalizedCodeHash: computePromoCodeLookupHash(evaluation.normalizedCode),
    maskedCode: maskPromoCode(evaluation.normalizedCode),
  };
  tx.set(evaluation.usageRef, usagePayload);

  tx.update(evaluation.codeRef, {
    redemptionCount: admin.firestore.FieldValue.increment(1),
    lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRedeemedBy: String(userId || '').trim(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let trainingAccessGranted = false;
  if (evaluation.application === 'training_access') {
    trainingAccessGranted = await grantTrainingAccessInTransaction({
      db,
      tx,
      trainingId: evaluation.codeData?.targetTrainingId,
      userId,
      grantedBy,
    });
  }

  return {
    usageDocId: evaluation.usageRef.id,
    trainingAccessGranted,
  };
}

function getPromoCodeAdminNotificationEmail() {
  return 'kontakt@strzelca.pl';
}

async function resolveUserProfileBasic(db, userId) {
  if (!userId) {
    return { displayName: '', email: '' };
  }
  const snap = await db.collection('userProfiles').doc(String(userId).trim()).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    displayName: String(data.displayName || '').trim(),
    email: String(data.email || '').trim(),
  };
}

async function sendPromoCodeUsageNotification({
  db,
  evaluation,
  userId,
  orderNumber,
  orderContext,
  orderItemTitle,
  finalTotal,
}) {
  const to = getPromoCodeAdminNotificationEmail();
  if (!to || !evaluation?.ok) return;

  const profile = await resolveUserProfileBasic(db, userId);
  const fullCode = evaluation.normalizedCode || maskPromoCode(evaluation.codeData?.maskedCode || '');
  const usageLimit = parseUsageLimit(evaluation.codeData?.usageLimit);
  const currentUsed = Math.max(0, Number(evaluation.codeData?.redemptionCount) || 0) + 1;
  const remaining =
    usageLimit > 0 ? Math.max(usageLimit - currentUsed, 0) : 'bez limitu';
  const nowLabel = formatDateTimeForAdmin(Date.now());
  const subject = `Kod ${fullCode} został wykorzystany - strzelca.pl`;
  const html = `<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <h2 style="color:#c19a6b;">Kod został wykorzystany</h2>
    <ul>
      <li><strong>Kiedy:</strong> ${nowLabel}</li>
      <li><strong>Kod:</strong> ${fullCode}</li>
      <li><strong>Typ:</strong> ${
        evaluation.application === 'training_access' ? 'Dostęp do szkolenia' : 'Kupon rabatowy'
      }</li>
      <li><strong>Kontekst:</strong> ${String(orderContext || '').trim() || 'zamówienie'}</li>
      <li><strong>Pozycja:</strong> ${String(orderItemTitle || '').trim() || '—'}</li>
      <li><strong>Numer zamówienia:</strong> ${String(orderNumber || '').trim() || '—'}</li>
      <li><strong>Użytkownik:</strong> ${profile.displayName || '—'}</li>
      <li><strong>E-mail:</strong> ${profile.email || '—'}</li>
      <li><strong>Wartość po zastosowaniu:</strong> ${Number(finalTotal || 0).toFixed(2)} zł</li>
      <li><strong>Wykorzystano:</strong> ${currentUsed}</li>
      <li><strong>Pozostało:</strong> ${remaining}</li>
    </ul>
  </body></html>`;

  await sendTransactionalEmail({
    to,
    subject,
    html,
    logCategory: 'promo_code_usage_notification',
    logMeta: {
      orderNumber: String(orderNumber || ''),
      userId: String(userId || ''),
      promoCodeId: String(evaluation.codeId || ''),
    },
  });
}

function serializePromoCodeForAdmin(doc) {
  const data = doc.data() || {};
  let code = '';
  try {
    code = data.encryptedCode ? decryptPromoCode(data.encryptedCode) : '';
  } catch {
    code = '';
  }
  const usageLimit = parseUsageLimit(data.usageLimit);
  const usedCount = Math.max(0, Number(data.redemptionCount) || 0);
  const remainingUses = usageLimit > 0 ? Math.max(usageLimit - usedCount, 0) : null;
  const expired = isPromoCodeExpired(data);
  return {
    id: doc.id,
    code: code || '',
    maskedCode: String(data.maskedCode || '').trim(),
    purpose: String(data.purpose || '').trim(),
    isActive: data.isActive !== false,
    isPerpetual: data.isPerpetual === true,
    expiresAt: data.expiresAt || null,
    expiresAtIso: toDate(data.expiresAt)?.toISOString() || '',
    expiresAtLabel: formatDateTimeForAdmin(data.expiresAt),
    usageLimit,
    usedCount,
    remainingUses,
    expired,
    targetTrainingId: String(data.targetTrainingId || '').trim(),
    targetTrainingTitle: String(data.targetTrainingTitle || '').trim(),
    discountType: String(data.discountType || '').trim(),
    discountValue: Number(data.discountValue || 0),
    minOrderValue: parseMinimumOrderValue(data.minOrderValue),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

module.exports = {
  PROMO_CODES_COLLECTION,
  PROMO_CODE_USAGES_COLLECTION,
  SHOP_TRAINING_REDIRECT_URL,
  normalizePromoCode,
  generatePromoCode,
  computePromoCodeLookupHash,
  encryptPromoCode,
  decryptPromoCode,
  maskPromoCode,
  promoCodeUsageDocId,
  isPromoCodeExpired,
  parseUsageLimit,
  sanitizePromoCodeInput,
  mapPromoCodeReasonToMessage,
  evaluatePromoCodeForOrder,
  redeemPromoCodeForOrder,
  sendPromoCodeUsageNotification,
  serializePromoCodeForAdmin,
  formatDateTimeForAdmin,
};
