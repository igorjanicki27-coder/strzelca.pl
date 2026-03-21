const {
  initAdmin,
  admin,
  setCors,
  parseCookies,
  getCookieName,
  verifyLocalSessionJwt,
  readJsonBody,
} = require('./_sso-utils');

const SUPERADMIN_UID = 'nCMUz2fc8MM9WhhMVBLZ1pdR7O43';

/** Zdjecia jak produkty w panelu admina: data URL / HTTPS w polu Firestore (bez Storage). */
const BAZAR_MAX_IMAGES = 5;
/** Laczny rozmiar wszystkich stringow zdjec (UTF-8) — limit 1 MiB */
const BAZAR_IMAGES_MAX_TOTAL_BYTES = 1048576;

function validateBazarImages(images) {
  if (!Array.isArray(images)) return { ok: true, list: [] };
  const raw = images
    .filter((x) => typeof x === 'string' && x.trim().length)
    .map((x) => x.trim());
  if (raw.length > BAZAR_MAX_IMAGES) {
    return {
      ok: false,
      error: `Maksymalnie ${BAZAR_MAX_IMAGES} zdjęć.`,
      list: [],
    };
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
    return {
      ok: false,
      error: 'Łączny rozmiar zdjęć przekracza 1 MiB. Usuń część zdjęć lub wgraj mniejsze pliki.',
      list: [],
    };
  }
  return { ok: true, list };
}

const CATEGORIES = ['PISTOLET','REWOLWER','KARABIN','BRON_GLADKOLUFOWA','BRON_CZARNOPROCHOWA','AMUNICJA','AKCESORIA','INNE'];
const CONDITIONS = ['NOWY','UZYWANY'];
const STATUSES = ['PENDING','ACTIVE','REJECTED','EXPIRED','SOLD'];
const WOJEWODZTWA = [
  'dolnoslaskie','kujawsko-pomorskie','lubelskie','lubuskie',
  'lodzkie','malopolskie','mazowieckie','opolskie',
  'podkarpackie','podlaskie','pomorskie','slaskie',
  'swietokrzyskie','warminsko-mazurskie','wielkopolskie','zachodniopomorskie'
];

async function getSessionUser(req) {
  try {
    initAdmin();
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieName = getCookieName();
    const sessionCookie = cookies[cookieName];
    if (sessionCookie) {
      try {
        const decoded = verifyLocalSessionJwt(sessionCookie);
        if (decoded?.uid) return { uid: decoded.uid, emailVerified: decoded.emailVerified === true };
      } catch (_) {}
    }
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.substring(7);
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded?.uid) return { uid: decoded.uid, emailVerified: decoded.email_verified === true };
      } catch (_) {}
    }
    return null;
  } catch (_) { return null; }
}

async function isAdmin(uid) {
  if (!uid) return false;
  if (uid === SUPERADMIN_UID) return true;
  try {
    initAdmin();
    const db = admin.firestore();
    const profileDoc = await db.collection('userProfiles').doc(uid).get();
    if (!profileDoc.exists) return false;
    return profileDoc.data()?.role === 'admin';
  } catch (_) { return false; }
}

function generateSlug(title, wojewodztwo) {
  const base = (title || '')
    .toLowerCase()
    .replace(/[ąàáâãäå]/g,'a').replace(/[ćčç]/g,'c').replace(/[ęèéêë]/g,'e')
    .replace(/[łl]/g,'l').replace(/[ńñ]/g,'n').replace(/[óòôõö]/g,'o')
    .replace(/[śšş]/g,'s').replace(/[żźž]/g,'z').replace(/[üùúû]/g,'u')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,60);
  const woj = (wojewodztwo || '').toLowerCase().replace(/[^a-z]/g,'').substring(0,20);
  return woj ? `${base}-${woj}` : base;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    initAdmin();
    const db = admin.firestore();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.replace(/^\/api\/bazar\/?/, '').split('/').filter(Boolean);
    const action = pathParts[0] || '';
    const subAction = pathParts[1] || '';

    // GET /api/bazar - lista aktywnych ofert (publiczne)
    if (req.method === 'GET' && !action) {
      const category = url.searchParams.get('category') || '';
      const status = url.searchParams.get('status') || 'ACTIVE';
      const search = url.searchParams.get('search') || '';
      const wojewodztwo = url.searchParams.get('wojewodztwo') || '';
      const sort = url.searchParams.get('sort') || 'newest';
      const priceMin = parseFloat(url.searchParams.get('price_min')) || 0;
      const priceMax = parseFloat(url.searchParams.get('price_max')) || 0;
      const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 100);
      const pinnedOnly = url.searchParams.get('pinned') === 'true';

      let q = db.collection('bazarOffers');

      if (pinnedOnly) {
        q = q.where('is_pinned', '==', true).where('status', '==', 'ACTIVE');
      } else if (status && STATUSES.includes(status)) {
        q = q.where('status', '==', status);
      }

      if (category && CATEGORIES.includes(category)) {
        q = q.where('category', '==', category);
      }

      if (wojewodztwo && WOJEWODZTWA.includes(wojewodztwo)) {
        q = q.where('wojewodztwo', '==', wojewodztwo);
      }

      if (sort === 'price_asc') {
        q = q.orderBy('price', 'asc');
      } else if (sort === 'price_desc') {
        q = q.orderBy('price', 'desc');
      } else if (sort === 'oldest') {
        q = q.orderBy('last_refreshed_at', 'asc');
      } else {
        q = q.orderBy('is_pinned', 'desc').orderBy('last_refreshed_at', 'desc');
      }

      q = q.limit(limit);

      const snap = await q.get();
      let offers = [];
      snap.forEach(d => {
        const data = d.data();
        if (priceMin > 0 && data.price < priceMin) return;
        if (priceMax > 0 && data.price > priceMax) return;
        if (search) {
          const s = search.toLowerCase();
          if (!(data.title || '').toLowerCase().includes(s) && !(data.description || '').toLowerCase().includes(s)) return;
        }
        offers.push({
          id: d.id,
          title: data.title,
          price: data.price,
          category: data.category,
          condition: data.condition,
          wojewodztwo: data.wojewodztwo,
          miejscowosc: data.miejscowosc,
          mainImage: (data.images && data.images[0]) || '',
          imageCount: (data.images || []).length,
          seller_id: data.seller_id,
          seller_name: data.seller_name,
          status: data.status,
          is_pinned: data.is_pinned || false,
          slug: data.slug || d.id,
          created_at: data.created_at?._seconds ? new Date(data.created_at._seconds * 1000).toISOString() : data.created_at,
          last_refreshed_at: data.last_refreshed_at?._seconds ? new Date(data.last_refreshed_at._seconds * 1000).toISOString() : data.last_refreshed_at,
        });
      });

      return res.json({ success: true, offers, count: offers.length });
    }

    // GET /api/bazar/offer/:id - szczegoly oferty (publiczne jesli ACTIVE)
    if (req.method === 'GET' && action === 'offer' && subAction) {
      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const data = docSnap.data();
      const user = await getSessionUser(req);
      const userIsAdmin = user ? await isAdmin(user.uid) : false;

      if (data.status !== 'ACTIVE' && !userIsAdmin && (!user || user.uid !== data.seller_id)) {
        return res.status(403).json({ success: false, error: 'Oferta niedostepna' });
      }

      return res.json({
        success: true,
        offer: {
          id: docSnap.id,
          title: data.title,
          description: data.description,
          price: data.price,
          category: data.category,
          condition: data.condition,
          wojewodztwo: data.wojewodztwo,
          miejscowosc: data.miejscowosc,
          images: data.images || [],
          seller_id: data.seller_id,
          seller_name: data.seller_name,
          status: data.status,
          is_pinned: data.is_pinned || false,
          slug: data.slug || docSnap.id,
          created_at: data.created_at,
          approved_at: data.approved_at,
          expires_at: data.expires_at,
          last_refreshed_at: data.last_refreshed_at,
        }
      });
    }

    // GET /api/bazar/slug/:slug — publicznie tylko ACTIVE (admin/sprzedawca: dowolny status)
    if (req.method === 'GET' && action === 'slug' && subAction) {
      const slug = decodeURIComponent(pathParts.slice(1).join('/') || subAction);
      if (!slug) return res.status(400).json({ success: false, error: 'Brak sluga' });

      const snap = await db.collection('bazarOffers').where('slug', '==', slug).limit(8).get();
      if (snap.empty) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const user = await getSessionUser(req);
      const userIsAdmin = user ? await isAdmin(user.uid) : false;

      let chosenId = null;
      let data = null;
      for (const d of snap.docs) {
        const row = d.data();
        if (row.status === 'ACTIVE') {
          chosenId = d.id;
          data = row;
          break;
        }
      }
      if (!chosenId) {
        for (const d of snap.docs) {
          const row = d.data();
          if (userIsAdmin || (user && user.uid === row.seller_id)) {
            chosenId = d.id;
            data = row;
            break;
          }
        }
      }
      if (!chosenId || !data) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      return res.json({
        success: true,
        offer: {
          id: chosenId,
          title: data.title,
          description: data.description,
          price: data.price,
          category: data.category,
          condition: data.condition,
          wojewodztwo: data.wojewodztwo,
          miejscowosc: data.miejscowosc,
          images: data.images || [],
          seller_id: data.seller_id,
          seller_name: data.seller_name,
          status: data.status,
          is_pinned: data.is_pinned || false,
          slug: data.slug || chosenId,
          created_at: data.created_at,
          approved_at: data.approved_at,
          expires_at: data.expires_at,
          last_refreshed_at: data.last_refreshed_at,
        }
      });
    }

    // Na Vercel cron jest na plaskim URL: /api/bazar-cron-expire (api/bazar-cron-expire.js).
    // Zostawione dla kompatybilnosci, jesli hosting przekaze pelna sciezke do tego handlera.
    if ((req.method === 'POST' || req.method === 'GET') && action === 'cron' && subAction === 'expire') {
      const { handleBazarExpireCron } = require('./_bazar-expire-cron');
      return handleBazarExpireCron(req, res);
    }

    // POST /api/bazar/create - nowa oferta (wymaga zalogowania)
    if (req.method === 'POST' && action === 'create') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const body = await readJsonBody(req);
      const { title, description, price, category, condition, wojewodztwo, miejscowosc, images } = body;

      if (!title || !price || !category || !condition || !wojewodztwo || !miejscowosc) {
        return res.status(400).json({ success: false, error: 'Brakujace pola: title, price, category, condition, wojewodztwo, miejscowosc' });
      }
      if (!CATEGORIES.includes(category)) return res.status(400).json({ success: false, error: 'Nieprawidlowa kategoria' });
      if (!CONDITIONS.includes(condition)) return res.status(400).json({ success: false, error: 'Nieprawidlowy stan' });
      if (!WOJEWODZTWA.includes(wojewodztwo)) return res.status(400).json({ success: false, error: 'Nieprawidlowe wojewodztwo' });

      const imgCheck = validateBazarImages(images);
      if (!imgCheck.ok) return res.status(400).json({ success: false, error: imgCheck.error });

      let sellerName = '';
      try {
        const profileDoc = await db.collection('publicProfiles').doc(user.uid).get();
        if (profileDoc.exists) sellerName = profileDoc.data()?.displayName || '';
      } catch (_) {}
      if (!sellerName) {
        try {
          const profileDoc = await db.collection('userProfiles').doc(user.uid).get();
          if (profileDoc.exists) sellerName = profileDoc.data()?.displayName || '';
        } catch (_) {}
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const slug = generateSlug(title, wojewodztwo);

      const offerData = {
        title: String(title).substring(0, 200),
        description: String(description || '').substring(0, 5000),
        price: parseFloat(price),
        category,
        condition,
        wojewodztwo,
        miejscowosc: String(miejscowosc).substring(0, 100),
        images: imgCheck.list,
        seller_id: user.uid,
        seller_name: sellerName,
        status: 'PENDING',
        is_pinned: false,
        promoted_until: null,
        slug,
        created_at: now,
        approved_at: null,
        expires_at: null,
        last_refreshed_at: now,
        rejection_reason: null,
      };

      const docRef = await db.collection('bazarOffers').add(offerData);
      return res.json({ success: true, id: docRef.id, slug });
    }

    // PUT /api/bazar/offer/:id - edycja oferty (wlasciciel lub admin)
    if (req.method === 'PUT' && action === 'offer' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const existing = docSnap.data();
      const userIsAdmin = await isAdmin(user.uid);

      if (existing.seller_id !== user.uid && !userIsAdmin) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }

      const body = await readJsonBody(req);
      const updates = {};

      if (body.title !== undefined) updates.title = String(body.title).substring(0, 200);
      if (body.description !== undefined) updates.description = String(body.description).substring(0, 5000);
      if (body.price !== undefined) updates.price = parseFloat(body.price);
      if (body.category !== undefined && CATEGORIES.includes(body.category)) updates.category = body.category;
      if (body.condition !== undefined && CONDITIONS.includes(body.condition)) updates.condition = body.condition;
      if (body.wojewodztwo !== undefined && WOJEWODZTWA.includes(body.wojewodztwo)) updates.wojewodztwo = body.wojewodztwo;
      if (body.miejscowosc !== undefined) updates.miejscowosc = String(body.miejscowosc).substring(0, 100);
      if (body.images !== undefined) {
        const imgCheck = validateBazarImages(body.images);
        if (!imgCheck.ok) return res.status(400).json({ success: false, error: imgCheck.error });
        updates.images = imgCheck.list;
      }

      if (updates.title || updates.wojewodztwo) {
        updates.slug = generateSlug(updates.title || existing.title, updates.wojewodztwo || existing.wojewodztwo);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'Brak zmian' });
      }

      await docRef.update(updates);
      return res.json({ success: true });
    }

    // POST /api/bazar/admin/approve/:id
    if (req.method === 'POST' && action === 'admin' && subAction === 'approve') {
      const user = await getSessionUser(req);
      if (!user || !(await isAdmin(user.uid))) return res.status(403).json({ success: false, error: 'Brak uprawnien admina' });

      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });

      const docRef = db.collection('bazarOffers').doc(offerId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const now = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000);

      await docRef.update({
        status: 'ACTIVE',
        approved_at: now,
        expires_at: expiresAt,
        last_refreshed_at: now,
        rejection_reason: null,
      });

      return res.json({ success: true });
    }

    // POST /api/bazar/admin/reject/:id
    if (req.method === 'POST' && action === 'admin' && subAction === 'reject') {
      const user = await getSessionUser(req);
      if (!user || !(await isAdmin(user.uid))) return res.status(403).json({ success: false, error: 'Brak uprawnien admina' });

      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });

      const body = await readJsonBody(req);
      const reason = body.reason || 'Brak podanego powodu';

      const docRef = db.collection('bazarOffers').doc(offerId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      await docRef.update({
        status: 'REJECTED',
        rejection_reason: String(reason).substring(0, 500),
      });

      return res.json({ success: true });
    }

    // POST /api/bazar/admin/pin/:id
    if (req.method === 'POST' && action === 'admin' && subAction === 'pin') {
      const user = await getSessionUser(req);
      if (!user || !(await isAdmin(user.uid))) return res.status(403).json({ success: false, error: 'Brak uprawnien admina' });

      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });

      const body = await readJsonBody(req);
      const pinned = body.pinned !== false;

      await db.collection('bazarOffers').doc(offerId).update({ is_pinned: pinned });
      return res.json({ success: true, is_pinned: pinned });
    }

    // POST /api/bazar/admin/sold/:id
    if (req.method === 'POST' && action === 'admin' && subAction === 'sold') {
      const user = await getSessionUser(req);
      if (!user || !(await isAdmin(user.uid))) return res.status(403).json({ success: false, error: 'Brak uprawnien admina' });

      const offerId = pathParts[2];
      if (!offerId) return res.status(400).json({ success: false, error: 'Brak ID oferty' });

      await db.collection('bazarOffers').doc(offerId).update({ status: 'SOLD' });
      return res.json({ success: true });
    }

    // GET /api/bazar/admin/all - wszystkie oferty (admin only)
    if (req.method === 'GET' && action === 'admin' && subAction === 'all') {
      const user = await getSessionUser(req);
      if (!user || !(await isAdmin(user.uid))) return res.status(403).json({ success: false, error: 'Brak uprawnien admina' });

      const statusFilter = url.searchParams.get('status') || '';
      const categoryFilter = url.searchParams.get('category') || '';
      const searchFilter = url.searchParams.get('search') || '';

      let q = db.collection('bazarOffers').orderBy('created_at', 'desc').limit(200);

      if (statusFilter && STATUSES.includes(statusFilter)) {
        q = db.collection('bazarOffers').where('status', '==', statusFilter).orderBy('created_at', 'desc').limit(200);
      }

      const snap = await q.get();
      let offers = [];
      snap.forEach(d => {
        const data = d.data();
        if (categoryFilter && CATEGORIES.includes(categoryFilter) && data.category !== categoryFilter) return;
        if (searchFilter) {
          const s = searchFilter.toLowerCase();
          if (!(data.title || '').toLowerCase().includes(s) && !(data.seller_name || '').toLowerCase().includes(s)) return;
        }
        offers.push({
          id: d.id,
          title: data.title,
          description: (data.description || '').substring(0, 200),
          price: data.price,
          category: data.category,
          condition: data.condition,
          wojewodztwo: data.wojewodztwo,
          miejscowosc: data.miejscowosc,
          mainImage: (data.images && data.images[0]) || '',
          images: data.images || [],
          seller_id: data.seller_id,
          seller_name: data.seller_name,
          status: data.status,
          is_pinned: data.is_pinned || false,
          slug: data.slug || d.id,
          rejection_reason: data.rejection_reason || null,
          created_at: data.created_at,
          approved_at: data.approved_at,
          expires_at: data.expires_at,
          last_refreshed_at: data.last_refreshed_at,
        });
      });

      return res.json({ success: true, offers, count: offers.length });
    }

    // POST /api/bazar/refresh/:id - odswiezenie oferty przez uzytkownika
    if (req.method === 'POST' && action === 'refresh' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const data = docSnap.data();
      if (data.seller_id !== user.uid) return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      if (data.status !== 'ACTIVE' && data.status !== 'EXPIRED') return res.status(400).json({ success: false, error: 'Oferta musi byc aktywna lub wygasla' });

      const lastRefresh = data.last_refreshed_at?.toDate ? data.last_refreshed_at.toDate() : new Date(data.last_refreshed_at);
      const daysSinceRefresh = (Date.now() - lastRefresh.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceRefresh < 25) {
        return res.status(400).json({ success: false, error: 'Odswiezenie mozliwe po 25 dniach', days_remaining: Math.ceil(25 - daysSinceRefresh) });
      }

      const now = admin.firestore.Timestamp.now();
      const newExpires = admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000);

      await docRef.update({
        last_refreshed_at: now,
        expires_at: newExpires,
        status: 'ACTIVE',
      });

      return res.json({ success: true });
    }

    // GET /api/bazar/my - oferty zalogowanego uzytkownika
    if (req.method === 'GET' && action === 'my') {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const snap = await db.collection('bazarOffers')
        .where('seller_id', '==', user.uid)
        .orderBy('created_at', 'desc')
        .limit(50)
        .get();

      let offers = [];
      snap.forEach(d => {
        const data = d.data();
        offers.push({
          id: d.id,
          title: data.title,
          price: data.price,
          category: data.category,
          condition: data.condition,
          status: data.status,
          is_pinned: data.is_pinned || false,
          mainImage: (data.images && data.images[0]) || '',
          rejection_reason: data.rejection_reason,
          created_at: data.created_at,
          expires_at: data.expires_at,
          last_refreshed_at: data.last_refreshed_at,
        });
      });

      return res.json({ success: true, offers, count: offers.length });
    }

    // POST /api/bazar/sold/:id - uzytkownik oznacza jako sprzedane
    if (req.method === 'POST' && action === 'sold' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const data = docSnap.data();
      if (data.seller_id !== user.uid && !(await isAdmin(user.uid))) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }

      await docRef.update({ status: 'SOLD' });
      return res.json({ success: true });
    }

    // DELETE /api/bazar/offer/:id - usun oferte
    if (req.method === 'DELETE' && action === 'offer' && subAction) {
      const user = await getSessionUser(req);
      if (!user) return res.status(401).json({ success: false, error: 'Wymagane zalogowanie' });

      const docRef = db.collection('bazarOffers').doc(subAction);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ success: false, error: 'Oferta nie znaleziona' });

      const data = docSnap.data();
      if (data.seller_id !== user.uid && !(await isAdmin(user.uid))) {
        return res.status(403).json({ success: false, error: 'Brak uprawnien' });
      }

      await docRef.delete();
      return res.json({ success: true });
    }

    return res.status(404).json({ success: false, error: 'Endpoint nie znaleziony' });

  } catch (error) {
    console.error('Bazar API error:', error);
    return res.status(500).json({ success: false, error: 'Blad serwera' });
  }
};
