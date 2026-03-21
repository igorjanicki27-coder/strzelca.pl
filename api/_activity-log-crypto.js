// Szyfrowanie pól audytu activityLogs (AES-256-GCM). Klucz tylko po stronie serwera (Vercel env).
const crypto = require("crypto");

const PREFIX = "al1:";

function getKeyBuffer() {
  const hex = process.env.ACTIVITY_LOG_ENCRYPTION_KEY;
  if (!hex || typeof hex !== "string") return null;
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return Buffer.from(trimmed, "hex");
}

function hasActivityLogEncryptionKey() {
  return !!getKeyBuffer();
}

function encryptActivityPayload(obj) {
  const key = getKeyBuffer();
  if (!key) {
    throw new Error("ACTIVITY_LOG_ENCRYPTION_KEY missing or invalid (wymagane 64 znaki hex = 32 bajty)");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(obj);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, enc, tag]).toString("base64");
}

function decryptActivityPayload(payload) {
  if (typeof payload !== "string" || !payload.startsWith(PREFIX)) return null;
  const key = getKeyBuffer();
  if (!key) return null;
  let raw;
  try {
    raw = Buffer.from(payload.slice(PREFIX.length), "base64");
  } catch {
    return null;
  }
  if (raw.length < 12 + 16 + 1) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

module.exports = {
  encryptActivityPayload,
  decryptActivityPayload,
  hasActivityLogEncryptionKey,
};
