/**
 * Cache list publicznych (IndexedDB) + wersja w Firestore: jeden odczyt getDoc na publicListCacheMeta/{id},
 * pełne getDocs tylko gdy wersja się zmieniła.
 */

export const PUBLIC_LIST_CACHE_META = "publicListCacheMeta";

const IDB_NAME = "strzelca_public_list_cache_v1";
const IDB_STORE = "entries";
const IDB_VER = 1;

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function idbDeleteEntry(key) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {
    /* ignore */
  }
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Konwersja Timestamp / Date do JSON (rekurencyjnie). */
export function toStorableDeep(value) {
  return JSON.parse(JSON.stringify(value, storableReplacer));
}

function storableReplacer(_, v) {
  if (v instanceof Date) return { __sd: v.toISOString() };
  if (v && typeof v === "object" && typeof v.toDate === "function") {
    try {
      return { __sd: v.toDate().toISOString() };
    } catch {
      return null;
    }
  }
  return v;
}

export function fromStorableDeep(value) {
  return reviveStorable(value);
}

function reviveStorable(x) {
  if (x == null) return x;
  if (typeof x === "object" && x !== null && typeof x.__sd === "string" && Object.keys(x).length === 1) {
    return new Date(x.__sd);
  }
  if (Array.isArray(x)) return x.map(reviveStorable);
  if (typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = reviveStorable(v);
    return o;
  }
  return x;
}

export async function readPublicListVersion(db, getDoc, docFn, metaDocId) {
  try {
    const snap = await getDoc(docFn(db, PUBLIC_LIST_CACHE_META, metaDocId));
    if (!snap.exists()) return null;
    const v = snap.data()?.v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  } catch (e) {
    console.warn("[publicListCacheMeta] read failed, fetching list without version:", e?.code || e?.message || e);
    return null;
  }
}

/** Wersja zapisana w IDB, gdy w Firestore nie ma jeszcze publicListCacheMeta/{id} (oszczędza powtarzane getDocs). */
const NO_META_VERSION_SENTINEL = -1;

/**
 * @param {object} opts
 * @param {import('firebase/firestore').Firestore} opts.db
 * @param {Function} opts.getDoc
 * @param {Function} opts.doc
 * @param {string} opts.idbKey — unikalny klucz (np. "list:products")
 * @param {string} opts.metaDocId — id w publicListCacheMeta (np. "products")
 * @param {() => Promise<any>} opts.fetchFresh — zwraca surową listę/obiekt do zapisu
 * @param {number} [opts.noMetaCacheTtlMs=0] — jeśli > 0 i brak meta w Firestore, użyj cache z IDB nie starszego niż TTL (bez getDocs)
 */
export async function loadWithVersionCache({
  db,
  getDoc,
  doc: docFn,
  idbKey,
  metaDocId,
  fetchFresh,
  noMetaCacheTtlMs = 0,
}) {
  const remoteV = await readPublicListVersion(db, getDoc, docFn, metaDocId);
  const local = await idbGet(idbKey);

  if (remoteV !== null && local && local.v === remoteV && local.payload !== undefined) {
    return { fromCache: true, version: remoteV, payload: fromStorableDeep(local.payload) };
  }

  if (
    remoteV === null &&
    noMetaCacheTtlMs > 0 &&
    local &&
    local.v === NO_META_VERSION_SENTINEL &&
    local.payload !== undefined &&
    typeof local.savedAt === "number"
  ) {
    const age = Date.now() - local.savedAt;
    if (age >= 0 && age < noMetaCacheTtlMs) {
      return {
        fromCache: true,
        version: null,
        payload: fromStorableDeep(local.payload),
        noMetaStale: true,
      };
    }
  }

  const raw = await fetchFresh();
  const storable = toStorableDeep(raw);
  if (remoteV !== null) {
    await idbPut(idbKey, { v: remoteV, payload: storable, savedAt: Date.now() });
  } else if (noMetaCacheTtlMs > 0) {
    await idbPut(idbKey, { v: NO_META_VERSION_SENTINEL, payload: storable, savedAt: Date.now() });
  }
  return { fromCache: false, version: remoteV, payload: fromStorableDeep(storable) };
}

/**
 * Bazar: lekki GET ?listVersionOnly=1, potem pełna lista tylko gdy wersja ≠ cache (IndexedDB).
 */
export async function loadBazarOffersWithCache(apiBase, idbKey = "bazar:home100") {
  const base = String(apiBase || "").replace(/\/+$/, "");
  const vRes = await fetch(`${base}?listVersionOnly=1`);
  const vJson = await vRes.json().catch(() => ({}));
  const listVersion = typeof vJson.listVersion === "number" && Number.isFinite(vJson.listVersion) ? vJson.listVersion : 0;
  const local = await idbGet(idbKey);
  if (local && local.v === listVersion && Array.isArray(local.offers)) {
    return { offers: local.offers, listVersion, fromCache: true };
  }
  const res = await fetch(`${base}?limit=100`);
  const data = await res.json().catch(() => ({}));
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const lv =
    typeof data.listVersion === "number" && Number.isFinite(data.listVersion) ? data.listVersion : listVersion;
  await idbPut(idbKey, { v: lv, offers, savedAt: Date.now() });
  return { offers, listVersion: lv, fromCache: false };
}
