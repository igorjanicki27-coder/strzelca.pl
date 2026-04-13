const { initAdmin, admin } = require('./_sso-utils');

const BAZAR_COMMERCE_SETTINGS_DOC = 'siteSettings/bazarCommerce';
const BAZAR_TOKEN_GRANTS = 'bazarTokenGrants';
const BAZAR_TOKEN_LEDGER = 'bazarTokenLedger';
const BAZAR_TOKEN_WALLETS = 'bazarTokenWallets';
const BAZAR_PURCHASES = 'bazarTokenPurchases';
const BAZAR_REPORTS = 'bazarOfferReports';
const BAZAR_WEBHOOK_LOG = 'bazarStripeWebhookLog';
const BAZAR_PROMO_CODES = 'bazarPromoCodes';
const BAZAR_PROMO_CLAIMS = 'bazarPromoClaims';

const DEFAULT_BAZAR_COMMERCE_CONFIG = {
  version: 2,
  currency: 'pln',
  privateFreeActiveOffers: 5,
  privateFreeRefreshDays: 25,
  companyTokenValidityDays: 365,
  publicationDurationDays: 30,
  tokenPricing: {
    tokenPriceCents: 500,
    presetQuantities: [10, 50, 100, 1000],
    maxPurchaseQuantity: 10000,
  },
  promotionDefaults: {
    pinDays: 7,
    highlightDays: 7,
  },
  packages: [],
  actions: {
    private_extra_listing: {
      label: 'Publikacja oferty ponad darmowy limit',
      tokenCost: 1,
      active: true,
      durationDays: 30,
    },
    company_listing: {
      label: 'Publikacja oferty firmowej',
      tokenCost: 1,
      active: true,
      durationDays: 30,
    },
    pin_offer: {
      label: 'Przypiecie oferty',
      tokenCost: 1,
      active: true,
      durationDays: 7,
    },
    highlight_offer: {
      label: 'Wyroznienie oferty',
      tokenCost: 1,
      active: true,
      durationDays: 30,
    },
    early_refresh: {
      label: 'Wcześniejsze odświeżenie oferty',
      tokenCost: 1,
      active: true,
      durationDays: 30,
    },
    material_relist: {
      label: 'Ponowna publikacja po istotnej zmianie oferty',
      tokenCost: 1,
      active: true,
      durationDays: 30,
    },
  },
  reportingReasons: [
    'Podejrzenie oszustwa',
    'Duplikat ogłoszenia',
    'Przedmiot niedozwolony',
    'Nielegalna część lub akcesorium',
    'Naruszenie regulaminu',
    'Fałszywa firma',
    'Inne',
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeAddressFields(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  return {
    street: normalizeText(row.street || '', 120),
    buildingNumber: normalizeText(row.buildingNumber || '', 60),
    postalCode: normalizeText(row.postalCode || '', 40),
    city: normalizeText(row.city || '', 120),
  };
}

function formatAddressFromFields(raw) {
  const fields = normalizeAddressFields(raw);
  const streetLine = [fields.street, fields.buildingNumber].filter(Boolean).join(' ').trim();
  return [streetLine, fields.postalCode, fields.city].filter(Boolean).join(', ');
}

function decodeMaybeB64(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return Buffer.from(raw, 'base64').toString('utf8');
  } catch (_) {
    return raw;
  }
}

function getPublicBaseUrl() {
  const raw = String(
    process.env.PUBLIC_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'https://strzelca.pl',
  ).trim();
  if (!raw) return 'https://strzelca.pl';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return `https://${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function normalizePackage(pkg) {
  const row = pkg && typeof pkg === 'object' ? pkg : {};
  return {
    id: normalizeText(row.id || '', 80),
    label: normalizeText(row.label || '', 120),
    tokens: Math.max(1, parseInt(row.tokens, 10) || 1),
    priceCents: Math.max(0, parseInt(row.priceCents, 10) || 0),
    active: row.active !== false,
  };
}

function pluralizeŻetony(count) {
  const value = Math.abs(Number(count) || 0);
  if (value === 1) return 'żeton';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'żetony';
  return 'żetonów';
}

function buildTokenPackageId(tokens, isCustom = false) {
  const normalizedTokens = Math.max(1, parseInt(tokens, 10) || 1);
  return isCustom ? `custom_${normalizedTokens}` : `tokens_${normalizedTokens}`;
}

function buildTokenPackageLabel(tokens) {
  const normalizedTokens = Math.max(1, parseInt(tokens, 10) || 1);
  return `${normalizedTokens} ${pluralizeŻetony(normalizedTokens)}`;
}

function getTokenDiscountPercent(tokens) {
  const quantity = Math.max(0, parseInt(tokens, 10) || 0);
  if (quantity >= 10000) return 15;
  if (quantity >= 1000) return 10;
  if (quantity >= 100) return 5;
  if (quantity >= 50) return 2;
  return 0;
}

function computeTokenPricingForQuantity(tokens, tokenPriceCents) {
  const normalizedTokens = Math.max(1, parseInt(tokens, 10) || 1);
  const normalizedPrice = Math.max(0, parseInt(tokenPriceCents, 10) || 0);
  const discountPercent = getTokenDiscountPercent(normalizedTokens);
  const basePriceCents = normalizedTokens * normalizedPrice;
  const effectivePriceCents = Math.max(0, Math.round(basePriceCents * (100 - discountPercent) / 100));
  const pricePerTokenCents = Math.max(0, Math.round(effectivePriceCents / normalizedTokens));
  return {
    tokens: normalizedTokens,
    basePriceCents,
    effectivePriceCents,
    pricePerTokenCents,
    discountPercent,
  };
}

function normalizeTokenPricing(raw, fallback = DEFAULT_BAZAR_COMMERCE_CONFIG.tokenPricing) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const presetRaw = Array.isArray(row.presetQuantities) && row.presetQuantities.length
    ? row.presetQuantities
    : Array.isArray(fallback?.presetQuantities) && fallback.presetQuantities.length
      ? fallback.presetQuantities
      : DEFAULT_BAZAR_COMMERCE_CONFIG.tokenPricing.presetQuantities;
  const presetQuantities = Array.from(new Set(
    presetRaw
      .map((value) => Math.max(1, parseInt(value, 10) || 0))
      .filter((value) => value > 0),
  )).sort((a, b) => a - b);
  return {
    tokenPriceCents: Math.max(0, parseInt(row.tokenPriceCents, 10) || fallback?.tokenPriceCents || 0),
    presetQuantities: presetQuantities.length ? presetQuantities : clone(DEFAULT_BAZAR_COMMERCE_CONFIG.tokenPricing.presetQuantities),
    maxPurchaseQuantity: Math.min(10000, Math.max(1, parseInt(row.maxPurchaseQuantity, 10) || fallback?.maxPurchaseQuantity || 10000)),
  };
}

function buildPackagesFromTokenPricing(tokenPricing) {
  return tokenPricing.presetQuantities.map((tokens) => {
    const pricing = computeTokenPricingForQuantity(tokens, tokenPricing.tokenPriceCents);
    return {
      id: buildTokenPackageId(tokens, false),
      label: buildTokenPackageLabel(tokens),
      tokens,
      priceCents: pricing.basePriceCents,
      effectivePriceCents: pricing.effectivePriceCents,
      pricePerTokenCents: pricing.pricePerTokenCents,
      discountPercent: pricing.discountPercent,
      active: true,
      isCustom: false,
    };
  });
}

function normalizeAction(actionKey, row, fallback) {
  const src = row && typeof row === 'object' ? row : {};
  return {
    label: normalizeText(src.label || fallback?.label || actionKey, 160),
    tokenCost: Math.max(1, parseInt(src.tokenCost, 10) || fallback?.tokenCost || 1),
    active: src.active !== false,
    durationDays: Math.max(1, parseInt(src.durationDays, 10) || fallback?.durationDays || 7),
  };
}

function normalizePromoCode(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const kind = normalizeText(row.kind || 'discount', 24).toLowerCase();
  return {
    code: normalizeText(row.code || '', 64).toUpperCase(),
    label: normalizeText(row.label || '', 160),
    kind: kind === 'grant' ? 'grant' : 'discount',
    active: row.active !== false,
    discountPercent: Math.max(0, Math.min(100, parseInt(row.discountPercent, 10) || 0)),
    grantTokens: Math.max(0, parseInt(row.grantTokens, 10) || 0),
    maxTotalUses: Math.max(0, parseInt(row.maxTotalUses, 10) || 0),
    maxUsesPerUser: Math.max(1, parseInt(row.maxUsesPerUser, 10) || 1),
    startsAt: row.startsAt || null,
    expiresAt: row.expiresAt || null,
    note: normalizeText(row.note || '', 400),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    createdBy: normalizeText(row.createdBy || '', 120),
    usageCount: Math.max(0, parseInt(row.usageCount, 10) || 0),
  };
}

function getPromoClaimDocId(code, uid) {
  return `${normalizeText(code || '', 64).toUpperCase()}__${normalizeText(uid || '', 120)}`;
}

function isPromoCodeTimeActive(code, nowMs = Date.now()) {
  const startsAtMs = code?.startsAt?._seconds
    ? code.startsAt._seconds * 1000
    : code?.startsAt?.seconds
      ? code.startsAt.seconds * 1000
      : code?.startsAt?.toMillis
        ? code.startsAt.toMillis()
        : new Date(code?.startsAt || 0).getTime();
  const expiresAtMs = code?.expiresAt?._seconds
    ? code.expiresAt._seconds * 1000
    : code?.expiresAt?.seconds
      ? code.expiresAt.seconds * 1000
      : code?.expiresAt?.toMillis
        ? code.expiresAt.toMillis()
        : new Date(code?.expiresAt || 0).getTime();
  if (Number.isFinite(startsAtMs) && startsAtMs > 0 && startsAtMs > nowMs) return false;
  if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs < nowMs) return false;
  return true;
}

function buildPackagePreview(pkg, discountPercent = 0) {
  const basePriceCents = Math.max(0, parseInt(pkg?.basePriceCents ?? pkg?.priceCents, 10) || 0);
  const tokens = Math.max(1, parseInt(pkg?.tokens, 10) || 1);
  const normalizedPercent = Math.max(0, Math.min(100, parseInt(discountPercent, 10) || 0));
  const discountedPriceCents = Math.max(0, Math.round(basePriceCents * (100 - normalizedPercent) / 100));
  const pricePerTokenCents = Math.max(0, Math.round(discountedPriceCents / tokens));
  return {
    id: normalizeText(pkg?.id || '', 80),
    label: normalizeText(pkg?.label || '', 160),
    tokens,
    priceCents: basePriceCents,
    effectivePriceCents: discountedPriceCents,
    pricePerTokenCents,
    discountPercent: normalizedPercent,
    active: pkg?.active !== false,
  };
}

function normalizeCommerceConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const defaults = clone(DEFAULT_BAZAR_COMMERCE_CONFIG);
  const tokenPricing = normalizeTokenPricing(cfg.tokenPricing || cfg, defaults.tokenPricing);
  const packageOverrides = Array.isArray(cfg.packages) && cfg.packages.length
    ? cfg.packages.map(normalizePackage).filter((item) => item.id && item.tokens > 0)
    : [];
  const actions = {};
  const sourceActions = cfg.actions && typeof cfg.actions === 'object' ? cfg.actions : {};
  for (const [key, fallback] of Object.entries(defaults.actions)) {
    actions[key] = normalizeAction(key, sourceActions[key], fallback);
  }
  return {
    version: Math.max(1, parseInt(cfg.version, 10) || defaults.version),
    currency: normalizeText(cfg.currency || defaults.currency, 8).toLowerCase() || 'pln',
    privateFreeActiveOffers: Math.max(0, parseInt(cfg.privateFreeActiveOffers, 10) || defaults.privateFreeActiveOffers),
    privateFreeRefreshDays: Math.max(0, parseInt(cfg.privateFreeRefreshDays, 10) || defaults.privateFreeRefreshDays),
    companyTokenValidityDays: Math.max(1, parseInt(cfg.companyTokenValidityDays, 10) || defaults.companyTokenValidityDays),
    publicationDurationDays: Math.max(1, parseInt(cfg.publicationDurationDays, 10) || defaults.publicationDurationDays),
    tokenPricing,
    promotionDefaults: {
      pinDays: Math.max(
        1,
        parseInt(cfg.promotionDefaults?.pinDays, 10) || defaults.promotionDefaults.pinDays,
      ),
      highlightDays: Math.max(
        1,
        parseInt(cfg.promotionDefaults?.highlightDays, 10) || defaults.promotionDefaults.highlightDays,
      ),
    },
    packages: buildPackagesFromTokenPricing(tokenPricing).map((pkg) => {
      const override = packageOverrides.find((item) => item.tokens === pkg.tokens) || null;
      if (!override) return pkg;
      return {
        ...pkg,
        id: override.id || pkg.id,
        label: override.label || pkg.label,
        active: override.active !== false,
      };
    }),
    actions,
    reportingReasons:
      Array.isArray(cfg.reportingReasons) && cfg.reportingReasons.length
        ? cfg.reportingReasons.map((item) => normalizeText(item, 160)).filter(Boolean)
        : defaults.reportingReasons,
  };
}

async function getBazarCommerceConfig(db) {
  const snap = await db.doc(BAZAR_COMMERCE_SETTINGS_DOC).get();
  return normalizeCommerceConfig(snap.exists ? snap.data() : null);
}

async function saveBazarCommerceConfig(db, cfg, meta = {}) {
  const normalized = normalizeCommerceConfig(cfg);
  await db.doc(BAZAR_COMMERCE_SETTINGS_DOC).set(
    {
      ...normalized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: normalizeText(meta.updatedBy || '', 120),
    },
    { merge: true },
  );
  return normalized;
}

async function getPromoCodeByCode(db, codeRaw) {
  const code = normalizeText(codeRaw || '', 64).toUpperCase();
  if (!code) return null;
  const snap = await db.collection(BAZAR_PROMO_CODES).doc(code).get();
  if (!snap.exists) return null;
  return normalizePromoCode({ code: snap.id, ...(snap.data() || {}) });
}

async function listPromoCodes(db, limitCount = 200) {
  const snap = await db
    .collection(BAZAR_PROMO_CODES)
    .orderBy('updatedAt', 'desc')
    .limit(Math.max(1, Math.min(parseInt(limitCount, 10) || 200, 300)))
    .get();
  return snap.docs.map((docSnap) => normalizePromoCode({ code: docSnap.id, ...(docSnap.data() || {}) }));
}

async function savePromoCode(db, rawCode, meta = {}) {
  const normalized = normalizePromoCode(rawCode);
  if (!normalized.code) throw new Error('Kod promocyjny jest wymagany.');
  if (normalized.kind === 'discount' && normalized.discountPercent <= 0) {
    throw new Error('Kod rabatowy musi mieć procent zniżki większy od zera.');
  }
  if (normalized.kind === 'grant' && normalized.grantTokens <= 0) {
    throw new Error('Kod gratisowy musi przyznawać co najmniej 1 żeton.');
  }
  await db.collection(BAZAR_PROMO_CODES).doc(normalized.code).set(
    {
      ...normalized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: normalized.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      createdBy: normalizeText(meta.createdBy || normalized.createdBy || '', 120),
    },
    { merge: true },
  );
  return normalized;
}

async function setPromoCodeStatus(db, codeRaw, updates, meta = {}) {
  const code = normalizeText(codeRaw || '', 64).toUpperCase();
  if (!code) throw new Error('Brak kodu promocyjnego.');
  const patch = updates && typeof updates === 'object' ? updates : {};
  await db.collection(BAZAR_PROMO_CODES).doc(code).set(
    {
      active: patch.active !== false,
      note: normalizeText(patch.note || '', 400),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: normalizeText(meta.updatedBy || '', 120),
    },
    { merge: true },
  );
}

async function getDecodedUserProfile(db, uid) {
  const [userSnap, publicSnap] = await Promise.all([
    db.collection('userProfiles').doc(uid).get(),
    db.collection('publicProfiles').doc(uid).get(),
  ]);
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const pub = publicSnap.exists ? publicSnap.data() || {} : {};
  const role = normalizeText(user.role || pub.role || 'user', 32).toLowerCase() || 'user';
  const verificationStatus =
    role === 'company'
      ? normalizeText(user.companyVerificationStatus || 'pending', 32).toLowerCase()
      : 'not_applicable';
  return {
    uid,
    role,
    email: normalizeText(user.email || '', 180),
    emailVerified: user.emailVerified === true || pub.emailVerified === true,
    displayName: normalizeText(pub.displayName || user.displayName || '', 120),
    avatar: normalizeText(pub.avatar || user.avatar || '', 2000),
    phone: decodeMaybeB64(user.phone),
    companyName: decodeMaybeB64(user.companyName),
    nip: decodeMaybeB64(user.nip),
    address: {
      street: decodeMaybeB64(user.address?.street),
      buildingNumber: decodeMaybeB64(user.address?.buildingNumber),
      postalCode: decodeMaybeB64(user.address?.postalCode),
      city: decodeMaybeB64(user.address?.city),
    },
    companyVerificationStatus: verificationStatus,
    companyVerificationReason: normalizeText(user.companyVerificationReason || '', 600),
    companyVerificationReviewedAt: user.companyVerificationReviewedAt || null,
    companyVerificationReviewedBy: normalizeText(user.companyVerificationReviewedBy || '', 120),
    bazarFirstOfferGuideCompletedAt: user.bazarFirstOfferGuideCompletedAt || null,
    bazarFirstOfferGuideAcceptedRulesAt: user.bazarFirstOfferGuideAcceptedRulesAt || null,
    bazarFirstOfferGuideVersion: Math.max(0, parseInt(user.bazarFirstOfferGuideVersion, 10) || 0),
  };
}

function getCompanyVerificationLabel(status) {
  switch (String(status || '').toLowerCase()) {
    case 'verified':
      return 'Zweryfikowana firma';
    case 'rejected':
      return 'Odrzucona weryfikacja firmy';
    case 'pending':
      return 'Konto firmowe w trakcie weryfikacji';
    default:
      return 'Nie dotyczy';
  }
}

function assertProfileReadyForTokenPurchase(profile) {
  if (!profile) throw new Error('Nie znaleziono profilu.');
  if (!profile.emailVerified) {
    throw new Error('Zakup żetonów jest dostępny dopiero po potwierdzeniu adresu e-mail.');
  }
  if (profile.role === 'company') {
    if (!profile.companyName || !profile.nip || !profile.address?.street || !profile.address?.city) {
      throw new Error('Uzupełnij dane firmy w profilu przed zakupem żetonów.');
    }
    if (profile.companyVerificationStatus !== 'verified') {
      throw new Error('Konto firmowe jest jeszcze w trakcie weryfikacji i nie może kupować żetonów.');
    }
  }
}

function buildInvoiceBuyerSnapshot(profile) {
  const isCompany = profile?.role === 'company';
  const name = isCompany
    ? normalizeText(profile.companyName || profile.displayName || 'Nabywca', 240)
    : normalizeText(
        [profile?.displayName].filter(Boolean).join(' ').trim() || profile?.email || 'Uzytkownik',
        240,
      );
  const addressFields = normalizeAddressFields(profile?.address);
  const address = formatAddressFromFields(addressFields);
  return {
    name,
    taxId: isCompany ? normalizeText(profile.nip, 20).replace(/\D/g, '').slice(0, 10) : '',
    address,
    addressFields,
    email: normalizeText(profile?.email || '', 180),
  };
}

function normalizeManualBuyerInput(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const addressFields = normalizeAddressFields(row.addressFields || row.address || row);
  return {
    name: normalizeText(row.name || '', 240),
    taxId: normalizeText(row.taxId || '', 20).replace(/\D/g, '').slice(0, 10),
    address: formatAddressFromFields(addressFields) || normalizeText(row.address || '', 320),
    addressFields,
    email: normalizeText(row.email || '', 180),
  };
}

function resolveInvoiceBuyerSnapshot(profile, rawBuyerInput) {
  const base = buildInvoiceBuyerSnapshot(profile);
  if (profile?.role === 'company') {
    if (!base.name || !base.address) {
      throw new Error('Uzupełnij dane firmy w profilu przed zakupem żetonów.');
    }
    return base;
  }

  const manual = normalizeManualBuyerInput(rawBuyerInput);
  const buyer = {
    name: manual.name || base.name,
    taxId: manual.taxId || '',
    address: manual.address || base.address,
    addressFields: {
      ...normalizeAddressFields(base.addressFields),
      ...normalizeAddressFields(manual.addressFields),
    },
    email: manual.email || base.email,
  };
  if (!buyer.name || !buyer.address) {
    throw new Error('Podaj imię i nazwisko oraz adres do dokumentu sprzedaży.');
  }
  return buyer;
}

async function getPromoCodeUsageForUser(db, code, uid) {
  const claimSnap = await db.collection(BAZAR_PROMO_CLAIMS).doc(getPromoClaimDocId(code, uid)).get();
  const row = claimSnap.exists ? claimSnap.data() || {} : {};
  return {
    count: Math.max(0, parseInt(row.count, 10) || 0),
    redemptions: Array.isArray(row.redemptions) ? row.redemptions : [],
    claimSnap,
  };
}

async function validatePromoCodeForUser(db, codeRaw, uid, options = {}) {
  const code = await getPromoCodeByCode(db, codeRaw);
  if (!code) {
    throw new Error('Podany kod promocyjny nie istnieje.');
  }
  if (code.active === false) {
    throw new Error('Ten kod promocyjny jest nieaktywny.');
  }
  if (!isPromoCodeTimeActive(code)) {
    throw new Error('Ten kod promocyjny nie jest aktualnie aktywny.');
  }
  if (code.maxTotalUses > 0 && Number(code.usageCount || 0) >= code.maxTotalUses) {
    throw new Error('Limit użyć tego kodu został wyczerpany.');
  }
  const usage = await getPromoCodeUsageForUser(db, code.code, uid);
  if (code.maxUsesPerUser > 0 && usage.count >= code.maxUsesPerUser) {
    throw new Error('Ten kod został już wykorzystany na tym koncie.');
  }

  const cfg = options.config || await getBazarCommerceConfig(db);
  const packages = cfg.packages.filter((pkg) => pkg.active !== false);
  const packagePreviews = packages.map((pkg) => buildPackagePreview(pkg, code.kind === 'discount' ? code.discountPercent : 0));
  const matchedPackage = options.packageId
    ? packagePreviews.find((pkg) => pkg.id === options.packageId)
    : null;
  if (options.packageId && !matchedPackage) {
    throw new Error('Wybrany pakiet żetonów nie istnieje lub jest wyłączony.');
  }
  return {
    code,
    usage,
    packages: packagePreviews,
    packagePreview: matchedPackage,
  };
}

async function listBazarPromoClaims(db, limitCount = 200) {
  const snapshot = await db
    .collection(BAZAR_PROMO_CLAIMS)
    .orderBy('updatedAt', 'desc')
    .limit(Math.max(1, Math.min(parseInt(limitCount, 10) || 200, 300)))
    .get();

  const rows = await Promise.all(snapshot.docs.map(async (docSnap) => {
    const data = docSnap.data() || {};
    const userId = normalizeText(data.userId || '', 120);
    const profile = userId ? await getDecodedUserProfile(db, userId).catch(() => null) : null;
    return {
      id: docSnap.id,
      code: normalizeText(data.code || '', 64),
      userId,
      userDisplayName: normalizeText(profile?.displayName || '', 120),
      userEmail: normalizeText(profile?.email || '', 180),
      count: Math.max(0, parseInt(data.count, 10) || 0),
      updatedAt: data.updatedAt || null,
      redemptions: Array.isArray(data.redemptions) ? data.redemptions.slice().reverse() : [],
    };
  }));

  return rows;
}

async function finalizePromoCodeUsage(db, payload) {
  const code = await getPromoCodeByCode(db, payload.code);
  if (!code) return null;
  const claimRef = db.collection(BAZAR_PROMO_CLAIMS).doc(getPromoClaimDocId(code.code, payload.userId));
  const codeRef = db.collection(BAZAR_PROMO_CODES).doc(code.code);
  const redemption = {
    kind: code.kind,
    usedAt: admin.firestore.Timestamp.now(),
    purchaseId: normalizeText(payload.purchaseId || '', 120),
    amountCents: Math.max(0, parseInt(payload.amountCents, 10) || 0),
    grantTokens: Math.max(0, parseInt(payload.grantTokens, 10) || 0),
  };
  await db.runTransaction(async (tx) => {
    const [claimSnap, codeSnap] = await Promise.all([tx.get(claimRef), tx.get(codeRef)]);
    const claim = claimSnap.exists ? claimSnap.data() || {} : {};
    const currentCode = codeSnap.exists ? codeSnap.data() || {} : {};
    tx.set(claimRef, {
      code: code.code,
      userId: normalizeText(payload.userId || '', 120),
      count: Math.max(0, parseInt(claim.count, 10) || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      redemptions: [...(Array.isArray(claim.redemptions) ? claim.redemptions.slice(-19) : []), redemption],
    }, { merge: true });
    tx.set(codeRef, {
      usageCount: Math.max(0, parseInt(currentCode.usageCount, 10) || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return code;
}

async function redeemGrantPromoCode(db, payload) {
  const uid = normalizeText(payload.userId || '', 120);
  const validated = await validatePromoCodeForUser(db, payload.code, uid, payload);
  const code = validated.code;
  if (code.kind !== 'grant') {
    throw new Error('Ten kod działa tylko jako rabat przy zakupie pakietu.');
  }
  const claimRef = db.collection(BAZAR_PROMO_CLAIMS).doc(getPromoClaimDocId(code.code, uid));
  const codeRef = db.collection(BAZAR_PROMO_CODES).doc(code.code);
  const now = admin.firestore.Timestamp.now();
  await db.runTransaction(async (tx) => {
    const [claimSnap, codeSnap] = await Promise.all([tx.get(claimRef), tx.get(codeRef)]);
    const claim = claimSnap.exists ? claimSnap.data() || {} : {};
    const currentCount = Math.max(0, parseInt(claim.count, 10) || 0);
    if (code.maxUsesPerUser > 0 && currentCount >= code.maxUsesPerUser) {
      throw new Error('Ten kod został już wykorzystany na tym koncie.');
    }
    const currentCode = codeSnap.exists ? codeSnap.data() || {} : {};
    const totalUsage = Math.max(0, parseInt(currentCode.usageCount, 10) || 0);
    if (code.maxTotalUses > 0 && totalUsage >= code.maxTotalUses) {
      throw new Error('Limit użyć tego kodu został wyczerpany.');
    }
    tx.set(claimRef, {
      code: code.code,
      userId: uid,
      count: currentCount + 1,
      updatedAt: now,
      redemptions: [
        ...(Array.isArray(claim.redemptions) ? claim.redemptions.slice(-19) : []),
        {
          kind: 'grant',
          usedAt: now,
          grantTokens: code.grantTokens,
        },
      ],
    }, { merge: true });
    tx.set(codeRef, {
      usageCount: totalUsage + 1,
      updatedAt: now,
    }, { merge: true });
  });

  const result = await grantTokens(db, {
    userId: uid,
    tokens: code.grantTokens,
    packageId: `promo_${code.code.toLowerCase()}`,
    packageLabel: `Kod promocyjny ${code.code}`,
    source: 'promo_grant',
    amountCents: 0,
    currency: 'pln',
    createdBy: normalizeText(payload.createdBy || uid, 120),
    validityDays: Math.max(1, parseInt(payload.validityDays, 10) || 365),
    reasonKey: 'promo_code_grant',
    reasonLabel: `Kod promocyjny: ${code.code}`,
    note: normalizeText(code.note || '', 400),
    extendActiveGrants: true,
  });
  return { code, grantResult: result };
}

async function listActiveTokenGrants(db, uid, nowTs) {
  const snapshot = await db
    .collection(BAZAR_TOKEN_GRANTS)
    .where('userId', '==', uid)
    .where('expiresAt', '>=', nowTs)
    .orderBy('expiresAt', 'asc')
    .limit(200)
    .get();
  return snapshot.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return Number(data.remainingTokens || 0) > 0;
  });
}

async function getUserTokenSummary(db, uid) {
  const walletSnap = await db.collection(BAZAR_TOKEN_WALLETS).doc(uid).get();
  const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
  const nowTs = admin.firestore.Timestamp.now();
  const activeGrants = await listActiveTokenGrants(db, uid, nowTs);
  let nextExpiryAt = null;
  let computedBalance = 0;
  activeGrants.forEach((docSnap) => {
    const row = docSnap.data() || {};
    computedBalance += Number(row.remainingTokens || 0);
    if (!nextExpiryAt) nextExpiryAt = row.expiresAt || null;
  });
  return {
    balance: computedBalance,
    purchasedTokens: Number(wallet.purchasedTokens || 0),
    usedTokens: Number(wallet.usedTokens || 0),
    nextExpiryAt,
    lastGrantedAt: wallet.lastGrantedAt || null,
    lastUsedAt: wallet.lastUsedAt || null,
    activeGrantCount: activeGrants.length,
    activeGrants: activeGrants.map((docSnap) => {
      const row = docSnap.data() || {};
      return {
        id: docSnap.id,
        packageId: normalizeText(row.packageId || '', 80),
        packageLabel: normalizeText(row.packageLabel || '', 160),
        remainingTokens: Number(row.remainingTokens || 0),
        totalTokens: Number(row.totalTokens || 0),
        expiresAt: row.expiresAt || null,
        purchaseId: normalizeText(row.purchaseId || '', 120),
        source: normalizeText(row.source || '', 40),
      };
    }),
  };
}

async function appendTokenLedgerEntry(db, entry) {
  await db.collection(BAZAR_TOKEN_LEDGER).add({
    ...entry,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function grantTokens(db, payload) {
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + Math.max(1, Number(payload.validityDays || 365)) * 24 * 60 * 60 * 1000,
  );
  const tokens = Math.max(1, parseInt(payload.tokens, 10) || 1);
  const grantRef = db.collection(BAZAR_TOKEN_GRANTS).doc();
  const walletRef = db.collection(BAZAR_TOKEN_WALLETS).doc(payload.userId);
  const extendActiveGrants = payload.extendActiveGrants === true || normalizeText(payload.source || '', 40) === 'purchase';
  const activeGrantsQuery = db
    .collection(BAZAR_TOKEN_GRANTS)
    .where('userId', '==', payload.userId)
    .where('expiresAt', '>=', now)
    .orderBy('expiresAt', 'asc')
    .limit(200);
  await db.runTransaction(async (tx) => {
    const [walletSnap, activeGrantSnap] = await Promise.all([
      tx.get(walletRef),
      extendActiveGrants ? tx.get(activeGrantsQuery) : Promise.resolve(null),
    ]);
    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
    if (extendActiveGrants && activeGrantSnap) {
      activeGrantSnap.docs.forEach((docSnap) => {
        const row = docSnap.data() || {};
        if (Number(row.remainingTokens || 0) > 0) {
          tx.update(docSnap.ref, {
            expiresAt,
            updatedAt: now,
          });
        }
      });
    }
    tx.set(grantRef, {
      userId: payload.userId,
      totalTokens: tokens,
      remainingTokens: tokens,
      expiresAt,
      packageId: normalizeText(payload.packageId || '', 80),
      packageLabel: normalizeText(payload.packageLabel || '', 160),
      purchaseId: normalizeText(payload.purchaseId || '', 120),
      source: normalizeText(payload.source || 'purchase', 40),
      amountCents: Math.max(0, parseInt(payload.amountCents, 10) || 0),
      currency: normalizeText(payload.currency || 'pln', 8).toLowerCase(),
      createdAt: now,
      createdBy: normalizeText(payload.createdBy || payload.userId || '', 120),
      note: normalizeText(payload.note || '', 400),
    });
    tx.set(
      walletRef,
      {
        userId: payload.userId,
        balance: Number(wallet.balance || 0) + tokens,
        purchasedTokens: Number(wallet.purchasedTokens || 0) + tokens,
        usedTokens: Number(wallet.usedTokens || 0),
        lastGrantedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await appendTokenLedgerEntry(db, {
    userId: payload.userId,
    type: 'grant',
    tokensDelta: tokens,
    reasonKey: normalizeText(payload.reasonKey || 'token_purchase', 80),
    reasonLabel: normalizeText(payload.reasonLabel || 'Zakup żetonów', 200),
    purchaseId: normalizeText(payload.purchaseId || '', 120),
    packageId: normalizeText(payload.packageId || '', 80),
    grantId: grantRef.id,
    amountCents: Math.max(0, parseInt(payload.amountCents, 10) || 0),
    currency: normalizeText(payload.currency || 'pln', 8).toLowerCase(),
    note: normalizeText(payload.note || '', 400),
    expiresAt,
  });

  return { grantId: grantRef.id, expiresAt };
}

async function consumeTokens(db, payload) {
  const uid = normalizeText(payload.userId || '', 120);
  const tokensNeeded = Math.max(1, parseInt(payload.tokens || 1, 10));
  const reasonKey = normalizeText(payload.reasonKey || 'token_spend', 80);
  const reasonLabel = normalizeText(payload.reasonLabel || 'Zużycie żetonów', 200);
  const nowTs = admin.firestore.Timestamp.now();
  const query = db
    .collection(BAZAR_TOKEN_GRANTS)
    .where('userId', '==', uid)
    .where('expiresAt', '>=', nowTs)
    .orderBy('expiresAt', 'asc')
    .limit(200);
  const walletRef = db.collection(BAZAR_TOKEN_WALLETS).doc(uid);
  let consumption = [];

  await db.runTransaction(async (tx) => {
    const [grantSnap, walletSnap] = await Promise.all([tx.get(query), tx.get(walletRef)]);
    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
    let remaining = tokensNeeded;
    consumption = [];
    grantSnap.docs.forEach((docSnap) => {
      if (remaining <= 0) return;
      const data = docSnap.data() || {};
      const available = Math.max(0, parseInt(data.remainingTokens, 10) || 0);
      if (!available) return;
      const take = Math.min(available, remaining);
      remaining -= take;
      consumption.push({
        grantRef: docSnap.ref,
        grantId: docSnap.id,
        take,
        packageId: normalizeText(data.packageId || '', 80),
      });
    });
    if (remaining > 0) {
      throw new Error('Brak wystarczającej liczby żetonów.');
    }
    consumption.forEach((row) => {
      tx.update(row.grantRef, {
        remainingTokens: admin.firestore.FieldValue.increment(-row.take),
        updatedAt: nowTs,
      });
    });
    tx.set(
      walletRef,
      {
        userId: uid,
        balance: Math.max(0, Number(wallet.balance || 0) - tokensNeeded),
        purchasedTokens: Number(wallet.purchasedTokens || 0),
        usedTokens: Number(wallet.usedTokens || 0) + tokensNeeded,
        lastUsedAt: nowTs,
        updatedAt: nowTs,
      },
      { merge: true },
    );
  });

  await appendTokenLedgerEntry(db, {
    userId: uid,
    type: 'consume',
    tokensDelta: -tokensNeeded,
    reasonKey,
    reasonLabel,
    purchaseId: normalizeText(payload.purchaseId || '', 120),
    offerId: normalizeText(payload.offerId || '', 120),
    note: normalizeText(payload.note || '', 400),
    consumption,
  });
  return { consumed: consumption, tokens: tokensNeeded };
}

async function listTokenHistory(db, uid, limitCount = 100) {
  const snapshot = await db
    .collection(BAZAR_TOKEN_LEDGER)
    .where('userId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(Math.max(1, Math.min(parseInt(limitCount, 10) || 100, 200)))
    .get();
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function createWebhookLog(db, payload) {
  const eventId = normalizeText(payload.eventId || '', 120);
  const ref = eventId ? db.collection(BAZAR_WEBHOOK_LOG).doc(eventId) : db.collection(BAZAR_WEBHOOK_LOG).doc();
  await ref.set(
    {
      eventId,
      type: normalizeText(payload.type || '', 120),
      purchaseId: normalizeText(payload.purchaseId || '', 120),
      status: normalizeText(payload.status || 'received', 32),
      message: normalizeText(payload.message || '', 1000),
      payloadSummary: payload.payloadSummary || {},
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: payload.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return ref.id;
}

function getStripeSecretKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    const err = new Error('Brak konfiguracji STRIPE_SECRET_KEY.');
    err.code = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }
  return key;
}

function getStripeWebhookSecret() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

let stripeClientCache = null;
function getStripeClient() {
  if (!stripeClientCache) {
    const Stripe = require('stripe');
    stripeClientCache = new Stripe(getStripeSecretKey());
  }
  return stripeClientCache;
}

function buildCheckoutUrls(purchaseId) {
  const baseUrl = getPublicBaseUrl();
  return {
    successUrl: `${baseUrl}/konto.strzelca.pl/profil.html?bazarPurchase=${encodeURIComponent(purchaseId)}&status=success`,
    cancelUrl: `${baseUrl}/konto.strzelca.pl/profil.html?bazarPurchase=${encodeURIComponent(purchaseId)}&status=cancel`,
  };
}

async function createTokenPurchaseCheckoutSession(db, payload) {
  const profile = await getDecodedUserProfile(db, payload.userId);
  assertProfileReadyForTokenPurchase(profile);
  const cfg = await getBazarCommerceConfig(db);
  const requestedTokens = Math.max(0, parseInt(payload.tokens, 10) || 0);
  const presetPkg = cfg.packages.find((item) => item.id === payload.packageId && item.active !== false);
  const finalTokens = presetPkg?.tokens || requestedTokens;
  if (!finalTokens) throw new Error('Wybierz liczbę żetonów.');
  if (finalTokens > cfg.tokenPricing.maxPurchaseQuantity) {
    throw new Error(`Maksymalnie możesz kupić ${cfg.tokenPricing.maxPurchaseQuantity} żetonów na raz.`);
  }
  const pricing = computeTokenPricingForQuantity(finalTokens, cfg.tokenPricing.tokenPriceCents);
  const pkg = {
    id: presetPkg?.id || buildTokenPackageId(finalTokens, !cfg.tokenPricing.presetQuantities.includes(finalTokens)),
    label: presetPkg?.label || buildTokenPackageLabel(finalTokens),
    tokens: finalTokens,
    priceCents: pricing.basePriceCents,
    effectivePriceCents: pricing.effectivePriceCents,
    pricePerTokenCents: pricing.pricePerTokenCents,
    discountPercent: pricing.discountPercent,
    active: true,
    isCustom: !cfg.tokenPricing.presetQuantities.includes(finalTokens),
  };
  if (payload.truthConfirmed !== true) {
    throw new Error('Potwierdź prawdziwość danych do dokumentu sprzedaży.');
  }

  const buyer = resolveInvoiceBuyerSnapshot(profile, payload.buyerInput);
  const promoCodeRaw = normalizeText(payload.promoCode || '', 64).toUpperCase();
  let promoCodeData = null;
  let effectivePriceCents = pkg.effectivePriceCents;
  if (promoCodeRaw) {
    const promoValidation = await validatePromoCodeForUser(db, promoCodeRaw, payload.userId, {
      packageId: pkg.id,
      config: cfg,
    });
    if (promoValidation.code.kind !== 'discount') {
      throw new Error('Ten kod nie obniża ceny pakietu. Użyj go jako kodu gratisowego do odbioru żetonów.');
    }
    promoCodeData = promoValidation.code;
    effectivePriceCents = promoValidation.packagePreview?.effectivePriceCents ?? pkg.priceCents;
  }

  const purchaseRef = db.collection(BAZAR_PURCHASES).doc();
  const now = admin.firestore.Timestamp.now();
  const record = {
    userId: payload.userId,
    status: 'checkout_created',
    packageId: pkg.id,
    packageLabel: pkg.label,
    tokens: pkg.tokens,
    amountCents: effectivePriceCents,
    baseAmountCents: pkg.priceCents,
    unitPriceCents: cfg.tokenPricing.tokenPriceCents,
    quantityDiscountPercent: pkg.discountPercent || 0,
    isCustomQuantity: pkg.isCustom === true,
    currency: cfg.currency,
    roleSnapshot: profile.role,
    companyVerificationStatus: profile.companyVerificationStatus,
    buyerSnapshot: buyer,
    createdAt: now,
    updatedAt: now,
    processingStatus: 'awaiting_payment',
    invoiceStatus: 'pending',
    emailStatus: 'pending',
    truthConfirmed: true,
    promoCode: promoCodeData
      ? {
          code: promoCodeData.code,
          kind: promoCodeData.kind,
          discountPercent: promoCodeData.discountPercent,
          note: promoCodeData.note,
        }
      : null,
  };
  await purchaseRef.set(record);

  const stripe = getStripeClient();
  const urls = buildCheckoutUrls(purchaseRef.id);
  const description = `${pkg.label} • Bazar STRZELCA.PL`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    customer_email: buyer.email || undefined,
    metadata: {
      purchaseId: purchaseRef.id,
      packageId: pkg.id,
      tokens: String(pkg.tokens),
      userId: payload.userId,
      promoCode: promoCodeData?.code || '',
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cfg.currency,
          unit_amount: effectivePriceCents,
          product_data: {
            name: `Żetony Bazaru: ${pkg.label}`,
            description: promoCodeData
              ? `${description} • kod ${promoCodeData.code} (-${promoCodeData.discountPercent}%)`
              : description,
          },
        },
      },
    ],
    billing_address_collection: 'required',
    allow_promotion_codes: false,
  });

  await purchaseRef.set(
    {
      stripeSessionId: session.id,
      stripeCheckoutUrl: session.url || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return {
    purchaseId: purchaseRef.id,
    url: session.url,
    sessionId: session.id,
    package: pkg,
  };
}

function isMajorOfferChange(existing, updates) {
  const normalizedExisting = {
    title: normalizeText(existing?.title || '', 200).toLowerCase(),
    category: normalizeText(existing?.category || '', 80),
    condition: normalizeText(existing?.condition || '', 40),
    description: normalizeText(existing?.description || '', 4000).toLowerCase(),
  };
  const normalizedUpdates = {
    title:
      updates.title !== undefined
        ? normalizeText(updates.title || '', 200).toLowerCase()
        : normalizedExisting.title,
    category:
      updates.category !== undefined
        ? normalizeText(updates.category || '', 80)
        : normalizedExisting.category,
    condition:
      updates.condition !== undefined
        ? normalizeText(updates.condition || '', 40)
        : normalizedExisting.condition,
    description:
      updates.description !== undefined
        ? normalizeText(updates.description || '', 4000).toLowerCase()
        : normalizedExisting.description,
  };
  return (
    normalizedExisting.title !== normalizedUpdates.title ||
    normalizedExisting.category !== normalizedUpdates.category ||
    normalizedExisting.condition !== normalizedUpdates.condition ||
    normalizedExisting.description !== normalizedUpdates.description
  );
}

function computePromotionState(data, nowMs = Date.now()) {
  const pinUntilMs = data?.pin_until?._seconds
    ? data.pin_until._seconds * 1000
    : data?.pin_until?.seconds
      ? data.pin_until.seconds * 1000
      : data?.pin_until?.toMillis
        ? data.pin_until.toMillis()
        : new Date(data?.pin_until || 0).getTime();
  const highlightUntilMs = data?.highlight_until?._seconds
    ? data.highlight_until._seconds * 1000
    : data?.highlight_until?.seconds
      ? data.highlight_until.seconds * 1000
      : data?.highlight_until?.toMillis
        ? data.highlight_until.toMillis()
        : new Date(data?.highlight_until || 0).getTime();
  const promotedUntilMs = data?.promoted_until?._seconds
    ? data.promoted_until._seconds * 1000
    : data?.promoted_until?.seconds
      ? data.promoted_until.seconds * 1000
      : data?.promoted_until?.toMillis
        ? data.promoted_until.toMillis()
        : new Date(data?.promoted_until || 0).getTime();
  return {
    pinActive: Boolean(data?.is_pinned) || (Number.isFinite(pinUntilMs) && pinUntilMs > nowMs),
    highlightActive: Number.isFinite(highlightUntilMs) && highlightUntilMs > nowMs,
    promotedActive: Number.isFinite(promotedUntilMs) && promotedUntilMs > nowMs,
  };
}

module.exports = {
  BAZAR_COMMERCE_SETTINGS_DOC,
  BAZAR_TOKEN_GRANTS,
  BAZAR_TOKEN_LEDGER,
  BAZAR_TOKEN_WALLETS,
  BAZAR_PURCHASES,
  BAZAR_REPORTS,
  BAZAR_WEBHOOK_LOG,
  BAZAR_PROMO_CODES,
  BAZAR_PROMO_CLAIMS,
  DEFAULT_BAZAR_COMMERCE_CONFIG,
  normalizeCommerceConfig,
  getBazarCommerceConfig,
  saveBazarCommerceConfig,
  getDecodedUserProfile,
  getCompanyVerificationLabel,
  buildInvoiceBuyerSnapshot,
  resolveInvoiceBuyerSnapshot,
  assertProfileReadyForTokenPurchase,
  validatePromoCodeForUser,
  redeemGrantPromoCode,
  listPromoCodes,
  savePromoCode,
  setPromoCodeStatus,
  listBazarPromoClaims,
  finalizePromoCodeUsage,
  getUserTokenSummary,
  listTokenHistory,
  grantTokens,
  consumeTokens,
  createWebhookLog,
  getStripeClient,
  getStripeWebhookSecret,
  createTokenPurchaseCheckoutSession,
  isMajorOfferChange,
  computePromotionState,
  getPublicBaseUrl,
};
