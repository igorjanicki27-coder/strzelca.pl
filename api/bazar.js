const {
  initAdmin,
  admin,
  setCors,
  readJsonBody,
  getSessionUser,
} = require('./_sso-utils');
const { sendBazarOfferTemplateEmail } = require('./_bazar-offer-email');
const {
  TYPE_BAZAR,
  syncEntryFromSource,
  deleteIndexEntry,
} = require('./_search-index');
const {
  getUserRoleProfile,
  canAccessBackofficeScope,
} = require('./_moderation');
const {
  getBazarCommerceConfig,
  saveBazarCommerceConfig,
  getDecodedUserProfile,
  getCompanyVerificationLabel,
  buildInvoiceBuyerSnapshot,
  createTokenPurchaseCheckoutSession,
  validatePromoCodeForUser,
  redeemGrantPromoCode,
  listPromoCodes,
  savePromoCode,
  setPromoCodeStatus,
  listBazarPromoClaims,
  getUserTokenSummary,
  listTokenHistory,
  consumeTokens,
  grantTokens,
  BAZAR_PURCHASES,
  BAZAR_REPORTS,
  BAZAR_WEBHOOK_LOG,
  computePromotionState,
  isMajorOfferChange,
} = require('./_bazar-commerce');
const { processCompletedBazarPurchase } = require('./_bazar-purchase-processor');
const {
  VOIVODESHIPS,
  getLocationSuggestions,
  getLocalityById,
  validateCreateLocationSelection,
  haversineKm,
} = require('./_bazar-locations');

const BAZAR_MAX_IMAGES = 5;
const BAZAR_IMAGES_MAX_TOTAL_BYTES = 1048576;
const BAZAR_FIRST_OFFER_GUIDE_VERSION = 1;
const CATEGORIES = ['PISTOLET', 'REWOLWER', 'KARABIN', 'BRON_GLADKOLUFOWA', 'BRON_CZARNOPROCHOWA', 'AMUNICJA', 'AKCESORIA', 'INNE'];
const CONDITIONS = ['NOWY', 'UZYWANY'];
const STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'EXPIRED', 'SOLD'];
const WOJEWODZTWA = VOIVODESHIPS.map((item) => item.slug);

function normalizeText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen);
}

function validateBazarImages(images) {
  if (!Array.isArray(images)) return { ok: true, list: [] };
  const raw = images
    .filter((x) => typeof x === 'string' && x.trim().length)
    .map((x) => x.trim());
  if (raw.length > BAZAR_MAX_IMAGES) {
    return { ok: false, error: `Maksymalnie ${BAZAR_MAX_IMAGES} zdjęć.`, list: [] };
  }
  let totalBytes = 0;
  const list = [];
  for (const s of raw) {
    const isData = /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(s);
    const isHttp = /^https:\/\//i.test(s);
    if (!isData && !isHttp) {
      return { ok: false, error: 'Nieprawidłowy format zdjęcia (JPEG/PNG/WebP jako data URL lub link HTTPS).', list: [] };
    }
    const byteLen = Buffer.byteLength(s, 'utf8');
    if (byteLen > BAZAR_IMAGES_MAX_TOTAL_BYTES) {
      return { ok: false, error: 'Pojedyncze zdjęcie przekracza 1 MiB.', list: [] };
    }
    totalBytes += byteLen;
    list.push(s);
  }
  if (totalBytes > BAZAR_IMAGES_MAX_TOTAL_BYTES) {
    return { ok: false, error: 'Łączny rozmiar zdjęć przekracza 1 MiB. Usuń część zdjęć lub wgraj mniejsze pliki.', list: [] };
  }
  return { ok: true, list };
}

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    initAdmin();
    const db = admin.firestore();
    const profile = await getUserRoleProfile(db, uid);
    return canAccessBackofficeScope(profile, 'bazaar');
  } catch (_) {
    return false;
  }
}

async function bumpBazarPublicListVersion(db) {
  try {
    await db.collection('publicListCacheMeta').doc('bazarOffers').set(
      {
        v: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('bumpBazarPublicListVersion', e);
  }
}

async function readBazarListVersion(db) {
  const snap = await db.collection('publicListCacheMeta').doc('bazarOffers').get();
  if (!snap.exists) return 0;
  const v = snap.data()?.v;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function generateSlug(title, wojewodztwo) {
  const base = (title || '')
    .toLowerCase()
    .replace(/[ąàáâãäå]/g, 'a').replace(/[ćčç]/g, 'c').replace(/[ęèéêë]/g, 'e')
    .replace(/[łl]/g, 'l').replace(/[ńñ]/g, 'n').replace(/[óòôõö]/g, 'o')
    .replace(/[śšş]/g, 's').replace(/[żźž]/g, 'z').replace(/[üùúû]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
  const woj = (wojewodztwo || '').toLowerCase().replace(/[^a-z]/g, '').substring(0, 20);
  return woj ? `${base}-${woj}` : base;
}

async function syncBazarOfferInSearchIndex(db, offerId) {
  if (!offerId) return;
  try {
    await syncEntryFromSource({ db, admin, type: TYPE_BAZAR, sourceId: String(offerId) });
  } catch (e) {
    console.warn('syncBazarOfferInSearchIndex failed:', e?.message || e);
  }
}

async function countActiveOffersForUser(db, uid) {
  const statuses = ['ACTIVE'];
  const snaps = await Promise.all(
    statuses.map((status) =>
      db.collection('bazarOffers').where('seller_id', '==', uid).where('status', '==', status).get(),
    ),
  );
  return snaps.reduce((sum, snap) => sum + snap.size, 0);
}

async function hasAnyOfferForUser(db, uid) {
  const snap = await db.collection('bazarOffers').where('seller_id', '==', uid).limit(1).get();
  return !snap.empty;
}

function buildSellerSnapshot(profile) {
  return {
    seller_name: profile.displayName || 'Uzytkownik',
    seller_role: profile.role || 'user',
    seller_company_verified: profile.companyVerificationStatus === 'verified',
    seller_company_name: profile.companyName || '',
    seller_avatar: profile.avatar || '',
    seller_verification_label: getCompanyVerificationLabel(profile.companyVerificationStatus),
  };
}

function buildOfferResponse(docSnap) {
  const data = docSnap.data() || {};
  const promotion = computePromotionState(data);
  return {
    id: docSnap.id,
    title: data.title,
    description: data.description,
    price: data.price,
    category: data.category,
    condition: data.condition,
    wojewodztwo: data.wojewodztwo,
    miejscowosc: data.miejscowosc,
    location_id: data.location_id || '',
    location_label: data.location_label || '',
    location_lat: Number(data.location_lat || 0),
    location_lng: Number(data.location_lng || 0),
    mainImage: (data.images && data.images[0]) || '',
    images: data.images || [],
    imageCount: (data.images || []).length,
    seller_id: data.seller_id,
    seller_name: data.seller_name,
    seller_role: data.seller_role || 'user',
    seller_company_verified: data.seller_company_verified === true,
    seller_company_name: data.seller_company_name || '',
    seller_avatar: data.seller_avatar || '',
    seller_verification_label: data.seller_verification_label || '',
    status: data.status,
    is_pinned: promotion.pinActive,
    is_highlighted: promotion.highlightActive,
    is_home_featured: promotion.promotedActive,
    is_admin_pinned: data.is_pinned === true,
    pin_until: data.pin_until || null,
    highlight_until: data.highlight_until || null,
    promoted_until: data.promoted_until || null,
    slug: data.slug || docSnap.id,
    rejection_reason: data.rejection_reason || null,
    created_at: data.created_at || null,
    approved_at: data.approved_at || null,
    expires_at: data.expires_at || null,
    last_refreshed_at: data.last_refreshed_at || null,
    moderation_reason: data.moderation_reason || '',
  };
}

async function requireAdminUser(req) {
  const user = await getSessionUser(req);
  if (!user || !(await isAdmin(user.uid))) {
    const err = new Error('Brak uprawnień administratora');
    err.status = 403;
    throw err;
  }
  return user;
}

function ensureCategory(value) {
  return CATEGORIES.includes(value) ? value : null;
}

function ensureCondition(value) {
  return CONDITIONS.includes(value) ? value : null;
}

function ensureWoj(value) {
  return WOJEWODZTWA.includes(value) ? value : null;
}

async function spendTokensForAction(db, uid, cfg, actionKey, extra = {}) {
  const action = cfg.actions?.[actionKey];
  if (!action || action.active === false) {
    throw new Error('Ta akcja żetonowa jest obecnie niedostępna.');
  }
  return consumeTokens(db, {
    userId: uid,
    tokens: action.tokenCost,
    reasonKey: actionKey,
    reasonLabel: action.label,
    offerId: extra.offerId || '',
    note: extra.note || '',
  });
}

function applyLocationSnapshot(target, locality) {
  target.location_id = locality.id;
  target.location_label = locality.label;
  target.location_lat = Number(locality.lat || 0);
  target.location_lng = Number(locality.lng || 0);
  target.wojewodztwo = locality.wojewodztwo;
  target.miejscowosc = locality.name;
}

function computeOfferExpiryDays(cfg) {
  return Math.max(1, parseInt(cfg.publicationDurationDays, 10) || 30);
}

module.exports = async (req, res) => {
  setCors(req, res, { methods: 'GET, POST, PUT, DELETE, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    initAdmin();
    const db = admin.firestore();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathFromQuery = url.searchParams.get('__path');
    const pathParts = pathFromQuery
      ? pathFromQuery.split('/').filter(Boolean)
      : url.pathname.replace(/^\/api\/bazar\/?/, '').split('/').filter(Boolean);
    const action = pathParts[0] || '';
    const subAction = pathParts[1] || '';

    if (req.method === 'GET' && action === 'locations') {
      const query = normalizeText(url.searchParams.get('q') || '', 120);
      const scope = normalizeText(url.searchParams.get('scope') || 'search', 20) || 'search';
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 12, 1), 20);
      const result = getLocationSuggestions({ query, scope, limit });
      return res.json({ success: true, ...result });
    }

    if (req.method === 'GET' && !action) {
      if (url.searchParams.get('listVersionOnly') === '1') {
        const listVersion = await readBazarListVersion(db);
        return res.json({ success: true, listVersion });
      }
      const category = url.searchParams.get('category') || '';
      const status = url.searchParams.get('status') || 'ACTIVE';
      const search = url.searchParams.get('search') || '';
      const wojewodztwo = url.searchParams.get('wojewodztwo') || '';
      const sort = url.searchParams.get('sort') || 'newest';
      const priceMin = parseFloat(url.searchParams.get('price_min')) || 0;
      const priceMax = parseFloat(url.searchParams.get('price_max')) || 0;
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 100);
      const pinnedOnly = url.searchParams.get('pinned') === 'true';
      const sellerType = normalizeText(url.searchParams.get('seller_type') || '', 16).toLowerCase();
      const locationId = normalizeText(url.searchParams.get('location_id') || '', 32);
      const radiusKm = Math.max(0, parseInt(url.searchParams.get('radius_km'), 10) || 0);
      const locationFilter = getLocalityById(locationId);

      let q = db.collection('bazarOffers');
      if (pinnedOnly) {
        q = q.where('pin_active', '==', true).where('status', '==', 'ACTIVE');
      } else if (status && STATUSES.includes(status)) {
        q = q.where('status', '==', status);
      }
      if (category && CATEGORIES.includes(category)) {
        q = q.where('category', '==', category);
      }
      if (wojewodztwo && WOJEWODZTWA.includes(wojewodztwo)) {
        q = q.where('wojewodztwo', '==', wojewodztwo);
      }
      if (sellerType === 'company') {
        q = q.where('seller_role', '==', 'company');
      } else if (sellerType === 'private') {
        q = q.where('seller_role', '==', 'user');
      }
      if (sort === 'price_asc') {
        q = q.orderBy('price', 'asc');
      } else if (sort === 'price_desc') {
        q = q.orderBy('price', 'desc');
      } else if (sort === 'oldest') {
        q = q.orderBy('last_refreshed_at', 'asc');
      } else {
        q = q.orderBy('pin_active', 'desc').orderBy('last_refreshed_at', 'desc');
      }
      q = q.limit(limit);

      const snap = await q.get();
      const offers = [];
      const staleUpdates = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (priceMin > 0 && Number(data.price || 0) < priceMin) return;
        if (priceMax > 0 && Number(data.price || 0) > priceMax) return;
        if (search) {
          const s = search.toLowerCase();
          if (!(data.title || '').toLowerCase().includes(s) && !(data.description || '').toLowerCase().includes(s)) return;
        }
        if (locationFilter && radiusKm > 0) {
          const lat = Number(data.location_lat || 0);
          const lng = Number(data.location_lng || 0);
          if (!lat || !lng) return;
          const distanceKm = haversineKm(locationFilter.lat, locationFilter.lng, lat, lng);
          if (distanceKm > radiusKm) return;
        }
        const offer = buildOfferResponse(docSnap);
        if (data.pin_active && !offer.is_pinned && data.is_pinned !== true) {
          staleUpdates.push(docSnap.ref.update({ pin_active: false }).catch(() => null));
        }
        if (data.highlight_active && !offer.is_highlighted) {
          staleUpdates.push(docSnap.ref.update({ highlight_active: false }).catch(() => null));
        }
        offers.push(offer);
      });
      if (staleUpdates.length) Promise.allSettled(staleUpdates).catch(() => null);
      const listVersion = await readBazarListVersion(db);
      return res.json({ success: true, offers, count: offers.length, listVersion });
    }

    if (req.method === 'GET' && action === 'commerce-config') {
      const cfg = await getBazarCommerceConfig(db);
      return res.json({
        success: true,
        config: {
          privateFreeActiveOffers: cfg.privateFreeActiveOffers,
          privateFreeRefreshDays: cfg.privateFreeRefreshDays,
          promotionDefaults: cfg.promotionDefaults,
          packages: cfg.packages.filter((pkg) => pkg.active !== false),
          actions: cfg.actions,
          reportingReasons: cfg.reportingReasons,
        },
      });
    }

    if (req.method === 'GET' && action === 'token-summary') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const [summary, cfg, profile] = await Promise.all([
        getUserTokenSummary(db, user.uid),
        getBazarCommerceConfig(db),
        getDecodedUserProfile(db, user.uid),
      ]);
      return res.json({
        success: true,
        summary,
        config: {
          tokenPricing: cfg.tokenPricing,
          packages: cfg.packages.filter((pkg) => pkg.active !== false),
          actions: cfg.actions,
          privateFreeActiveOffers: cfg.privateFreeActiveOffers,
          privateFreeRefreshDays: cfg.privateFreeRefreshDays,
        },
        profile: {
          role: profile.role,
          companyVerificationStatus: profile.companyVerificationStatus,
          companyVerificationLabel: getCompanyVerificationLabel(profile.companyVerificationStatus),
          bazarFirstOfferGuideCompletedAt: profile.bazarFirstOfferGuideCompletedAt || null,
          bazarFirstOfferGuideVersion: profile.bazarFirstOfferGuideVersion || 0,
        },
        buyerPrefill: buildInvoiceBuyerSnapshot(profile),
      });
    }

    if (req.method === 'GET' && action === 'first-offer-guide-state') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const [profile, cfg, activeCount, anyOffer] = await Promise.all([
        getDecodedUserProfile(db, user.uid),
        getBazarCommerceConfig(db),
        countActiveOffersForUser(db, user.uid),
        hasAnyOfferForUser(db, user.uid),
      ]);
      const completedAt = profile.bazarFirstOfferGuideCompletedAt || null;
      const shouldShowGuide = !anyOffer && !completedAt;
      return res.json({
        success: true,
        guide: {
          version: BAZAR_FIRST_OFFER_GUIDE_VERSION,
          shouldShowGuide,
          hasAnyOffer: anyOffer,
          completedAt,
          acceptedRulesAt: profile.bazarFirstOfferGuideAcceptedRulesAt || null,
          role: profile.role || 'user',
          companyVerificationStatus: profile.companyVerificationStatus || 'not_applicable',
          companyVerificationLabel: getCompanyVerificationLabel(profile.companyVerificationStatus),
          privateFreeActiveOffers: cfg.privateFreeActiveOffers,
          activeOfferCount: activeCount,
        },
      });
    }

    if (req.method === 'POST' && action === 'first-offer-guide-complete') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const body = await readJsonBody(req);
      if (body?.acceptedRules !== true) {
        return res.status(400).json({ success: false, error: 'Aby ukończyć szkolenie, zaakceptuj zasady Bazaru.' });
      }
      await db.collection('userProfiles').doc(user.uid).set(
        {
          bazarFirstOfferGuideCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
          bazarFirstOfferGuideAcceptedRulesAt: admin.firestore.FieldValue.serverTimestamp(),
          bazarFirstOfferGuideVersion: BAZAR_FIRST_OFFER_GUIDE_VERSION,
        },
        { merge: true },
      );
      return res.json({ success: true, completed: true, version: BAZAR_FIRST_OFFER_GUIDE_VERSION });
    }

    if (req.method === 'GET' && action === 'token-history') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const history = await listTokenHistory(db, user.uid, 100);
      return res.json({ success: true, history });
    }

    if (req.method === 'GET' && action === 'promo-code-preview') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const code = normalizeText(url.searchParams.get('code') || '', 64);
      const packageId = normalizeText(url.searchParams.get('packageId') || '', 80);
      const tokens = Math.max(0, parseInt(url.searchParams.get('tokens'), 10) || 0);
      if (!code) return res.status(400).json({ success: false, error: 'Podaj kod promocyjny.' });
      const validated = await validatePromoCodeForUser(db, code, user.uid, { packageId, tokens });
      return res.json({
        success: true,
        promoCode: {
          code: validated.code.code,
          kind: validated.code.kind,
          label: validated.code.label,
          discountPercent: validated.code.discountPercent,
          grantTokens: validated.code.grantTokens,
          note: validated.code.note,
        },
        packages: validated.packages,
        packagePreview: validated.packagePreview || null,
      });
    }

    if (req.method === 'POST' && action === 'promo-code-redeem') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const body = await readJsonBody(req);
      const code = normalizeText(body.code || '', 64);
      if (!code) return res.status(400).json({ success: false, error: 'Podaj kod promocyjny.' });
      const result = await redeemGrantPromoCode(db, {
        code,
        userId: user.uid,
        createdBy: user.uid,
      });
      return res.json({
        success: true,
        redeemed: true,
        promoCode: {
          code: result.code.code,
          kind: result.code.kind,
          grantTokens: result.code.grantTokens,
        },
      });
    }

    if (req.method === 'GET' && action === 'company-status') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const profile = await getDecodedUserProfile(db, user.uid);
      return res.json({
        success: true,
        role: profile.role,
        companyVerificationStatus: profile.companyVerificationStatus,
        companyVerificationLabel: getCompanyVerificationLabel(profile.companyVerificationStatus),
        companyVerificationReason: profile.companyVerificationReason,
      });
    }

    if (req.method === 'POST' && action === 'tokens' && subAction === 'checkout-session') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const body = await readJsonBody(req);
      const result = await createTokenPurchaseCheckoutSession(db, {
        userId: user.uid,
        packageId: normalizeText(body.packageId || '', 80),
        tokens: Math.max(0, parseInt(body.tokens, 10) || 0),
        truthConfirmed: body.truthConfirmed === true,
        buyerInput: body.buyerInput || {},
        promoCode: normalizeText(body.promoCode || '', 64),
      });
      return res.json({ success: true, ...result });
    }

    if (req.method === 'GET' && action === 'purchases') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const snap = await db
        .collection(BAZAR_PURCHASES)
        .where('userId', '==', user.uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      const purchases = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      return res.json({ success: true, purchases });
    }

    if (req.method === 'GET' && action === 'offer' && subAction) {
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const data = docSnap.data() || {};
      const user = await getSessionUser(req);
      const userIsAdmin = user ? await isAdmin(user.uid) : false;
      if (data.status !== 'ACTIVE' && !userIsAdmin && (!user || user.uid !== data.seller_id)) {
        return res.status(403).json({ success: false, error: 'Oferta niedostepna' });
      }
      return res.json({ success: true, offer: buildOfferResponse(docSnap) });
    }

    if (req.method === 'GET' && action === 'slug' && subAction) {
      const slug = decodeURIComponent(pathParts.slice(1).join('/') || subAction);
      if (!slug) return res.status(400).json({ success: false, error: 'Brak sluga' });
      const snap = await db.collection('bazarOffers').where('slug', '==', slug).limit(8).get();
      if (snap.empty) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const user = await getSessionUser(req);
      const userIsAdmin = user ? await isAdmin(user.uid) : false;
      let chosen = null;
      snap.docs.forEach((docSnap) => {
        if (chosen) return;
        const row = docSnap.data() || {};
        if (row.status === 'ACTIVE') chosen = docSnap;
      });
      if (!chosen) {
        snap.docs.forEach((docSnap) => {
          if (chosen) return;
          const row = docSnap.data() || {};
          if (userIsAdmin || (user && user.uid === row.seller_id)) chosen = docSnap;
        });
      }
      if (!chosen) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      return res.json({ success: true, offer: buildOfferResponse(chosen) });
    }

    if ((req.method === 'POST' || req.method === 'GET') && action === 'cron' && subAction === 'expire') {
      const { handleBazarExpireCron } = require('./_bazar-expire-cron');
      return handleBazarExpireCron(req, res);
    }

    if (req.method === 'POST' && action === 'report' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const offerSnap = await db.collection('bazarOffers').doc(subAction).get();
      if (!offerSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const body = await readJsonBody(req);
      const reason = normalizeText(body.reason || '', 160);
      const details = normalizeText(body.details || '', 800);
      if (!reason) return res.status(400).json({ success: false, error: 'Podaj powod zgloszenia.' });
      const existing = await db
        .collection(BAZAR_REPORTS)
        .where('offerId', '==', subAction)
        .where('reporterId', '==', user.uid)
        .where('status', '==', 'open')
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(400).json({ success: false, error: 'To ogłoszenie jest już przez Ciebie zgłoszone.' });
      }
      await db.collection(BAZAR_REPORTS).add({
        offerId: subAction,
        offerTitle: normalizeText(offerSnap.data()?.title || '', 200),
        reporterId: user.uid,
        reporterDisplayName: normalizeText(body.reporterDisplayName || '', 120),
        reason,
        details,
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'promote' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const offerRef = db.collection('bazarOffers').doc(subAction);
      const offerSnap = await offerRef.get();
      if (!offerSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const offer = offerSnap.data() || {};
      if (offer.seller_id !== user.uid) return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      const body = await readJsonBody(req);
      if (offer.status !== 'ACTIVE' && normalizeText(body.action || '', 30) !== 'refresh') {
        return res.status(400).json({ success: false, error: 'Ta oferta musi byc aktywna.' });
      }
      const actionKey = normalizeText(body.action || '', 32);
      const cfg = await getBazarCommerceConfig(db);
      const now = admin.firestore.Timestamp.now();
      if (actionKey === 'pin') {
        await spendTokensForAction(db, user.uid, cfg, 'pin_offer', { offerId: subAction });
        const pinUntil = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + cfg.actions.pin_offer.durationDays * 24 * 60 * 60 * 1000,
        );
        await offerRef.update({ pin_until: pinUntil, pin_active: true, last_promoted_at: now });
      } else if (actionKey === 'highlight') {
        await spendTokensForAction(db, user.uid, cfg, 'highlight_offer', { offerId: subAction });
        const highlightUntil = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + cfg.actions.highlight_offer.durationDays * 24 * 60 * 60 * 1000,
        );
        const promotedUntil = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + Math.max(1, parseInt(cfg.promotionDefaults?.highlightDays, 10) || 7) * 24 * 60 * 60 * 1000,
        );
        await offerRef.update({
          highlight_until: highlightUntil,
          promoted_until: promotedUntil,
          highlight_active: true,
          last_promoted_at: now,
        });
      } else if (actionKey === 'refresh') {
        await spendTokensForAction(db, user.uid, cfg, 'early_refresh', { offerId: subAction });
        const newExpires = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + computeOfferExpiryDays(cfg) * 24 * 60 * 60 * 1000,
        );
        await offerRef.update({
          last_refreshed_at: now,
          expires_at: newExpires,
          status: 'ACTIVE',
          expiry_warning_sent_at: null,
        });
      } else {
        return res.status(400).json({ success: false, error: 'Nieobsługiwana akcja żetonowa.' });
      }
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, subAction);
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'create') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const body = await readJsonBody(req);
      const { title, description, price, category, condition, images } = body;
      let location;
      try {
        location = validateCreateLocationSelection(body || {});
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message || 'Wybierz lokalizację z listy.' });
      }
      if (!title || !price || !category || !condition) {
        return res.status(400).json({ success: false, error: 'Brakujące pola: title, price, category, condition, locationId' });
      }
      if (!ensureCategory(category)) return res.status(400).json({ success: false, error: 'Nieprawidlowa kategoria' });
      if (!ensureCondition(condition)) return res.status(400).json({ success: false, error: 'Nieprawidlowy stan' });
      if (!ensureWoj(location.wojewodztwo)) return res.status(400).json({ success: false, error: 'Nieprawidłowa lokalizacja' });

      const imgCheck = validateBazarImages(images);
      if (!imgCheck.ok) return res.status(400).json({ success: false, error: imgCheck.error });

      const [profile, cfg] = await Promise.all([
        getDecodedUserProfile(db, user.uid),
        getBazarCommerceConfig(db),
      ]);
      if (!profile.emailVerified) {
        return res.status(400).json({ success: false, error: 'Potwierdź adres e-mail przed wystawieniem ogłoszenia.' });
      }
      const isFirstOfferAttempt = !(await hasAnyOfferForUser(db, user.uid));
      if (isFirstOfferAttempt && !profile.bazarFirstOfferGuideCompletedAt) {
        return res.status(400).json({
          success: false,
          error: 'Przed dodaniem pierwszego ogłoszenia ukończ szkolenie Bazaru i zaakceptuj zasady.',
          code: 'FIRST_OFFER_GUIDE_REQUIRED',
        });
      }

      const sellerSnapshot = buildSellerSnapshot(profile);
      const nowTs = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        nowTs.toMillis() + computeOfferExpiryDays(cfg) * 24 * 60 * 60 * 1000,
      );

      let status = 'PENDING';
      let approvedAt = null;
      let tokenActionUsed = '';

      if (profile.role === 'company') {
        if (profile.companyVerificationStatus !== 'verified') {
          return res.status(400).json({ success: false, error: 'Konto firmowe jest w trakcie weryfikacji i nie może jeszcze publikować ogłoszeń.' });
        }
        await spendTokensForAction(db, user.uid, cfg, 'company_listing', {
          note: `Publikacja oferty firmowej: ${normalizeText(title, 120)}`,
        });
        tokenActionUsed = 'company_listing';
        status = 'ACTIVE';
        approvedAt = nowTs;
      } else {
        const activeCount = await countActiveOffersForUser(db, user.uid);
        if (activeCount >= cfg.privateFreeActiveOffers) {
          await spendTokensForAction(db, user.uid, cfg, 'private_extra_listing', {
            note: `Publikacja oferty ponad limit: ${normalizeText(title, 120)}`,
          });
          tokenActionUsed = 'private_extra_listing';
        }
      }

      const docRef = db.collection('bazarOffers').doc();
      const slug = generateSlug(title, location.wojewodztwo);
      const offerData = {
        title: normalizeText(title, 200),
        description: normalizeText(description || '', 5000),
        price: parseFloat(price),
        category,
        condition,
        images: imgCheck.list,
        seller_id: user.uid,
        ...sellerSnapshot,
        status,
        is_pinned: false,
        pin_active: false,
        highlight_active: false,
        promoted_until: null,
        pin_until: null,
        highlight_until: null,
        slug,
        created_at: nowTs,
        approved_at: approvedAt,
        expires_at: status === 'ACTIVE' ? expiresAt : null,
        last_refreshed_at: nowTs,
        rejection_reason: null,
        paid_listing_action: tokenActionUsed || null,
      };
      applyLocationSnapshot(offerData, location);
      await docRef.set(offerData);
      await syncBazarOfferInSearchIndex(db, docRef.id);
      if (status === 'ACTIVE') {
        sendBazarOfferTemplateEmail(db, 'bazar_offer_approved', { ...offerData, id: docRef.id, slug }, {}).catch(() => {});
      } else {
        sendBazarOfferTemplateEmail(db, 'bazar_offer_submitted', { ...offerData, id: docRef.id, slug }).catch(() => {});
      }
      return res.json({ success: true, id: docRef.id, slug, status, tokenActionUsed });
    }

    if (req.method === 'PUT' && action === 'offer' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const existing = docSnap.data() || {};
      const userIsAdmin = await isAdmin(user.uid);
      if (existing.seller_id !== user.uid && !userIsAdmin) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }

      const body = await readJsonBody(req);
      const updates = {};
      if (body.title !== undefined) updates.title = normalizeText(body.title, 200);
      if (body.description !== undefined) updates.description = normalizeText(body.description, 5000);
      if (body.price !== undefined) updates.price = parseFloat(body.price);
      if (body.category !== undefined && ensureCategory(body.category)) updates.category = body.category;
      if (body.condition !== undefined && ensureCondition(body.condition)) updates.condition = body.condition;
      if (body.locationId !== undefined) {
        let location;
        try {
          location = validateCreateLocationSelection(body || {});
        } catch (error) {
          return res.status(400).json({ success: false, error: error.message || 'Wybierz lokalizację z listy.' });
        }
        applyLocationSnapshot(updates, location);
      }
      if (body.images !== undefined) {
        const imgCheck = validateBazarImages(body.images);
        if (!imgCheck.ok) return res.status(400).json({ success: false, error: imgCheck.error });
        updates.images = imgCheck.list;
      }
      if (updates.title || updates.wojewodztwo) {
        updates.slug = generateSlug(updates.title || existing.title, updates.wojewodztwo || existing.wojewodztwo);
      }
      if (!Object.keys(updates).length) {
        return res.status(400).json({ success: false, error: 'Brak zmian' });
      }

      if (!userIsAdmin && existing.status !== 'PENDING' && isMajorOfferChange(existing, updates)) {
        const cfg = await getBazarCommerceConfig(db);
        const profile = await getDecodedUserProfile(db, user.uid);
        await spendTokensForAction(db, user.uid, cfg, 'material_relist', {
          offerId: subAction,
          note: `Istotna edycja oferty: ${normalizeText(existing.title || updates.title || '', 120)}`,
        });
        updates.last_material_edit_at = admin.firestore.Timestamp.now();
        if (profile.role === 'company' && profile.companyVerificationStatus === 'verified') {
          updates.status = 'ACTIVE';
          updates.approved_at = admin.firestore.Timestamp.now();
          updates.rejection_reason = null;
        } else {
          updates.status = 'PENDING';
          updates.approved_at = null;
          updates.rejection_reason = null;
        }
      }

      await docRef.update(updates);
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, subAction);
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'approve') {
      const user = await requireAdminUser(req);
      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });
      const docRef = db.collection('bazarOffers').doc(offerId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const cfg = await getBazarCommerceConfig(db);
      const now = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + computeOfferExpiryDays(cfg) * 24 * 60 * 60 * 1000);
      await docRef.update({
        status: 'ACTIVE',
        approved_at: now,
        expires_at: expiresAt,
        last_refreshed_at: now,
        rejection_reason: null,
        expiry_warning_sent_at: null,
        moderated_by: user.uid,
      });
      const approvedRow = {
        ...docSnap.data(),
        status: 'ACTIVE',
        approved_at: now,
        expires_at: expiresAt,
        last_refreshed_at: now,
        rejection_reason: null,
        slug: docSnap.data()?.slug || offerId,
        id: offerId,
      };
      sendBazarOfferTemplateEmail(db, 'bazar_offer_approved', approvedRow, {}).catch(() => {});
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, offerId);
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'reject') {
      const user = await requireAdminUser(req);
      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });
      const body = await readJsonBody(req);
      const reasonShort = normalizeText(body.reason || 'Brak podanego powodu', 500);
      const docRef = db.collection('bazarOffers').doc(offerId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      await docRef.update({
        status: 'REJECTED',
        rejection_reason: reasonShort,
        moderated_by: user.uid,
      });
      sendBazarOfferTemplateEmail(
        db,
        'bazar_offer_rejected',
        { ...docSnap.data(), id: offerId, status: 'REJECTED', rejection_reason: reasonShort },
        { rejectionReason: reasonShort },
      ).catch(() => {});
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, offerId);
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'pin') {
      await requireAdminUser(req);
      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });
      const body = await readJsonBody(req);
      const pinned = body.pinned !== false;
      await db.collection('bazarOffers').doc(offerId).update({ is_pinned: pinned, pin_active: pinned });
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, offerId);
      return res.json({ success: true, is_pinned: pinned });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'sold') {
      await requireAdminUser(req);
      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });
      await db.collection('bazarOffers').doc(offerId).update({ status: 'SOLD' });
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, offerId);
      return res.json({ success: true });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'all') {
      await requireAdminUser(req);
      const statusFilter = url.searchParams.get('status') || '';
      const categoryFilter = url.searchParams.get('category') || '';
      const searchFilter = normalizeText(url.searchParams.get('search') || '', 200).toLowerCase();
      let q = db.collection('bazarOffers').orderBy('created_at', 'desc').limit(200);
      if (statusFilter && STATUSES.includes(statusFilter)) {
        q = db.collection('bazarOffers').where('status', '==', statusFilter).orderBy('created_at', 'desc').limit(200);
      }
      const snap = await q.get();
      const offers = snap.docs
        .map((docSnap) => buildOfferResponse(docSnap))
        .filter((offer) => {
          if (categoryFilter && CATEGORIES.includes(categoryFilter) && offer.category !== categoryFilter) return false;
          if (searchFilter) {
            return (
              (offer.title || '').toLowerCase().includes(searchFilter) ||
              (offer.seller_name || '').toLowerCase().includes(searchFilter) ||
              (offer.seller_company_name || '').toLowerCase().includes(searchFilter)
            );
          }
          return true;
        });
      return res.json({ success: true, offers, count: offers.length });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'config') {
      await requireAdminUser(req);
      const config = await getBazarCommerceConfig(db);
      return res.json({ success: true, config });
    }

    if (req.method === 'PUT' && action === 'admin' && subAction === 'config') {
      const user = await requireAdminUser(req);
      const body = await readJsonBody(req);
      const config = await saveBazarCommerceConfig(db, body, { updatedBy: user.uid });
      return res.json({ success: true, config });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'companies') {
      await requireAdminUser(req);
      const snap = await db.collection('userProfiles').where('role', '==', 'company').get();
      const companies = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .sort((a, b) => {
          const aMs = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : 0;
          const bMs = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : 0;
          return bMs - aMs;
        })
        .map((row) => ({
          id: row.id,
          displayName: row.displayName || '',
          email: row.email || '',
          companyName: row.companyName ? (() => { try { return Buffer.from(String(row.companyName), 'base64').toString('utf8'); } catch (_) { return String(row.companyName || ''); } })() : '',
          nip: row.nip ? (() => { try { return Buffer.from(String(row.nip), 'base64').toString('utf8'); } catch (_) { return String(row.nip || ''); } })() : '',
          companyVerificationStatus: row.companyVerificationStatus || 'pending',
          companyVerificationReason: row.companyVerificationReason || '',
          createdAt: row.createdAt || null,
        }));
      return res.json({ success: true, companies });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'company-status') {
      const user = await requireAdminUser(req);
      const targetUid = pathParts[2];
      if (!targetUid) return res.status(400).json({ success: false, error: 'Brak ID uzytkownika.' });
      const body = await readJsonBody(req);
      const nextStatus = normalizeText(body.status || '', 32).toLowerCase();
      if (!['pending', 'verified', 'rejected'].includes(nextStatus)) {
        return res.status(400).json({ success: false, error: 'Nieprawidlowy status firmy.' });
      }
      await db.collection('userProfiles').doc(targetUid).set(
        {
          companyVerificationStatus: nextStatus,
          companyVerificationReason: normalizeText(body.reason || '', 600),
          companyVerificationReviewedBy: user.uid,
          companyVerificationReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return res.json({ success: true });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'reports') {
      await requireAdminUser(req);
      const snap = await db.collection(BAZAR_REPORTS).orderBy('createdAt', 'desc').limit(200).get();
      const reports = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      return res.json({ success: true, reports });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'report-status') {
      await requireAdminUser(req);
      const reportId = pathParts[2];
      if (!reportId) return res.status(400).json({ success: false, error: 'Brak ID zgloszenia.' });
      const body = await readJsonBody(req);
      await db.collection(BAZAR_REPORTS).doc(reportId).set(
        {
          status: normalizeText(body.status || 'closed', 32),
          resolutionNote: normalizeText(body.note || '', 800),
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return res.json({ success: true });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'purchases') {
      await requireAdminUser(req);
      const snap = await db.collection(BAZAR_PURCHASES).orderBy('createdAt', 'desc').limit(200).get();
      const purchases = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      return res.json({ success: true, purchases });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'webhooks') {
      await requireAdminUser(req);
      const snap = await db.collection(BAZAR_WEBHOOK_LOG).orderBy('createdAt', 'desc').limit(200).get();
      const webhooks = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      return res.json({ success: true, webhooks });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'promo-codes') {
      await requireAdminUser(req);
      const promoCodes = await listPromoCodes(db, 200);
      return res.json({ success: true, promoCodes });
    }

    if (req.method === 'GET' && action === 'admin' && subAction === 'promo-code-claims') {
      await requireAdminUser(req);
      const claims = await listBazarPromoClaims(db, 200);
      return res.json({ success: true, claims });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'promo-codes') {
      const user = await requireAdminUser(req);
      const body = await readJsonBody(req);
      const promoCode = await savePromoCode(db, body, { createdBy: user.uid });
      return res.json({ success: true, promoCode });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'promo-code-status') {
      const user = await requireAdminUser(req);
      const code = normalizeText(pathParts[2] || '', 64);
      if (!code) return res.status(400).json({ success: false, error: 'Brak kodu promocyjnego.' });
      const body = await readJsonBody(req);
      await setPromoCodeStatus(db, code, body, { updatedBy: user.uid });
      return res.json({ success: true });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'retry-purchase') {
      await requireAdminUser(req);
      const purchaseId = pathParts[2];
      if (!purchaseId) return res.status(400).json({ success: false, error: 'Brak ID zakupu.' });
      const result = await processCompletedBazarPurchase({ db, purchaseId });
      return res.json({ success: true, result });
    }

    if (req.method === 'POST' && action === 'admin' && subAction === 'grant-tokens') {
      const user = await requireAdminUser(req);
      const body = await readJsonBody(req);
      const targetUid = normalizeText(body.userId || '', 120);
      const tokens = Math.max(1, parseInt(body.tokens, 10) || 1);
      if (!targetUid) return res.status(400).json({ success: false, error: 'Brak userId.' });
      const result = await grantTokens(db, {
        userId: targetUid,
        tokens,
        packageId: normalizeText(body.packageId || 'manual_adjustment', 80),
        packageLabel: normalizeText(body.packageLabel || `Manualne przyznanie ${tokens} żetonów`, 160),
        source: 'admin_manual',
        amountCents: 0,
        currency: 'pln',
        createdBy: user.uid,
        validityDays: Math.max(1, parseInt(body.validityDays, 10) || 365),
        reasonKey: 'admin_manual_grant',
        reasonLabel: 'Manualne przyznanie żetonów',
        note: normalizeText(body.note || '', 400),
      });
      return res.json({ success: true, result });
    }

    if (req.method === 'POST' && action === 'refresh' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const data = docSnap.data() || {};
      if (data.seller_id !== user.uid) return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      if (data.status !== 'ACTIVE' && data.status !== 'EXPIRED') {
        return res.status(400).json({ success: false, error: 'Oferta musi byc aktywna lub wygasla' });
      }
      const [profile, cfg] = await Promise.all([
        getDecodedUserProfile(db, user.uid),
        getBazarCommerceConfig(db),
      ]);
      const lastRefresh = data.last_refreshed_at?.toDate ? data.last_refreshed_at.toDate() : new Date(data.last_refreshed_at);
      const daysSinceRefresh = (Date.now() - lastRefresh.getTime()) / (1000 * 60 * 60 * 24);
      const mustUseToken = profile.role === 'company' || daysSinceRefresh < cfg.privateFreeRefreshDays;
      if (mustUseToken) {
        await spendTokensForAction(db, user.uid, cfg, 'early_refresh', { offerId: subAction });
      }
      const now = admin.firestore.Timestamp.now();
      const newExpires = admin.firestore.Timestamp.fromMillis(now.toMillis() + computeOfferExpiryDays(cfg) * 24 * 60 * 60 * 1000);
      await docRef.update({
        last_refreshed_at: now,
        expires_at: newExpires,
        status: 'ACTIVE',
        expiry_warning_sent_at: null,
      });
      sendBazarOfferTemplateEmail(db, 'bazar_offer_refreshed', {
        ...data,
        id: subAction,
        last_refreshed_at: now,
        expires_at: newExpires,
        status: 'ACTIVE',
      }).catch(() => {});
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, subAction);
      return res.json({ success: true, usedToken: mustUseToken });
    }

    if (req.method === 'GET' && action === 'my') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const snap = await db.collection('bazarOffers').where('seller_id', '==', user.uid).orderBy('created_at', 'desc').limit(50).get();
      const offers = snap.docs.map((docSnap) => buildOfferResponse(docSnap));
      return res.json({ success: true, offers, count: offers.length });
    }

    if (req.method === 'POST' && action === 'sold' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const data = docSnap.data() || {};
      if (data.seller_id !== user.uid && !(await isAdmin(user.uid))) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }
      await docRef.update({ status: 'SOLD' });
      await bumpBazarPublicListVersion(db);
      await syncBazarOfferInSearchIndex(db, subAction);
      return res.json({ success: true });
    }

    if (req.method === 'DELETE' && action === 'offer' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });
      const data = docSnap.data() || {};
      if (data.seller_id !== user.uid && !(await isAdmin(user.uid))) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }
      await docRef.delete();
      await bumpBazarPublicListVersion(db);
      await deleteIndexEntry(db, TYPE_BAZAR, subAction).catch(() => null);
      return res.json({ success: true });
    }

    return res.status(404).json({ success: false, error: 'Endpoint nie znaleziony' });
  } catch (error) {
    console.error('Bazar API error:', error);
    return res.status(error?.status || 500).json({
      success: false,
      error: error?.message || 'Blad serwera',
    });
  }
};
