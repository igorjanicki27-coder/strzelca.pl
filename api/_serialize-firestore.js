/**
 * Konwersja wartości z dokumentów Firestore (Admin SDK) na struktury bezpieczne dla JSON.
 */

function firestoreValueToJsonable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => firestoreValueToJsonable(v));
  }
  if (typeof value === 'object' && value !== null) {
    if (typeof value.path === 'string') {
      return value.path;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const j = firestoreValueToJsonable(v);
      if (j !== undefined) out[k] = j;
    }
    return out;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

module.exports = { firestoreValueToJsonable };
