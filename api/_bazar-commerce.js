const { initAdmin, admin } = require('./_sso-utils');

const BAZAR_COMMERCE_SETTINGS_DOC = 'siteSettings/bazarCommerce';
const BAZAR_TOKEN_GRANTS = 'bazarTokenGrants';
const BAZAR_TOKEN_LEDGER = 'bazarTokenLedger';
const BAZAR_TOKEN_WALLETS = 'bazarTokenWallets';
const BAZAR_PURCHASES = 'bazarTokenPurchases';
const BAZAR_REPORTS = 'bazarOfferReports';
const BAZAR_WEBHOOK_LOG = 'bazarStripeWebhookLog';

const DEFAULT_BAZAR_COMMERCE_CONFIG = {
  version: 1,
  currency: 'pln',
  privateFreeActiveOffers: 5,
  privateFreeRefreshDays: 25,
  companyTokenValidityDays: 365,
  publicationDurationDays: 30,
  promotionDefaults: {
    pinDays: 7,
    highlightDays: 7,
  },
  packages: [
    { id: 'tokens_1', label: '1 token', tokens: 1, priceCents: 500, active: true },
    { id: 'tokens_10', label: '10 tokenow', tokens: 10, priceCents: 4000, active: true },
    { id: 'tokens_50', label: '50 tokenow', tokens: 50, priceCents: 15000, active: true },
    { id: 'tokens_100', label: '100 tokenow', tokens: 100, priceCents: 20000, active: true },
  ],
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
      durationDays: 7,
    },
    early_refresh: {
      label: 'Wczesniejsze odswiezenie oferty',
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
    'Duplikat ogloszenia',
    'Przedmiot niedozwolony',
    'Nielegalna czesc lub akcesorium',
    'Naruszenie regulaminu',
    'Falszywa firma',
    'Inne',
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
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

function normalizeAction(actionKey, row, fallback) {
  const src = row && typeof row === 'object' ? row : {};
  return {
    label: normalizeText(src.label || fallback?.label || actionKey, 160),
    tokenCost: Math.max(1, parseInt(src.tokenCost, 10) || fallback?.tokenCost || 1),
    active: src.active !== false,
    durationDays: Math.max(1, parseInt(src.durationDays, 10) || fallback?.durationDays || 7),
  };
}

function normalizeCommerceConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const defaults = clone(DEFAULT_BAZAR_COMMERCE_CONFIG);
  const packages = Array.isArray(cfg.packages) && cfg.packages.length
    ? cfg.packages.map(normalizePackage).filter((item) => item.id && item.tokens > 0)
    : defaults.packages;
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
    packages,
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
    throw new Error('Zakup tokenow jest dostepny dopiero po potwierdzeniu adresu e-mail.');
  }
  if (profile.role === 'company') {
    if (!profile.companyName || !profile.nip || !profile.address?.street || !profile.address?.city) {
      throw new Error('Uzupelnij dane firmy w profilu przed zakupem tokenow.');
    }
    if (profile.companyVerificationStatus !== 'verified') {
      throw new Error('Konto firmowe jest jeszcze w trakcie weryfikacji i nie moze kupowac tokenow.');
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
  const address = [
    normalizeText(profile?.address?.street, 120),
    normalizeText(profile?.address?.buildingNumber, 60),
    normalizeText(profile?.address?.postalCode, 40),
    normalizeText(profile?.address?.city, 120),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    name,
    taxId: isCompany ? normalizeText(profile.nip, 20).replace(/\D/g, '').slice(0, 10) : '',
    address,
    email: normalizeText(profile?.email || '', 180),
  };
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
  await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const wallet = walletSnap.exists ? walletSnap.data() || {} : {};
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
    reasonLabel: normalizeText(payload.reasonLabel || 'Zakup tokenow', 200),
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
  const reasonLabel = normalizeText(payload.reasonLabel || 'Zuzycie tokenow', 200);
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
      throw new Error('Brak wystarczajacej liczby tokenow.');
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
  const pkg = cfg.packages.find((item) => item.id === payload.packageId && item.active !== false);
  if (!pkg) {
    throw new Error('Wybrany pakiet tokenow nie istnieje lub jest wylaczony.');
  }
  if (payload.truthConfirmed !== true) {
    throw new Error('Potwierdz prawdziwosc danych do dokumentu sprzedazy.');
  }

  const buyer = buildInvoiceBuyerSnapshot(profile);
  if (!buyer.name || !buyer.address) {
    throw new Error('Uzupelnij dane nabywcy w profilu przed zakupem tokenow.');
  }

  const purchaseRef = db.collection(BAZAR_PURCHASES).doc();
  const now = admin.firestore.Timestamp.now();
  const record = {
    userId: payload.userId,
    status: 'checkout_created',
    packageId: pkg.id,
    packageLabel: pkg.label,
    tokens: pkg.tokens,
    amountCents: pkg.priceCents,
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
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cfg.currency,
          unit_amount: pkg.priceCents,
          product_data: {
            name: `Tokeny Bazaru: ${pkg.label}`,
            description,
          },
        },
      },
    ],
    billing_address_collection: 'required',
    allow_promotion_codes: false,
    consent_collection: {
      terms_of_service: 'required',
    },
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
  return {
    pinActive: Boolean(data?.is_pinned) || (Number.isFinite(pinUntilMs) && pinUntilMs > nowMs),
    highlightActive: Number.isFinite(highlightUntilMs) && highlightUntilMs > nowMs,
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
  DEFAULT_BAZAR_COMMERCE_CONFIG,
  normalizeCommerceConfig,
  getBazarCommerceConfig,
  saveBazarCommerceConfig,
  getDecodedUserProfile,
  getCompanyVerificationLabel,
  buildInvoiceBuyerSnapshot,
  assertProfileReadyForTokenPurchase,
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
