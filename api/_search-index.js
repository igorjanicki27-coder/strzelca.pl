const TYPE_USER = 'user';
const TYPE_SHOP = 'shop';
const TYPE_EVENT = 'event';
const TYPE_BLOG = 'blog';
const TYPE_BAZAR = 'bazar';

const SEARCH_INDEX_COLLECTION = 'searchIndex';

const SEARCH_TYPES = [TYPE_USER, TYPE_SHOP, TYPE_EVENT, TYPE_BLOG, TYPE_BAZAR];

const STOP_WORDS = new Set([
  'a', 'aby', 'ale', 'albo', 'ani', 'az', 'bez', 'bo', 'by', 'byc', 'byl', 'byla', 'byli', 'byly',
  'co', 'czy', 'dla', 'do', 'gdy', 'i', 'ich', 'ile', 'im', 'inny', 'jak', 'jako', 'jeden', 'jego',
  'jej', 'jest', 'jesli', 'juz', 'kiedy', 'kto', 'ktory', 'ktora', 'ktore', 'lub', 'ma', 'maja',
  'mi', 'mna', 'mnie', 'moj', 'moja', 'moje', 'na', 'nad', 'nam', 'nas', 'nasz', 'nasza', 'nasze',
  'nie', 'nich', 'nim', 'niemu', 'o', 'od', 'oraz', 'po', 'pod', 'poniewaz', 'przez', 'przy', 'sa',
  'sie', 'soba', 'sobie', 'swoj', 'ta', 'tak', 'takze', 'tam', 'te', 'tego', 'tej', 'ten', 'to',
  'tu', 'twoj', 'twoja', 'twoje', 'u', 'w', 'we', 'wiec', 'z', 'za', 'ze', 'to', 'the', 'of', 'or',
]);

function normalizeText(input) {
  if (input == null) return '';
  const raw = String(input)
    .replace(/[Łł]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return raw
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(input) {
  if (input == null) return '';
  return String(input)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function tokenize(text) {
  const n = normalizeText(text);
  if (!n) return [];
  const parts = n.split(' ');
  return unique(
    parts.filter((p) => {
      if (!p) return false;
      if (p.length < 2) return false;
      if (STOP_WORDS.has(p)) return false;
      return true;
    }),
  );
}

function buildSearchKeys(tokens) {
  const out = [];
  for (const token of tokens) {
    const t = normalizeText(token);
    if (!t || t.length < 3) continue;
    const max = Math.min(t.length, 12);
    for (let len = 3; len <= max; len += 1) {
      out.push(t.slice(0, len));
    }
  }
  return unique(out);
}

function toSnippet(text, max = 220) {
  const plain = stripHtml(text || '');
  if (!plain) return '';
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trim()}…`;
}

function normalizePopularity(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function makeIndexDocId(type, sourceId) {
  return `${String(type || '').trim()}__${String(sourceId || '').trim()}`;
}

function compactMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

function createIndexEntry({ type, sourceId, title, snippet, url, slug, extraText, tokensSeed, popularity, meta }) {
  const safeTitle = String(title || '').trim();
  if (!safeTitle) return null;

  const safeSnippet = toSnippet(snippet || '');
  const joined = [safeTitle, safeSnippet, extraText || '', tokensSeed || ''].join(' ').trim();
  const tokens = tokenize(joined).slice(0, 90);
  const searchKeys = buildSearchKeys(tokens).slice(0, 500);

  return {
    type,
    sourceId: String(sourceId || '').trim(),
    title: safeTitle,
    snippet: safeSnippet,
    url: typeof url === 'string' ? url : '',
    slug: typeof slug === 'string' ? slug : '',
    tokens,
    searchKeys,
    popularity: normalizePopularity(popularity),
    meta: compactMeta(meta),
  };
}

function fromTimestampLike(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch (_) {
      return null;
    }
  }
  if (typeof value === 'object' && value._seconds != null) {
    return new Date(value._seconds * 1000);
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildUserEntry({ uid, publicProfile, userProfile, emailVerified }) {
  const displayName = String(userProfile?.displayName || publicProfile?.displayName || '').trim();
  const status = String(userProfile?.status || '').toLowerCase();
  const verified = emailVerified === true;

  if (!uid || !displayName) return null;
  if (!verified) return null;
  if (status && status !== 'active') return null;

  return createIndexEntry({
    type: TYPE_USER,
    sourceId: uid,
    title: displayName,
    snippet: '',
    url: `https://konto.strzelca.pl/profil.html?uid=${encodeURIComponent(uid)}`,
    slug: uid,
    extraText: displayName,
    popularity: 0,
    meta: {
      username: displayName,
      avatar: typeof publicProfile?.avatar === 'string' ? publicProfile.avatar : '',
      verified: true,
      status: status || 'active',
    },
  });
}

function buildProductEntry(sourceId, data) {
  if (!sourceId || !data) return null;
  const title = String(data.title || '').trim();
  if (!title) return null;
  const snippet = data.description || data.desc || '';
  const images = Array.isArray(data.images) ? data.images : [];
  const mainImage = images[0]?.url || images[0] || data.img || '';

  return createIndexEntry({
    type: TYPE_SHOP,
    sourceId,
    title,
    snippet,
    url: `https://sklep.strzelca.pl/?open=${encodeURIComponent(sourceId)}`,
    slug: sourceId,
    extraText: `${data.price || ''}`,
    popularity: 0,
    meta: {
      price: String(data.price || ''),
      image: typeof mainImage === 'string' ? mainImage : '',
    },
  });
}

function buildEventEntry(sourceId, data) {
  if (!sourceId || !data) return null;
  if (data.published === false) return null;
  const title = String(data.title || '').trim();
  if (!title) return null;
  const date = fromTimestampLike(data.date);

  return createIndexEntry({
    type: TYPE_EVENT,
    sourceId,
    title,
    snippet: data.description || '',
    url: `https://wydarzenia.strzelca.pl/?open=${encodeURIComponent(sourceId)}`,
    slug: sourceId,
    extraText: `${data.location || ''} ${data.category || ''}`,
    popularity: 0,
    meta: {
      category: String(data.category || ''),
      location: String(data.location || ''),
      dateIso: date ? date.toISOString() : '',
    },
  });
}

function buildBlogEntry(sourceId, data) {
  if (!sourceId || !data) return null;
  if (String(data.status || '') !== 'published') return null;
  const title = String(data.title || '').trim();
  if (!title) return null;
  const created = fromTimestampLike(data.createdAt || data.updatedAt);

  return createIndexEntry({
    type: TYPE_BLOG,
    sourceId,
    title,
    snippet: data.excerpt || data.content || '',
    url: `https://blog.strzelca.pl/?open=${encodeURIComponent(sourceId)}`,
    slug: sourceId,
    extraText: `${data.category || ''}`,
    popularity: 0,
    meta: {
      category: String(data.category || ''),
      dateIso: created ? created.toISOString() : '',
      image: String(data.imageUrl || data.images?.[0]?.url || ''),
    },
  });
}

function buildBazarEntry(sourceId, data) {
  if (!sourceId || !data) return null;
  if (String(data.status || '').toUpperCase() !== 'ACTIVE') return null;
  const title = String(data.title || '').trim();
  if (!title) return null;
  const slug = String(data.slug || sourceId);

  return createIndexEntry({
    type: TYPE_BAZAR,
    sourceId,
    title,
    snippet: data.description || '',
    url: `https://bazar.strzelca.pl/?offer=${encodeURIComponent(sourceId)}`,
    slug,
    extraText: `${data.category || ''} ${data.wojewodztwo || ''} ${data.miejscowosc || ''}`,
    popularity: normalizePopularity(Number(data.popularity || data.views || data.views_count || 0)),
    meta: {
      category: String(data.category || ''),
      condition: String(data.condition || ''),
      price: String(data.price || ''),
      wojewodztwo: String(data.wojewodztwo || ''),
      miejscowosc: String(data.miejscowosc || ''),
      sellerId: String(data.seller_id || ''),
      sellerName: String(data.seller_name || ''),
      image: String((Array.isArray(data.images) ? data.images[0] : '') || data.mainImage || ''),
    },
  });
}

function buildEntryByType(type, sourceId, data, ctx = {}) {
  switch (type) {
    case TYPE_USER:
      return buildUserEntry({
        uid: sourceId,
        publicProfile: ctx.publicProfile,
        userProfile: ctx.userProfile,
        emailVerified: ctx.emailVerified,
      });
    case TYPE_SHOP:
      return buildProductEntry(sourceId, data);
    case TYPE_EVENT:
      return buildEventEntry(sourceId, data);
    case TYPE_BLOG:
      return buildBlogEntry(sourceId, data);
    case TYPE_BAZAR:
      return buildBazarEntry(sourceId, data);
    default:
      return null;
  }
}

async function upsertIndexEntry(db, admin, entry) {
  if (!entry || !entry.type || !entry.sourceId) return false;
  const id = makeIndexDocId(entry.type, entry.sourceId);
  const payload = {
    ...entry,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection(SEARCH_INDEX_COLLECTION).doc(id).set(payload, { merge: true });
  return true;
}

async function deleteIndexEntry(db, type, sourceId) {
  const id = makeIndexDocId(type, sourceId);
  await db.collection(SEARCH_INDEX_COLLECTION).doc(id).delete().catch(() => null);
}

async function readSourceForType(db, type, sourceId) {
  if (!sourceId) return null;
  if (type === TYPE_USER) {
    const [publicSnap, userSnap] = await Promise.all([
      db.collection('publicProfiles').doc(sourceId).get(),
      db.collection('userProfiles').doc(sourceId).get(),
    ]);
    return {
      publicProfile: publicSnap.exists ? publicSnap.data() : null,
      userProfile: userSnap.exists ? userSnap.data() : null,
    };
  }

  const collectionMap = {
    [TYPE_SHOP]: 'products',
    [TYPE_EVENT]: 'events',
    [TYPE_BLOG]: 'blogPosts',
    [TYPE_BAZAR]: 'bazarOffers',
  };
  const coll = collectionMap[type];
  if (!coll) return null;
  const snap = await db.collection(coll).doc(sourceId).get();
  if (!snap.exists) return null;
  return snap.data();
}

async function syncEntryFromSource({ db, admin, type, sourceId, emailVerified = null }) {
  if (!SEARCH_TYPES.includes(type)) {
    throw new Error('unsupported-type');
  }

  const source = await readSourceForType(db, type, sourceId);
  if (!source) {
    await deleteIndexEntry(db, type, sourceId);
    return { synced: false, deleted: true, reason: 'source-not-found' };
  }

  let entry = null;
  if (type === TYPE_USER) {
    entry = buildEntryByType(type, sourceId, null, {
      publicProfile: source.publicProfile,
      userProfile: source.userProfile,
      emailVerified,
    });
  } else {
    entry = buildEntryByType(type, sourceId, source);
  }

  if (!entry) {
    await deleteIndexEntry(db, type, sourceId);
    return { synced: false, deleted: true, reason: 'not-indexable' };
  }

  await upsertIndexEntry(db, admin, entry);
  return { synced: true, deleted: false };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function listAllVerifiedUidsSafe(admin) {
  try {
    const out = new Set();
    let pageToken;
    do {
      const page = await admin.auth().listUsers(1000, pageToken);
      for (const u of page.users || []) {
        if (u.emailVerified === true) out.add(u.uid);
      }
      pageToken = page.pageToken;
    } while (pageToken);
    return out;
  } catch (e) {
    console.warn('listAllVerifiedUidsSafe fallback:', e?.message || e);
    return null;
  }
}

async function fetchAllSourceEntries(db, admin, type) {
  if (type === TYPE_USER) {
    const verifiedUids = await listAllVerifiedUidsSafe(admin);
    const [publicSnap, userSnap] = await Promise.all([
      db.collection('publicProfiles').get(),
      db.collection('userProfiles').get(),
    ]);

    const publicProfiles = new Map(publicSnap.docs.map((d) => [d.id, d.data()]));
    const userProfiles = new Map(userSnap.docs.map((d) => [d.id, d.data()]));
    const allUids = new Set([...publicProfiles.keys(), ...userProfiles.keys()]);
    const items = [];

    for (const uid of allUids) {
      const userProfile = userProfiles.get(uid) || null;
      items.push({
        sourceId: uid,
        data: null,
        ctx: {
          publicProfile: publicProfiles.get(uid) || null,
          userProfile,
          emailVerified: verifiedUids
            ? verifiedUids.has(uid)
            : userProfile?.emailVerified === true,
        },
      });
    }
    return items;
  }

  const map = {
    [TYPE_SHOP]: 'products',
    [TYPE_EVENT]: 'events',
    [TYPE_BLOG]: 'blogPosts',
    [TYPE_BAZAR]: 'bazarOffers',
  };
  const coll = map[type];
  const snap = await db.collection(coll).get();
  return snap.docs.map((d) => ({ sourceId: d.id, data: d.data(), ctx: {} }));
}

async function rebuildType({ db, admin, type, dryRun = false }) {
  const sourceItems = await fetchAllSourceEntries(db, admin, type);
  const existingSnap = await db.collection(SEARCH_INDEX_COLLECTION).where('type', '==', type).get();
  const desiredIds = new Set();

  let upserts = 0;
  let deletes = 0;
  let skipped = 0;

  const ops = [];
  for (const item of sourceItems) {
    const entry = type === TYPE_USER
      ? buildEntryByType(type, item.sourceId, null, item.ctx)
      : buildEntryByType(type, item.sourceId, item.data, item.ctx);

    if (!entry) {
      skipped += 1;
      continue;
    }

    const id = makeIndexDocId(type, item.sourceId);
    desiredIds.add(id);

    if (!dryRun) {
      ops.push({ op: 'set', id, data: entry });
    }
    upserts += 1;
  }

  for (const doc of existingSnap.docs) {
    if (!desiredIds.has(doc.id)) {
      if (!dryRun) {
        ops.push({ op: 'delete', id: doc.id });
      }
      deletes += 1;
    }
  }

  if (!dryRun && ops.length) {
    for (const batchOps of chunk(ops, 400)) {
      const batch = db.batch();
      for (const op of batchOps) {
        const ref = db.collection(SEARCH_INDEX_COLLECTION).doc(op.id);
        if (op.op === 'set') {
          batch.set(
            ref,
            {
              ...op.data,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        } else {
          batch.delete(ref);
        }
      }
      await batch.commit();
    }
  }

  return {
    type,
    sourceTotal: sourceItems.length,
    upserts,
    deletes,
    skipped,
    dryRun,
  };
}

async function rebuildSearchIndex({ db, admin, type = 'all', dryRun = false }) {
  const types = type === 'all' ? SEARCH_TYPES : [type];
  const summaries = [];
  for (const t of types) {
    summaries.push(await rebuildType({ db, admin, type: t, dryRun }));
  }
  return summaries;
}

module.exports = {
  SEARCH_INDEX_COLLECTION,
  SEARCH_TYPES,
  TYPE_USER,
  TYPE_SHOP,
  TYPE_EVENT,
  TYPE_BLOG,
  TYPE_BAZAR,
  normalizeText,
  stripHtml,
  tokenize,
  buildSearchKeys,
  makeIndexDocId,
  buildEntryByType,
  upsertIndexEntry,
  deleteIndexEntry,
  syncEntryFromSource,
  rebuildSearchIndex,
};
