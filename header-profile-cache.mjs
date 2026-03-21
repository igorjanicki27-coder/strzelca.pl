/**
 * Cache nagłówka (nick + avatar + rola) w localStorage — mniej odczytów userProfiles z Firestore
 * przy każdym przeładowaniu subdomeny. Po zmianie avatara w profilu wywołaj setHeaderProfileCache
 * lub invalidateHeaderProfileCache.
 */

const STORAGE_KEY = "strzelca_header_profile_v1";
/** Domyślnie 24 h — awatar/nick rzadko się zmieniają; po edycji w profilu cache jest aktualizowany. */
export const HEADER_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore (np. tryb prywatny)
  }
}

/**
 * @param {string} uid
 * @param {number} [ttlMs]
 * @returns {{ displayName: string, avatar: string, gender: *|null, role: string|null, profileExists: boolean } | null}
 */
export function getHeaderProfileFromCache(uid, ttlMs = HEADER_PROFILE_CACHE_TTL_MS) {
  if (!uid || typeof uid !== "string") return null;
  const all = readAll();
  const e = all[uid];
  if (!e || typeof e.ts !== "number") return null;
  if (Date.now() - e.ts > ttlMs) return null;
  return {
    displayName: typeof e.displayName === "string" ? e.displayName : "",
    avatar: typeof e.avatar === "string" ? e.avatar : "",
    gender: e.gender === undefined ? null : e.gender,
    role: typeof e.role === "string" ? e.role : null,
    profileExists: e.profileExists !== false,
  };
}

/**
 * @param {string} uid
 * @param {{ displayName?: string, avatar?: string, gender?: *|null, role?: string|null, profileExists?: boolean }} fields
 */
export function setHeaderProfileCache(uid, fields = {}) {
  if (!uid || typeof uid !== "string") return;
  const all = readAll();
  all[uid] = {
    ts: Date.now(),
    displayName: fields.displayName == null ? "" : String(fields.displayName),
    avatar: fields.avatar == null ? "" : String(fields.avatar),
    gender: fields.gender === undefined ? null : fields.gender,
    role: fields.role == null || fields.role === undefined ? null : String(fields.role),
    profileExists: fields.profileExists !== false,
  };
  writeAll(all);
}

export function invalidateHeaderProfileCache(uid) {
  if (!uid || typeof uid !== "string") return;
  const all = readAll();
  delete all[uid];
  writeAll(all);
}
