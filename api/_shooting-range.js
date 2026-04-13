const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { initAdmin, admin, getSessionUser, readJsonBody } = require('./_sso-utils');
const {
  getDecodedUserProfile,
  buildInvoiceBuyerSnapshot,
  consumeTokens,
  grantTokens,
  getUserTokenSummary,
} = require('./_bazar-commerce');
const { sendTransactionalEmail } = require('./_transactional-mail');
const {
  getUserRoleProfile,
  isAdminRoleProfile,
  canAccessBackofficeScope,
} = require('./_moderation');

const SITE_SETTINGS_COLLECTION = 'siteSettings';
const SHOOTING_RANGE_CONFIG_DOC = 'shootingRangeConfig';
const SHOOTING_PUBLIC_CACHE_DOC = 'shootingRangePublic';
const SHOOTING_RANGE_CONFIG_PATH = `${SITE_SETTINGS_COLLECTION}/${SHOOTING_RANGE_CONFIG_DOC}`;
const COLLECTIONS = {
  ranges: 'shootingRanges',
  lanes: 'shootingLanes',
  offers: 'shootingOffers',
  packages: 'shootingPackages',
  reservations: 'shootingReservations',
  blocks: 'shootingBlocks',
  instructors: 'shootingInstructors',
  availability: 'shootingInstructorAvailability',
  vouchers: 'shootingVouchers',
  voucherRedemptions: 'shootingVoucherRedemptions',
  policies: 'shootingPolicies',
  media: 'shootingMedia',
};
const RESERVATION_TYPES = new Set(['lane', 'training']);
const RESERVATION_STATUSES = new Set([
  'oczekuje_na_platnosc',
  'oczekuje_na_wizyte',
  'oplacona',
  'oplacona_zetonami',
  'platnosc_na_miejscu',
  'zrealizowana',
  'anulowana',
  'platnosc_niepowiodla_sie',
]);
const VOUCHER_STATUSES = new Set(['draft', 'awaiting_payment', 'aktywny', 'zrealizowany', 'anulowany', 'wygasl']);
const PAYMENT_METHODS = new Set(['hotpay', 'tokens', 'on_site']);
const HOTPAY_PAYMENT_URL = 'https://platnosc.hotpay.pl/';
const DEFAULT_TOKEN_VALUE = 1;
const RESERVATION_CANCEL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SLOT_MINUTES = 30;
const MIN_RESERVATION_MINUTES = 60;

function normalizeText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function slugify(value, maxLen = 80) {
  return normalizeText(value, maxLen)
    .toLowerCase()
    .replace(/[ąàáâãäå]/g, 'a')
    .replace(/[ćčç]/g, 'c')
    .replace(/[ęèéêë]/g, 'e')
    .replace(/[ł]/g, 'l')
    .replace(/[ńñ]/g, 'n')
    .replace(/[óòôõö]/g, 'o')
    .replace(/[śšş]/g, 's')
    .replace(/[żźž]/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

function formatMoney(value) {
  return Math.round((Math.max(0, Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value) {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

function startOfDay(dateInput) {
  const base = toDate(dateInput) || new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
}

function addMinutes(dateInput, minutes) {
  const d = toDate(dateInput) || new Date();
  return new Date(d.getTime() + minutes * 60 * 1000);
}

function formatDateTimeLabel(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateLabel(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function makeHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function makeVoucherCode() {
  const seed = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `STRZELNICA-${seed.slice(0, 4)}-${seed.slice(4, 8)}-${seed.slice(8, 12)}`;
}

function buildPublicBaseUrl() {
  const raw = String(
    process.env.PUBLIC_BASE_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      'https://strzelca.pl',
  ).trim();
  if (!raw) return 'https://strzelca.pl';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return `https://${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function buildSubdomainUrl(host) {
  return `${buildPublicBaseUrl().replace('https://strzelca.pl', `https://${host}`)}`;
}

function readPath(req) {
  const q = req.query && typeof req.query === 'object' ? req.query : {};
  const raw = Array.isArray(q.__path) ? q.__path[0] : q.__path;
  return String(raw || '').replace(/^\/+|\/+$/g, '');
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function ensureMethod(req, allowed) {
  if (!allowed.includes(req.method)) {
    const err = new Error('Nieobsługiwana metoda.');
    err.status = 405;
    throw err;
  }
}

function isReservationCancelable(reservation) {
  if (!reservation) return false;
  const startsAt = toDate(reservation.startsAt);
  if (!startsAt) return false;
  return startsAt.getTime() - Date.now() >= RESERVATION_CANCEL_WINDOW_MS;
}

function normalizeLane(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    rangeId: normalizeText(item.rangeId || 'main', 120),
    name: normalizeText(item.name || 'Oś', 160),
    slug: slugify(item.slug || item.name || id || 'os'),
    description: sanitizeHtml(item.description || ''),
    lengthMeters: Math.max(1, normalizeInteger(item.lengthMeters, 25)),
    positions: Math.max(1, normalizeInteger(item.positions, 1)),
    laneType: normalizeText(item.laneType || 'otwarta', 80),
    caliberInfo: normalizeText(item.caliberInfo || '', 160),
    isActive: item.isActive !== false,
    displayOrder: Math.max(0, normalizeInteger(item.displayOrder, 0)),
    pricePerHour: formatMoney(item.pricePerHour || 0),
    companyPricePerHour: formatMoney(item.companyPricePerHour || item.pricePerHour || 0),
    heroImage: normalizeText(item.heroImage || '', 4000),
    gallery: Array.isArray(item.gallery) ? item.gallery.map((entry) => normalizeText(entry, 4000)).filter(Boolean) : [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function normalizeOffer(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    rangeId: normalizeText(item.rangeId || 'main', 120),
    type: normalizeText(item.type || 'offer', 60),
    title: normalizeText(item.title || '', 180),
    subtitle: normalizeText(item.subtitle || '', 220),
    description: sanitizeHtml(item.description || ''),
    price: formatMoney(item.price || 0),
    companyPrice: formatMoney(item.companyPrice || item.price || 0),
    paymentMode: normalizeText(item.paymentMode || 'on_site', 40),
    durationMinutes: Math.max(30, normalizeInteger(item.durationMinutes, 60)),
    linkedLaneIds: Array.isArray(item.linkedLaneIds)
      ? item.linkedLaneIds.map((entry) => normalizeText(entry, 120)).filter(Boolean)
      : [],
    visible: item.visible !== false,
    displayOrder: Math.max(0, normalizeInteger(item.displayOrder, 0)),
    image: normalizeText(item.image || '', 4000),
  };
}

function normalizePackage(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    rangeId: normalizeText(item.rangeId || 'main', 120),
    title: normalizeText(item.title || '', 180),
    description: sanitizeHtml(item.description || ''),
    badge: normalizeText(item.badge || '', 120),
    price: formatMoney(item.price || 0),
    companyPrice: formatMoney(item.companyPrice || item.price || 0),
    durationMinutes: Math.max(30, normalizeInteger(item.durationMinutes, 60)),
    visible: item.visible !== false,
    image: normalizeText(item.image || '', 4000),
    includedWeapons: Array.isArray(item.includedWeapons)
      ? item.includedWeapons.map((entry) => normalizeText(entry, 120)).filter(Boolean)
      : [],
    linkedLaneIds: Array.isArray(item.linkedLaneIds)
      ? item.linkedLaneIds.map((entry) => normalizeText(entry, 120)).filter(Boolean)
      : [],
    displayOrder: Math.max(0, normalizeInteger(item.displayOrder, 0)),
  };
}

function normalizeInstructor(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    userId: normalizeText(item.userId || id || '', 120),
    displayName: normalizeText(item.displayName || '', 180),
    bio: sanitizeHtml(item.bio || ''),
    avatar: normalizeText(item.avatar || '', 4000),
    specialties: Array.isArray(item.specialties)
      ? item.specialties.map((entry) => normalizeText(entry, 120)).filter(Boolean)
      : [],
    active: item.active !== false,
    visible: item.visible !== false,
    displayOrder: Math.max(0, normalizeInteger(item.displayOrder, 0)),
  };
}

function normalizeAvailability(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    instructorId: normalizeText(item.instructorId || '', 120),
    startsAt: item.startsAt || null,
    endsAt: item.endsAt || null,
    status: normalizeText(item.status || 'available', 40),
    note: normalizeText(item.note || '', 240),
  };
}

function normalizeReservation(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  return {
    id: normalizeText(id || item.id || '', 120),
    reservationNumber: normalizeText(item.reservationNumber || '', 120),
    userId: normalizeText(item.userId || '', 120),
    rangeId: normalizeText(item.rangeId || 'main', 120),
    type: RESERVATION_TYPES.has(item.type) ? item.type : 'lane',
    status: RESERVATION_STATUSES.has(item.status) ? item.status : 'oczekuje_na_platnosc',
    paymentMethod: PAYMENT_METHODS.has(item.paymentMethod) ? item.paymentMethod : 'hotpay',
    startsAt: item.startsAt || null,
    endsAt: item.endsAt || null,
    laneId: normalizeText(item.laneId || '', 120),
    laneName: normalizeText(item.laneName || '', 180),
    instructorId: normalizeText(item.instructorId || '', 120),
    instructorName: normalizeText(item.instructorName || '', 180),
    packageId: normalizeText(item.packageId || '', 120),
    packageTitle: normalizeText(item.packageTitle || '', 180),
    personsCount: Math.max(1, normalizeInteger(item.personsCount, 1)),
    totalHours: Math.max(1, normalizeNumber(item.totalHours || 1, 1)),
    totalPrice: formatMoney(item.totalPrice || 0),
    tokenCost: Math.max(0, normalizeInteger(item.tokenCost, 0)),
    notes: normalizeText(item.notes || '', 1000),
    invoiceBuyerSnapshot: item.invoiceBuyerSnapshot || null,
    invoiceId: normalizeText(item.invoiceId || '', 120),
    paymentLinkUrl: normalizeText(item.paymentLinkUrl || '', 4000),
    hotpayPaymentId: normalizeText(item.hotpayPaymentId || '', 120),
    paymentStatus: normalizeText(item.paymentStatus || '', 40),
    requiresPolicyAcceptance: item.requiresPolicyAcceptance === true,
    policyAcceptedAt: item.policyAcceptedAt || null,
    declarations: item.declarations || {},
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    canceledAt: item.canceledAt || null,
  };
}

function normalizeVoucher(row, id = '') {
  const item = row && typeof row === 'object' ? row : {};
  const status = VOUCHER_STATUSES.has(item.status) ? item.status : 'draft';
  return {
    id: normalizeText(id || item.id || '', 120),
    code: normalizeText(item.code || '', 120).toUpperCase(),
    codeHash: normalizeText(item.codeHash || '', 120),
    buyerUserId: normalizeText(item.buyerUserId || '', 120),
    buyerEmail: normalizeText(item.buyerEmail || '', 180),
    buyerName: normalizeText(item.buyerName || '', 180),
    recipientName: normalizeText(item.recipientName || '', 180),
    message: normalizeText(item.message || '', 500),
    tokens: Math.max(1, normalizeInteger(item.tokens, 1)),
    amountCents: Math.max(0, normalizeInteger(item.amountCents, 0)),
    currency: normalizeText(item.currency || 'pln', 8).toLowerCase(),
    status,
    pdfFileName: normalizeText(item.pdfFileName || '', 180),
    pdfBase64: normalizeText(item.pdfBase64 || '', 2_000_000),
    paymentMethod: normalizeText(item.paymentMethod || 'hotpay', 40),
    paymentStatus: normalizeText(item.paymentStatus || '', 40),
    hotpayPaymentId: normalizeText(item.hotpayPaymentId || '', 120),
    redeemedByUserId: normalizeText(item.redeemedByUserId || '', 120),
    redeemedAt: item.redeemedAt || null,
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

const DEFAULT_CONFIG = {
  version: 1,
  rangeId: 'main',
  brandTitle: 'STRZELNICA STRZELCA',
  heroEyebrow: 'STRZELNICA OTWARTA',
  heroTitle: 'Wyjdź z obrazu. Wejdź na oś.',
  heroLead:
    'Nowoczesna strzelnica marki STRZELCA.PL. Rezerwacje online, szkolenia z instruktorem, vouchery żetonowe i premium doświadczenie od pierwszego scrolla.',
  heroPrimaryCtaLabel: 'Zarezerwuj termin',
  heroPrimaryCtaUrl: 'https://strzelnica.strzelca.pl/rezerwacja',
  heroSecondaryCtaLabel: 'Zobacz osie',
  heroSecondaryCtaUrl: '#osie',
  heroSceneImage: 'https://strzelca.pl/tlo:logo/tlo_compress.jpeg',
  heroSceneOverlayImage: '',
  heroBadge: 'Oś 25 m • szkolenia • vouchery',
  locationName: 'STRZELNICA STRZELCA',
  locationAddress: 'Adres do uzupełnienia w panelu administratora',
  locationMapEmbedUrl: '',
  locationLead: 'Dojazd i dane kontaktowe możesz edytować z panelu administratora.',
  contactEmail: 'kontakt@strzelca.pl',
  contactPhone: '',
  firstVisitHtml:
    '<p>Przy pierwszej rezerwacji pokażemy regulamin, zasady bezpieczeństwa i wszystkie wymagane oświadczenia.</p>',
  regulationsHtml:
    '<p>Regulamin strzelnicy zostanie opublikowany tutaj. Każda pierwsza rezerwacja wymaga jego akceptacji.</p>',
  faq: [
    {
      question: 'Jak działa rezerwacja osi?',
      answer:
        'Wybierasz konkretną oś, datę i przedział godzinowy. Sloty zaczynają się co 30 minut, a minimalny czas rezerwacji to jedna godzina.',
    },
    {
      question: 'Czy mogę zapłacić żetonami?',
      answer:
        'Tak. Rezerwacje osi możesz opłacić żetonami bazaru albo online przez HotPay. Szkolenia z instruktorem są oznaczone jako płatne na miejscu.',
    },
    {
      question: 'Czy mogę anulować rezerwację?',
      answer:
        'Tak, samodzielnie do 7 dni przed terminem. Później rezerwację może anulować tylko operator strzelnicy.',
    },
  ],
  homepageSections: [
    'hero',
    'oferta',
    'osie',
    'pakiety',
    'rezerwacja',
    'galeria',
    'pierwsza-wizyta',
    'regulaminy',
    'faq',
    'lokalizacja',
  ],
  gallery: [],
  tokenValue: DEFAULT_TOKEN_VALUE,
  hotpay: {
    enabled: false,
    secret: '',
    notificationHash: '',
    sellerSecret: '',
    serviceName: 'Strzelnica STRZELCA',
    returnUrl: 'https://strzelnica.strzelca.pl/rezerwacja',
    voucherReturnUrl: 'https://strzelnica.strzelca.pl/rezerwacja?voucher=1',
  },
  voucherValidityDays: 365,
};

async function getDb() {
  initAdmin();
  return admin.firestore();
}

async function getConfig(db) {
  const snap = await db.doc(SHOOTING_RANGE_CONFIG_PATH).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    ...DEFAULT_CONFIG,
    ...data,
    hotpay: {
      ...DEFAULT_CONFIG.hotpay,
      ...(data.hotpay && typeof data.hotpay === 'object' ? data.hotpay : {}),
    },
    faq: Array.isArray(data.faq) && data.faq.length
      ? data.faq.map((entry) => ({
          question: normalizeText(entry?.question || '', 240),
          answer: normalizeText(entry?.answer || '', 1200),
        })).filter((entry) => entry.question && entry.answer)
      : DEFAULT_CONFIG.faq,
    gallery: Array.isArray(data.gallery)
      ? data.gallery.map((entry) => normalizeText(entry, 4000)).filter(Boolean)
      : [],
  };
}

async function canManageShootingRange(uid) {
  if (!uid) return false;
  const db = await getDb();
  const profile = await getUserRoleProfile(db, uid);
  return isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, 'shootingRange');
}

async function canAccessInstructorPanel(uid) {
  if (!uid) return false;
  const db = await getDb();
  const profile = await getUserRoleProfile(db, uid);
  if (isAdminRoleProfile(profile) || canAccessBackofficeScope(profile, 'shootingRange')) return true;
  const userSnap = await db.collection('userProfiles').doc(uid).get();
  const role = normalizeText(userSnap.data()?.role || '', 40).toLowerCase();
  return role === 'instruktor';
}

async function listCollectionNormalized(db, collectionName, normalizer) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((docSnap) => normalizer(docSnap.data() || {}, docSnap.id));
}

async function getPublicData(db) {
  const [config, lanes, offers, packages, instructors] = await Promise.all([
    getConfig(db),
    listCollectionNormalized(db, COLLECTIONS.lanes, normalizeLane),
    listCollectionNormalized(db, COLLECTIONS.offers, normalizeOffer),
    listCollectionNormalized(db, COLLECTIONS.packages, normalizePackage),
    listCollectionNormalized(db, COLLECTIONS.instructors, normalizeInstructor),
  ]);
  return {
    config,
    lanes: lanes.filter((item) => item.isActive).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    offers: offers.filter((item) => item.visible).sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title)),
    packages: packages.filter((item) => item.visible).sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title)),
    instructors: instructors.filter((item) => item.active && item.visible).sort((a, b) => a.displayOrder - b.displayOrder || a.displayName.localeCompare(b.displayName)),
  };
}

async function bumpPublicCache(db) {
  await db.doc(`${SITE_SETTINGS_COLLECTION}/${SHOOTING_PUBLIC_CACHE_DOC}`).set(
    {
      v: admin.firestore.FieldValue.increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function generateReservationNumber(db) {
  const year = new Date().getFullYear();
  const counterRef = db.collection('systemCounters').doc(`shooting-reservations-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    let value = snap.exists ? normalizeInteger(snap.data()?.value, 0) : 0;
    value += 1;
    tx.set(counterRef, { value, updatedAt: serverTimestamp() }, { merge: true });
    return value;
  });
  return `${next}/${year}/STRZELNICA/STRZELCA.PL`;
}

function resolveCustomerPrice({ isCompany, lane, packageRow, type }) {
  if (type === 'lane' && lane) {
    return formatMoney(isCompany ? lane.companyPricePerHour : lane.pricePerHour);
  }
  if (packageRow) {
    return formatMoney(isCompany ? packageRow.companyPrice : packageRow.price);
  }
  return 0;
}

async function ensurePolicyAccepted(db, uid, acceptedNow) {
  const profileRef = db.collection('userProfiles').doc(uid);
  const snap = await profileRef.get();
  const alreadyAccepted = !!snap.data()?.shootingRangePolicyAcceptedAt;
  if (alreadyAccepted) {
    return snap.data()?.shootingRangePolicyAcceptedAt || null;
  }
  if (!acceptedNow) {
    const err = new Error('Pierwsza rezerwacja wymaga akceptacji regulaminu strzelnicy.');
    err.status = 400;
    throw err;
  }
  const ts = admin.firestore.Timestamp.now();
  await profileRef.set(
    {
      shootingRangePolicyAcceptedAt: ts,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return ts;
}

async function getUserBuyerSnapshot(db, uid, buyerInput) {
  const profile = await getDecodedUserProfile(db, uid);
  return {
    profile,
    invoiceBuyerSnapshot: buildInvoiceBuyerSnapshot(profile),
    buyerInput: buyerInput && typeof buyerInput === 'object' ? buyerInput : {},
  };
}

async function getReservationsForRangeOverlap(db, laneId, startsAt, endsAt, excludeReservationId = '') {
  const snap = await db
    .collection(COLLECTIONS.reservations)
    .where('laneId', '==', laneId)
    .where('status', 'in', ['oczekuje_na_platnosc', 'oczekuje_na_wizyte', 'oplacona', 'oplacona_zetonami', 'platnosc_na_miejscu'])
    .get();
  return snap.docs
    .map((docSnap) => normalizeReservation(docSnap.data() || {}, docSnap.id))
    .filter((item) => item.id !== excludeReservationId)
    .filter((item) => {
      const start = toDate(item.startsAt);
      const end = toDate(item.endsAt);
      return start && end && start < endsAt && end > startsAt;
    });
}

async function getLaneBlocksOverlap(db, laneId, startsAt, endsAt) {
  const snap = await db.collection(COLLECTIONS.blocks).where('laneId', '==', laneId).get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((item) => {
      const start = toDate(item.startsAt);
      const end = toDate(item.endsAt);
      return start && end && start < endsAt && end > startsAt;
    });
}

async function assertLaneAvailability(db, laneId, startsAt, endsAt, excludeReservationId = '') {
  const [overlaps, blocks] = await Promise.all([
    getReservationsForRangeOverlap(db, laneId, startsAt, endsAt, excludeReservationId),
    getLaneBlocksOverlap(db, laneId, startsAt, endsAt),
  ]);
  if (blocks.length) {
    const err = new Error('Wybrana oś jest zablokowana technicznie w tym terminie.');
    err.status = 409;
    throw err;
  }
  if (overlaps.length) {
    const err = new Error('Wybrany termin na tej osi jest już zajęty.');
    err.status = 409;
    throw err;
  }
}

async function listAvailableInstructors(db, startsAt, endsAt) {
  const [instructors, availabilityRows, reservations] = await Promise.all([
    listCollectionNormalized(db, COLLECTIONS.instructors, normalizeInstructor),
    listCollectionNormalized(db, COLLECTIONS.availability, normalizeAvailability),
    listCollectionNormalized(db, COLLECTIONS.reservations, normalizeReservation),
  ]);
  const blockedInstructorIds = new Set(
    reservations
      .filter((reservation) => reservation.type === 'training')
      .filter((reservation) => {
        const start = toDate(reservation.startsAt);
        const end = toDate(reservation.endsAt);
        return start && end && start < endsAt && end > startsAt;
      })
      .map((reservation) => reservation.instructorId)
      .filter(Boolean),
  );
  return instructors
    .filter((instructor) => instructor.active)
    .filter((instructor) => !blockedInstructorIds.has(instructor.userId))
    .filter((instructor) => {
      const relevant = availabilityRows.filter((row) => row.instructorId === instructor.userId);
      if (!relevant.length) return false;
      return relevant.some((row) => {
        const start = toDate(row.startsAt);
        const end = toDate(row.endsAt);
        return row.status === 'available' && start && end && start <= startsAt && end >= endsAt;
      });
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.displayName.localeCompare(b.displayName));
}

function buildHotPayFields({
  amountCents,
  orderId,
  customerEmail,
  customerName,
  serviceName,
  returnUrl,
  config,
}) {
  if (!config?.hotpay?.enabled || !config.hotpay.sellerSecret) {
    const err = new Error('HotPay nie jest jeszcze skonfigurowany.');
    err.status = 400;
    throw err;
  }
  const amount = formatMoney((amountCents || 0) / 100).toFixed(2);
  return {
    action: HOTPAY_PAYMENT_URL,
    method: 'POST',
    fields: {
      SEKRET: String(config.hotpay.sellerSecret || '').trim(),
      KWOTA: amount,
      NAZWA_USLUGI: normalizeText(serviceName || config.hotpay.serviceName || 'Strzelnica STRZELCA', 100),
      ADRES_WWW: normalizeText(returnUrl || config.hotpay.returnUrl || 'https://strzelnica.strzelca.pl/rezerwacja', 300),
      ID_ZAMOWIENIA: normalizeText(orderId, 64),
      EMAIL: normalizeText(customerEmail || '', 180),
      DANE_OSOBOWE: normalizeText(customerName || '', 180),
    },
  };
}

async function createReservation(db, user, payload) {
  const type = RESERVATION_TYPES.has(payload?.type) ? payload.type : 'lane';
  const laneId = normalizeText(payload?.laneId || '', 120);
  const packageId = normalizeText(payload?.packageId || '', 120);
  const instructorId = normalizeText(payload?.instructorId || '', 120);
  const startsAt = toDate(payload?.startsAt);
  const endsAt = toDate(payload?.endsAt);
  const paymentMethod = PAYMENT_METHODS.has(payload?.paymentMethod) ? payload.paymentMethod : (type === 'training' ? 'on_site' : 'hotpay');
  const personsCount = Math.max(1, normalizeInteger(payload?.personsCount, 1));
  const declarations = payload?.declarations && typeof payload.declarations === 'object' ? payload.declarations : {};

  if (!startsAt || !endsAt || endsAt <= startsAt) {
    const err = new Error('Nieprawidłowy zakres czasu rezerwacji.');
    err.status = 400;
    throw err;
  }
  const totalMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / (60 * 1000));
  if (totalMinutes < MIN_RESERVATION_MINUTES || totalMinutes % SLOT_MINUTES !== 0) {
    const err = new Error('Minimalny czas rezerwacji to 1 godzina, a sloty zaczynają się co 30 minut.');
    err.status = 400;
    throw err;
  }
  if (!laneId) {
    const err = new Error('Wybierz oś.');
    err.status = 400;
    throw err;
  }

  const [publicData, buyerData, policyAcceptedAt] = await Promise.all([
    getPublicData(db),
    getUserBuyerSnapshot(db, user.uid, payload?.buyerInput),
    ensurePolicyAccepted(db, user.uid, payload?.policyAccepted === true),
  ]);
  const lane = publicData.lanes.find((item) => item.id === laneId);
  if (!lane) {
    const err = new Error('Nie znaleziono wybranej osi.');
    err.status = 404;
    throw err;
  }
  const packageRow = packageId ? publicData.packages.find((item) => item.id === packageId) : null;
  const isCompany = buyerData.profile?.role === 'company';
  const unitPrice = resolveCustomerPrice({ isCompany, lane, packageRow, type });
  const totalHours = totalMinutes / 60;
  const basePrice = type === 'training' && packageRow ? unitPrice : unitPrice * totalHours;
  const totalPrice = formatMoney(basePrice);
  const config = publicData.config;
  const tokenValue = Math.max(0.01, formatMoney(config.tokenValue || DEFAULT_TOKEN_VALUE));
  const tokenCost = Math.max(0, Math.ceil(totalPrice / tokenValue));

  if (type === 'lane') {
    if (declarations.isAdult !== true || declarations.hasRangeOfficerPermission !== true) {
      const err = new Error('Rezerwacja osi wymaga potwierdzenia pełnoletności i uprawnień prowadzącego strzelanie.');
      err.status = 400;
      throw err;
    }
  }

  if (type === 'training') {
    if (!packageRow) {
      const err = new Error('Wybierz pakiet lub szkolenie z instruktorem.');
      err.status = 400;
      throw err;
    }
    if (!instructorId) {
      const err = new Error('Wybierz instruktora.');
      err.status = 400;
      throw err;
    }
    const availableInstructors = await listAvailableInstructors(db, startsAt, endsAt);
    if (!availableInstructors.find((item) => item.userId === instructorId)) {
      const err = new Error('Wybrany instruktor nie jest dostępny w tym terminie.');
      err.status = 409;
      throw err;
    }
  }

  await assertLaneAvailability(db, laneId, startsAt, endsAt);
  const reservationNumber = await generateReservationNumber(db);
  const reservationRef = db.collection(COLLECTIONS.reservations).doc();
  const createdAt = admin.firestore.Timestamp.now();
  const status =
    paymentMethod === 'on_site'
      ? 'platnosc_na_miejscu'
      : paymentMethod === 'tokens'
        ? 'oplacona_zetonami'
        : 'oczekuje_na_platnosc';

  if (paymentMethod === 'tokens') {
    await consumeTokens(db, {
      userId: user.uid,
      tokens: tokenCost,
      reasonKey: 'shooting_range_reservation',
      reasonLabel: `Rezerwacja strzelnicy ${reservationNumber}`,
      purchaseId: reservationRef.id,
      note: `Rezerwacja ${lane.name} (${formatDateTimeLabel(startsAt)})`,
    });
  }

  const instructor = publicData.instructors.find((item) => item.userId === instructorId);
  const reservationRecord = {
    reservationNumber,
    userId: user.uid,
    rangeId: config.rangeId || 'main',
    type,
    status,
    paymentMethod,
    startsAt: admin.firestore.Timestamp.fromDate(startsAt),
    endsAt: admin.firestore.Timestamp.fromDate(endsAt),
    laneId: lane.id,
    laneName: lane.name,
    instructorId: instructor ? instructor.userId : '',
    instructorName: instructor ? instructor.displayName : '',
    packageId: packageRow ? packageRow.id : '',
    packageTitle: packageRow ? packageRow.title : '',
    personsCount,
    totalHours,
    totalPrice,
    tokenCost,
    notes: normalizeText(payload?.notes || '', 1000),
    invoiceBuyerSnapshot: buyerData.invoiceBuyerSnapshot,
    invoiceId: '',
    paymentLinkUrl: '',
    hotpayPaymentId: '',
    paymentStatus: paymentMethod === 'hotpay' ? 'pending' : paymentMethod === 'tokens' ? 'success' : 'on_site',
    requiresPolicyAcceptance: true,
    policyAcceptedAt,
    declarations: {
      isAdult: declarations.isAdult === true,
      hasRangeOfficerPermission: declarations.hasRangeOfficerPermission === true,
    },
    createdAt,
    updatedAt: createdAt,
  };
  await reservationRef.set(reservationRecord);

  let hotpay = null;
  if (paymentMethod === 'hotpay') {
    hotpay = buildHotPayFields({
      amountCents: Math.round(totalPrice * 100),
      orderId: reservationRef.id,
      customerEmail: buyerData.profile?.email || '',
      customerName: buyerData.invoiceBuyerSnapshot?.name || '',
      serviceName: `Rezerwacja strzelnicy ${reservationNumber}`,
      returnUrl: `${buildSubdomainUrl('strzelnica.strzelca.pl')}/rezerwacja?reservation=${encodeURIComponent(reservationRef.id)}`,
      config,
    });
  }

  await sendReservationEmail({
    reservation: { id: reservationRef.id, ...reservationRecord },
    email: buyerData.profile?.email || buyerData.invoiceBuyerSnapshot?.email || '',
    config,
  }).catch((error) => {
    console.warn('sendReservationEmail:', error?.message || error);
  });

  return {
    id: reservationRef.id,
    ...normalizeReservation(reservationRecord, reservationRef.id),
    hotpay,
  };
}

async function sendReservationEmail({ reservation, email, config }) {
  if (!email) return;
  const title = reservation.type === 'training' ? 'Rezerwacja szkolenia' : 'Rezerwacja osi';
  const paymentRow =
    reservation.paymentMethod === 'on_site'
      ? '<p>Płatność: <strong>na miejscu</strong>.</p>'
      : reservation.paymentMethod === 'tokens'
        ? `<p>Płatność: <strong>żetony</strong> (${reservation.tokenCost}).</p>`
        : `<p>Płatność: <strong>HotPay</strong>. Po opłaceniu webhook oznaczy rezerwację jako opłaconą.</p>`;
  await sendTransactionalEmail({
    to: email,
    subject: `Potwierdzenie rezerwacji ${reservation.reservationNumber}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2 style="color:#c19a6b;">${title} w STRZELNICY STRZELCA</h2>
        <p>Dziękujemy. Rezerwacja została zapisana pod numerem <strong>${reservation.reservationNumber}</strong>.</p>
        <p>Termin: <strong>${formatDateTimeLabel(reservation.startsAt)}</strong> - <strong>${formatDateTimeLabel(reservation.endsAt)}</strong></p>
        <p>Oś: <strong>${reservation.laneName}</strong></p>
        ${reservation.instructorName ? `<p>Instruktor: <strong>${reservation.instructorName}</strong></p>` : ''}
        ${paymentRow}
        <p>Adres: ${config.locationAddress || 'Do uzupełnienia w panelu.'}</p>
      </div>
    `,
    logCategory: 'shooting_range_reservation',
    logMeta: { reservationId: reservation.id },
  });
}

async function sendVoucherEmail({ voucher, email }) {
  if (!email) return;
  await sendTransactionalEmail({
    to: email,
    subject: `Voucher STRZELNICY STRZELCA: ${voucher.tokens} żetonów`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2 style="color:#c19a6b;">Voucher STRZELNICY STRZELCA</h2>
        <p>Twój voucher został aktywowany.</p>
        <p><strong>Kod:</strong> ${voucher.code}</p>
        <p><strong>Liczba żetonów:</strong> ${voucher.tokens}</p>
        <p>Możesz pobrać certyfikat PDF z poziomu swojego panelu lub zrealizować kod po zalogowaniu.</p>
      </div>
    `,
    logCategory: 'shooting_range_voucher',
    logMeta: { voucherId: voucher.id },
    attachments: voucher.pdfBase64
      ? [{
          filename: voucher.pdfFileName || `voucher-${voucher.code}.pdf`,
          content: Buffer.from(voucher.pdfBase64, 'base64'),
          contentType: 'application/pdf',
        }]
      : undefined,
  });
}

function generateVoucherPdfBuffer(voucher, config) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, right: 48, bottom: 48, left: 48 },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0b0b0b');
    doc
      .fillColor('#c19a6b')
      .fontSize(14)
      .text('STRZELNICA OTWARTA', 48, 56, { align: 'left' });
    doc
      .fillColor('#ffffff')
      .fontSize(34)
      .text('Voucher STRZELNICY STRZELCA', 48, 86, { width: 500 });
    doc
      .fillColor('#d4d4d4')
      .fontSize(14)
      .text(
        'Autorski voucher żetonowy do wykorzystania na rezerwacje osi i oferty strzeleckie w ekosystemie STRZELCA.PL.',
        48,
        150,
        { width: 500, lineGap: 4 },
      );
    doc.roundedRect(48, 220, 500, 210, 18).strokeColor('#c19a6b').lineWidth(1.2).stroke();
    doc
      .fillColor('#ffffff')
      .fontSize(20)
      .text(`${voucher.tokens} żetonów`, 72, 254);
    doc
      .fillColor('#c19a6b')
      .fontSize(13)
      .text(`Kod: ${voucher.code}`, 72, 294);
    doc
      .fillColor('#ffffff')
      .fontSize(12)
      .text(`Dla: ${voucher.recipientName || 'Dowolna osoba'}`, 72, 332);
    if (voucher.message) {
      doc
        .fillColor('#d4d4d4')
        .fontSize(11)
        .text(`Wiadomość: ${voucher.message}`, 72, 364, { width: 450 });
    }
    doc
      .fillColor('#d4d4d4')
      .fontSize(11)
      .text(`Ważny do: ${formatDateLabel(voucher.expiresAt)}`, 72, 402);
    doc
      .fillColor('#8b8b8b')
      .fontSize(10)
      .text(
        `Realizacja po zalogowaniu na https://strzelnica.strzelca.pl/rezerwacja. Operator: ${config.locationName || 'STRZELNICA STRZELCA'}.`,
        48,
        760,
        { width: 500, align: 'center' },
      );
    doc.end();
  });
}

async function createVoucherPurchase(db, user, payload) {
  const tokens = Math.max(1, normalizeInteger(payload?.tokens, 1));
  const config = await getConfig(db);
  const tokenValue = Math.max(0.01, formatMoney(config.tokenValue || DEFAULT_TOKEN_VALUE));
  const amountCents = Math.round(tokens * tokenValue * 100);
  const profile = await getDecodedUserProfile(db, user.uid);
  const voucherRef = db.collection(COLLECTIONS.vouchers).doc();
  const createdAt = admin.firestore.Timestamp.now();
  const voucher = {
    buyerUserId: user.uid,
    buyerEmail: normalizeText(profile.email || '', 180),
    buyerName: normalizeText(profile.displayName || profile.companyName || '', 180),
    recipientName: normalizeText(payload?.recipientName || '', 180),
    message: normalizeText(payload?.message || '', 500),
    tokens,
    amountCents,
    currency: 'pln',
    code: makeVoucherCode(),
    codeHash: '',
    status: 'awaiting_payment',
    pdfFileName: '',
    pdfBase64: '',
    paymentMethod: 'hotpay',
    paymentStatus: 'pending',
    hotpayPaymentId: '',
    redeemedByUserId: '',
    redeemedAt: null,
    expiresAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + Math.max(1, normalizeInteger(config.voucherValidityDays, 365)) * 24 * 60 * 60 * 1000),
    ),
    createdAt,
    updatedAt: createdAt,
  };
  voucher.codeHash = makeHash(voucher.code);
  const pdfBuffer = await generateVoucherPdfBuffer(voucher, config);
  voucher.pdfBase64 = pdfBuffer.toString('base64');
  voucher.pdfFileName = `voucher-${slugify(voucher.recipientName || voucher.code, 40) || voucher.id || 'strzelnica'}.pdf`;
  await voucherRef.set(voucher);
  const hotpay = buildHotPayFields({
    amountCents,
    orderId: `voucher:${voucherRef.id}`,
    customerEmail: profile.email || '',
    customerName: voucher.buyerName || '',
    serviceName: `Voucher ${tokens} żetonów STRZELNICA`,
    returnUrl: `${buildSubdomainUrl('strzelnica.strzelca.pl')}/rezerwacja?voucher=${encodeURIComponent(voucherRef.id)}`,
    config,
  });
  return {
    id: voucherRef.id,
    ...normalizeVoucher(voucher, voucherRef.id),
    hotpay,
  };
}

async function activateVoucherAfterPayment(db, voucherId, hotpayPaymentId = '') {
  const ref = db.collection(COLLECTIONS.vouchers).doc(voucherId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Voucher nie istnieje.');
  const voucher = normalizeVoucher(snap.data() || {}, snap.id);
  if (voucher.status === 'aktywny') return voucher;
  const updated = {
    status: 'aktywny',
    paymentStatus: 'success',
    hotpayPaymentId: normalizeText(hotpayPaymentId || voucher.hotpayPaymentId || '', 120),
    updatedAt: serverTimestamp(),
  };
  await ref.set(updated, { merge: true });
  const full = { ...voucher, ...updated, id: ref.id };
  await sendVoucherEmail({ voucher: full, email: voucher.buyerEmail }).catch((error) => {
    console.warn('sendVoucherEmail:', error?.message || error);
  });
  return full;
}

async function redeemVoucher(db, user, payload) {
  const code = normalizeText(payload?.code || '', 120).toUpperCase();
  if (!code) {
    const err = new Error('Podaj kod vouchera.');
    err.status = 400;
    throw err;
  }
  const snap = await db.collection(COLLECTIONS.vouchers).where('codeHash', '==', makeHash(code)).limit(1).get();
  if (snap.empty) {
    const err = new Error('Nie znaleziono vouchera o podanym kodzie.');
    err.status = 404;
    throw err;
  }
  const docSnap = snap.docs[0];
  const voucher = normalizeVoucher(docSnap.data() || {}, docSnap.id);
  if (voucher.code !== code) {
    const err = new Error('Nieprawidłowy kod vouchera.');
    err.status = 404;
    throw err;
  }
  if (voucher.status !== 'aktywny') {
    const err = new Error('Ten voucher nie jest aktywny.');
    err.status = 400;
    throw err;
  }
  if (voucher.redeemedByUserId) {
    const err = new Error('Ten voucher został już zrealizowany.');
    err.status = 409;
    throw err;
  }
  const now = admin.firestore.Timestamp.now();
  await grantTokens(db, {
    userId: user.uid,
    tokens: voucher.tokens,
    packageId: `voucher_${docSnap.id}`,
    packageLabel: `Voucher STRZELNICA ${voucher.tokens} żetonów`,
    source: 'shooting_range_voucher',
    amountCents: 0,
    currency: 'pln',
    createdBy: user.uid,
    validityDays: Math.max(1, Math.ceil((toDate(voucher.expiresAt)?.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) || 365),
    reasonKey: 'shooting_range_voucher',
    reasonLabel: `Voucher STRZELNICA ${voucher.code}`,
    note: `Realizacja vouchera ${voucher.code}`,
    extendActiveGrants: true,
  });
  await docSnap.ref.set(
    {
      status: 'zrealizowany',
      redeemedByUserId: user.uid,
      redeemedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await db.collection(COLLECTIONS.voucherRedemptions).add({
    voucherId: docSnap.id,
    code: voucher.code,
    userId: user.uid,
    tokens: voucher.tokens,
    createdAt: now,
  });
  const summary = await getUserTokenSummary(db, user.uid);
  return { success: true, voucherId: docSnap.id, tokens: voucher.tokens, tokenSummary: summary };
}

async function listMyReservations(db, uid) {
  const snap = await db.collection(COLLECTIONS.reservations).where('userId', '==', uid).get();
  return snap.docs
    .map((docSnap) => normalizeReservation(docSnap.data() || {}, docSnap.id))
    .sort((a, b) => (toDate(b.startsAt)?.getTime() || 0) - (toDate(a.startsAt)?.getTime() || 0));
}

async function cancelReservation(db, user, reservationId) {
  const ref = db.collection(COLLECTIONS.reservations).doc(normalizeText(reservationId, 120));
  const snap = await ref.get();
  if (!snap.exists) {
    const err = new Error('Nie znaleziono rezerwacji.');
    err.status = 404;
    throw err;
  }
  const reservation = normalizeReservation(snap.data() || {}, snap.id);
  const manager = await canManageShootingRange(user.uid);
  if (reservation.userId !== user.uid && !manager) {
    const err = new Error('Brak uprawnień do anulowania tej rezerwacji.');
    err.status = 403;
    throw err;
  }
  if (!manager && !isReservationCancelable(reservation)) {
    const err = new Error('Samodzielne anulowanie jest możliwe tylko do 7 dni przed terminem.');
    err.status = 400;
    throw err;
  }
  await ref.set(
    {
      status: 'anulowana',
      canceledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { success: true, id: reservation.id };
}

async function getAvailabilityForDay(db, query) {
  const laneId = normalizeText(query?.laneId || '', 120);
  const date = normalizeText(query?.date || '', 32);
  const reservationType = RESERVATION_TYPES.has(query?.type) ? query.type : 'lane';
  const instructorMode = reservationType === 'training';
  const targetDay = startOfDay(date ? `${date}T00:00:00.000Z` : new Date());
  const slots = [];
  for (let index = 18; index < 44; index++) {
    const slotStart = addMinutes(targetDay, index * SLOT_MINUTES);
    const slotEnd = addMinutes(slotStart, MIN_RESERVATION_MINUTES);
    if (slotStart < new Date()) continue;
    let available = true;
    try {
      await assertLaneAvailability(db, laneId, slotStart, slotEnd);
    } catch (_) {
      available = false;
    }
    let instructors = [];
    if (available && instructorMode) {
      instructors = await listAvailableInstructors(db, slotStart, slotEnd);
      if (!instructors.length) available = false;
    }
    slots.push({
      startsAt: slotStart.toISOString(),
      endsAt: slotEnd.toISOString(),
      available,
      instructors: instructors.map((item) => ({
        id: item.userId,
        displayName: item.displayName,
        specialties: item.specialties,
      })),
    });
  }
  return slots;
}

async function getInstructorPanelData(db, uid) {
  const allowed = await canAccessInstructorPanel(uid);
  if (!allowed) {
    const err = new Error('Brak dostępu do panelu instruktora.');
    err.status = 403;
    throw err;
  }
  const manager = await canManageShootingRange(uid);
  const [instructors, availability, reservations] = await Promise.all([
    listCollectionNormalized(db, COLLECTIONS.instructors, normalizeInstructor),
    listCollectionNormalized(db, COLLECTIONS.availability, normalizeAvailability),
    listCollectionNormalized(db, COLLECTIONS.reservations, normalizeReservation),
  ]);
  const visibleInstructorIds = manager
    ? instructors.map((item) => item.userId)
    : [uid];
  return {
    instructors: instructors.filter((item) => visibleInstructorIds.includes(item.userId)),
    availability: availability.filter((item) => visibleInstructorIds.includes(item.instructorId)),
    reservations: reservations.filter((item) => item.instructorId && visibleInstructorIds.includes(item.instructorId)),
    manager,
  };
}

async function saveInstructorAvailability(db, user, payload) {
  const instructorId = normalizeText(payload?.instructorId || user.uid, 120);
  const startsAt = toDate(payload?.startsAt);
  const endsAt = toDate(payload?.endsAt);
  const status = normalizeText(payload?.status || 'available', 40);
  const note = normalizeText(payload?.note || '', 240);
  const manager = await canManageShootingRange(user.uid);
  if (!manager && instructorId !== user.uid) {
    const err = new Error('Możesz zarządzać tylko własną dyspozycyjnością.');
    err.status = 403;
    throw err;
  }
  if (!startsAt || !endsAt || endsAt <= startsAt) {
    const err = new Error('Nieprawidłowy zakres dostępności.');
    err.status = 400;
    throw err;
  }
  const ref = db.collection(COLLECTIONS.availability).doc();
  await ref.set({
    instructorId,
    startsAt: admin.firestore.Timestamp.fromDate(startsAt),
    endsAt: admin.firestore.Timestamp.fromDate(endsAt),
    status,
    note,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { success: true, id: ref.id };
}

async function saveConfig(db, user, payload) {
  if (!(await canManageShootingRange(user.uid))) {
    const err = new Error('Brak uprawnień do konfiguracji strzelnicy.');
    err.status = 403;
    throw err;
  }
  const current = await getConfig(db);
  const next = {
    ...current,
    ...payload,
    tokenValue: Math.max(0.01, formatMoney(payload?.tokenValue ?? current.tokenValue ?? DEFAULT_TOKEN_VALUE)),
    faq: Array.isArray(payload?.faq)
      ? payload.faq.map((entry) => ({
          question: normalizeText(entry?.question || '', 240),
          answer: normalizeText(entry?.answer || '', 1200),
        })).filter((entry) => entry.question && entry.answer)
      : current.faq,
    gallery: Array.isArray(payload?.gallery)
      ? payload.gallery.map((entry) => normalizeText(entry, 4000)).filter(Boolean)
      : current.gallery,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  await db.doc(SHOOTING_RANGE_CONFIG_PATH).set(next, { merge: true });
  await bumpPublicCache(db);
  return next;
}

async function saveEntity(db, user, entityType, payload) {
  if (!(await canManageShootingRange(user.uid))) {
    const err = new Error('Brak uprawnień do zarządzania danymi strzelnicy.');
    err.status = 403;
    throw err;
  }
  const mapping = {
    lane: { collection: COLLECTIONS.lanes, normalizer: normalizeLane },
    offer: { collection: COLLECTIONS.offers, normalizer: normalizeOffer },
    package: { collection: COLLECTIONS.packages, normalizer: normalizePackage },
    instructor: { collection: COLLECTIONS.instructors, normalizer: normalizeInstructor },
    block: { collection: COLLECTIONS.blocks, normalizer: (row, id) => ({ id, ...(row || {}) }) },
  };
  const entry = mapping[entityType];
  if (!entry) {
    const err = new Error('Nieobsługiwany typ encji.');
    err.status = 400;
    throw err;
  }
  const ref = payload?.id
    ? db.collection(entry.collection).doc(normalizeText(payload.id, 120))
    : db.collection(entry.collection).doc();
  const normalized = entry.normalizer(payload, ref.id);
  await ref.set({
    ...normalized,
    updatedAt: serverTimestamp(),
    createdAt: payload?.id ? payload.createdAt || serverTimestamp() : serverTimestamp(),
  }, { merge: true });
  await bumpPublicCache(db);
  return normalized;
}

async function saveReservationAdmin(db, user, payload) {
  if (!(await canManageShootingRange(user.uid))) {
    const err = new Error('Brak uprawnień do edycji rezerwacji.');
    err.status = 403;
    throw err;
  }
  const reservationId = normalizeText(payload?.id || '', 120);
  if (!reservationId) {
    const err = new Error('Brak ID rezerwacji.');
    err.status = 400;
    throw err;
  }
  const patch = {};
  if (payload.status && RESERVATION_STATUSES.has(payload.status)) patch.status = payload.status;
  if (payload.invoiceId !== undefined) patch.invoiceId = normalizeText(payload.invoiceId || '', 120);
  if (payload.paymentLinkUrl !== undefined) patch.paymentLinkUrl = normalizeText(payload.paymentLinkUrl || '', 4000);
  if (payload.instructorId !== undefined) patch.instructorId = normalizeText(payload.instructorId || '', 120);
  if (payload.instructorName !== undefined) patch.instructorName = normalizeText(payload.instructorName || '', 180);
  patch.updatedAt = serverTimestamp();
  await db.collection(COLLECTIONS.reservations).doc(reservationId).set(patch, { merge: true });
  return { success: true, id: reservationId };
}

async function listAdminData(db, user) {
  if (!(await canManageShootingRange(user.uid))) {
    const err = new Error('Brak uprawnień administratora strzelnicy.');
    err.status = 403;
    throw err;
  }
  const [config, lanes, offers, packages, instructors, reservations, blocks, vouchers] = await Promise.all([
    getConfig(db),
    listCollectionNormalized(db, COLLECTIONS.lanes, normalizeLane),
    listCollectionNormalized(db, COLLECTIONS.offers, normalizeOffer),
    listCollectionNormalized(db, COLLECTIONS.packages, normalizePackage),
    listCollectionNormalized(db, COLLECTIONS.instructors, normalizeInstructor),
    listCollectionNormalized(db, COLLECTIONS.reservations, normalizeReservation),
    listCollectionNormalized(db, COLLECTIONS.blocks, (row, id) => ({ id, ...(row || {}) })),
    listCollectionNormalized(db, COLLECTIONS.vouchers, normalizeVoucher),
  ]);
  return {
    config,
    lanes,
    offers,
    packages,
    instructors,
    reservations: reservations.sort((a, b) => (toDate(b.startsAt)?.getTime() || 0) - (toDate(a.startsAt)?.getTime() || 0)),
    blocks,
    vouchers,
  };
}

async function handleHotPayNotification(db, req) {
  const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length
    ? req.body
    : await readJsonBody(req).catch(() => ({}));
  const amount = normalizeText(body.KWOTA || body.kwota || '', 32);
  const paymentId = normalizeText(body.ID_PLATNOSCI || body.id_platnosci || '', 120);
  const orderId = normalizeText(body.ID_ZAMOWIENIA || body.id_zamowienia || '', 120);
  const status = normalizeText(body.STATUS || body.status || '', 40).toUpperCase();
  const secret = normalizeText(body.SEKRET || body.sekret || '', 200);
  const hash = normalizeText(body.HASH || body.hash || '', 200).toLowerCase();
  const config = await getConfig(db);
  const notificationHash = normalizeText(config.hotpay.notificationHash || process.env.HOTPAY_NOTIFICATION_HASH || '', 200);
  if (!amount || !paymentId || !orderId || !status || !secret || !hash || !notificationHash) {
    const err = new Error('Niepełna notyfikacja HotPay.');
    err.status = 400;
    throw err;
  }
  const expectedHash = crypto
    .createHash('sha256')
    .update(`${notificationHash};${amount};${paymentId};${orderId};${status};${secret}`)
    .digest('hex')
    .toLowerCase();
  if (expectedHash !== hash) {
    const err = new Error('Nieprawidłowy podpis notyfikacji HotPay.');
    err.status = 403;
    throw err;
  }
  if (orderId.startsWith('voucher:')) {
    const voucherId = orderId.split(':')[1];
    if (status === 'SUCCESS') {
      const voucher = await activateVoucherAfterPayment(db, voucherId, paymentId);
      return { success: true, kind: 'voucher', id: voucher.id, status: voucher.status };
    }
    await db.collection(COLLECTIONS.vouchers).doc(voucherId).set(
      {
        paymentStatus: status.toLowerCase(),
        status: status === 'FAILURE' ? 'anulowany' : 'awaiting_payment',
        hotpayPaymentId: paymentId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { success: true, kind: 'voucher', id: voucherId, status };
  }
  const reservationRef = db.collection(COLLECTIONS.reservations).doc(orderId);
  const reservationSnap = await reservationRef.get();
  if (!reservationSnap.exists) {
    const err = new Error('Nie znaleziono rezerwacji dla notyfikacji HotPay.');
    err.status = 404;
    throw err;
  }
  if (status === 'SUCCESS') {
    await reservationRef.set(
      {
        status: 'oplacona',
        paymentStatus: 'success',
        hotpayPaymentId: paymentId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } else {
    await reservationRef.set(
      {
        status: 'platnosc_niepowiodla_sie',
        paymentStatus: status.toLowerCase(),
        hotpayPaymentId: paymentId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  return { success: true, kind: 'reservation', id: orderId, status };
}

async function handleApi(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const db = await getDb();
  const path = readPath(req);
  const user = await getSessionUser(req);
  const body = req.method === 'GET' ? null : await readJsonBody(req).catch(() => ({}));

  if (!path || path === 'public') {
    ensureMethod(req, ['GET']);
    const data = await getPublicData(db);
    return sendJson(res, 200, { success: true, ...data });
  }

  if (path === 'availability') {
    ensureMethod(req, ['GET']);
    const slots = await getAvailabilityForDay(db, req.query || {});
    return sendJson(res, 200, { success: true, slots });
  }

  if (path === 'reservation/create') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Zaloguj się, aby dokonać rezerwacji.' });
    const reservation = await createReservation(db, user, body);
    return sendJson(res, 200, { success: true, reservation });
  }

  if (path === 'reservation/list') {
    ensureMethod(req, ['GET']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Zaloguj się, aby zobaczyć rezerwacje.' });
    const reservations = await listMyReservations(db, user.uid);
    return sendJson(res, 200, { success: true, reservations });
  }

  if (path === 'reservation/cancel') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const result = await cancelReservation(db, user, body?.reservationId);
    return sendJson(res, 200, { success: true, ...result });
  }

  if (path === 'voucher/purchase') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Zaloguj się, aby kupić voucher.' });
    const voucher = await createVoucherPurchase(db, user, body);
    return sendJson(res, 200, { success: true, voucher });
  }

  if (path === 'voucher/redeem') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Zaloguj się, aby zrealizować voucher.' });
    const result = await redeemVoucher(db, user, body);
    return sendJson(res, 200, { success: true, ...result });
  }

  if (path === 'voucher/list') {
    ensureMethod(req, ['GET']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const snap = await db.collection(COLLECTIONS.vouchers).where('buyerUserId', '==', user.uid).get();
    const vouchers = snap.docs.map((docSnap) => normalizeVoucher(docSnap.data() || {}, docSnap.id));
    return sendJson(res, 200, { success: true, vouchers });
  }

  if (path === 'instruktor/summary') {
    ensureMethod(req, ['GET']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const data = await getInstructorPanelData(db, user.uid);
    return sendJson(res, 200, { success: true, ...data });
  }

  if (path === 'instruktor/availability/save') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const result = await saveInstructorAvailability(db, user, body);
    return sendJson(res, 200, { success: true, ...result });
  }

  if (path === 'admin/summary') {
    ensureMethod(req, ['GET']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const data = await listAdminData(db, user);
    return sendJson(res, 200, { success: true, ...data });
  }

  if (path === 'admin/config/save') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const data = await saveConfig(db, user, body);
    return sendJson(res, 200, { success: true, config: data });
  }

  if (path.startsWith('admin/entity/')) {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const entityType = path.split('/')[2] || '';
    const entity = await saveEntity(db, user, entityType, body);
    return sendJson(res, 200, { success: true, entity });
  }

  if (path === 'admin/reservation/save') {
    ensureMethod(req, ['POST']);
    if (!user) return sendJson(res, 401, { success: false, error: 'Brak autoryzacji.' });
    const result = await saveReservationAdmin(db, user, body);
    return sendJson(res, 200, { success: true, ...result });
  }

  if (path === 'hotpay/notify') {
    ensureMethod(req, ['POST']);
    const result = await handleHotPayNotification(db, req);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { success: false, error: 'Nie znaleziono endpointu strzelnicy.' });
}

module.exports = {
  COLLECTIONS,
  DEFAULT_CONFIG,
  getConfig,
  getPublicData,
  normalizeLane,
  normalizeOffer,
  normalizePackage,
  normalizeInstructor,
  normalizeReservation,
  normalizeVoucher,
  handleApi,
  generateReservationNumber,
};
