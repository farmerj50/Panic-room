const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION = "v1";

function getKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is required.");

  if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  }

  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(value) {
  if (value === undefined || value === null || value === "") return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    KEY_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decrypt(payload) {
  if (!payload) return null;

  const [version, iv, tag, ciphertext] = String(payload).split(":");
  if (version !== KEY_VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Encrypted value is malformed.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(iv, "base64url"),
    { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function hashLookup(value) {
  if (!value) return null;

  return crypto
    .createHmac("sha256", getKey())
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function safeDecrypt(payload) {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

module.exports = {
  decrypt,
  encrypt,
  hashLookup,
  safeDecrypt,
};
