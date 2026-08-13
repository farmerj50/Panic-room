const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Railway Volume (or any mounted persistent directory) is expected at
// STORAGE_DIR. Falls back to a local dev directory when unset so the app
// works without a volume during local development.
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), "storage", "recordings");
const SIGNED_URL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hasStorageConfigured() {
  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    fs.accessSync(STORAGE_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function userDir(userId) {
  const dir = path.join(STORAGE_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Never derive a filesystem path directly from client input beyond the
// userId (already authenticated) and a generated filename — resolveKeyPath
// additionally verifies the result stays inside STORAGE_DIR as defense in
// depth against path traversal.
function resolveKeyPath(key) {
  const resolved = path.resolve(STORAGE_DIR, key);
  const root = path.resolve(STORAGE_DIR) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

// Called when an account is deleted — removes every file this user ever
// uploaded (recordings, covert-message images). Files other users uploaded
// (e.g. a covert message they sent to this user) live under the SENDER's
// own directory and are untouched by this.
function deleteUserFiles(userId) {
  const dir = path.join(STORAGE_DIR, userId);
  fs.rmSync(dir, { recursive: true, force: true });
}

function saveFile({ userId, buffer, ext }) {
  const safeExt = ext ? ext.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
  const filename = `${crypto.randomUUID()}${safeExt ? `.${safeExt}` : ""}`;
  const dir = userDir(userId);
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `${userId}/${filename}`;
}

function getFilePath(key) {
  const resolved = resolveKeyPath(key);
  return fs.existsSync(resolved) ? resolved : null;
}

function getFileStream(key) {
  const filePath = getFilePath(key);
  return filePath ? fs.createReadStream(filePath) : null;
}

function getSigningKey() {
  return crypto.createHash("sha256").update(process.env.DATA_ENCRYPTION_KEY || "").digest();
}

// Self-issued, short-lived signed download links — the equivalent of an S3
// presigned URL, needed because playback (Linking.openURL on the mobile
// side) can't attach an Authorization header. Security comes from the
// unguessable, expiring token, not from the URL being secret in structure.
function signDownloadToken(key) {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const hmac = crypto.createHmac("sha256", getSigningKey()).update(`${key}:${expiresAt}`).digest("hex");
  return Buffer.from(`${expiresAt}.${hmac}`).toString("base64url");
}

function verifyDownloadToken(key, token) {
  try {
    const decoded = Buffer.from(String(token), "base64url").toString("utf8");
    const [expiresAtRaw, hmac] = decoded.split(".");
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !hmac) return false;

    const expected = crypto.createHmac("sha256", getSigningKey()).update(`${key}:${expiresAt}`).digest("hex");
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(hmac);
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

function getSignedDownloadUrl(key, baseUrl) {
  const token = signDownloadToken(key);
  return `${baseUrl}/api/recordings/file/${encodeURIComponent(key)}?token=${token}`;
}

module.exports = {
  STORAGE_DIR,
  deleteUserFiles,
  getFilePath,
  getFileStream,
  getSignedDownloadUrl,
  hasStorageConfigured,
  saveFile,
  verifyDownloadToken,
};
