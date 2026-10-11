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

// Streams a stored file with HTTP Range support (206 Partial Content), which
// browsers need to seek in <video> and which iOS Safari requires to play at
// all. Returns false when the file doesn't exist (caller sends the 404).
function streamFile(key, req, res) {
  const filePath = getFilePath(key);
  if (!filePath) return false;

  const { size } = fs.statSync(filePath);
  const ext = path.extname(key);
  if (ext) res.type(ext);
  res.setHeader("Accept-Ranges", "bytes");

  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  let start = 0;
  let end = size - 1;
  if (range && (range[1] !== "" || range[2] !== "")) {
    if (range[1] === "") {
      // Suffix range: the last N bytes.
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
    }
    if (start > end || start >= size) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return true;
    }
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  } else {
    res.status(200);
  }
  res.setHeader("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
  return true;
}

// Generic short-lived HMAC for other signed links (Live View media). The
// payload is caller-defined and must already bind everything the URL grants.
function signPayload(payload) {
  return crypto.createHmac("sha256", getSigningKey()).update(`payload:${payload}`).digest("base64url");
}

function verifyPayload(payload, signature) {
  const expected = Buffer.from(signPayload(payload));
  const actual = Buffer.from(String(signature || ""));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Uploaded evidence must survive redeploys. On Railway that means STORAGE_DIR
// is a mounted Volume — never a path inside the app's own (ephemeral)
// directory. Returns { durable, problems[], volumeId } and never throws. The
// volume id is written once to the storage root; if it changes between
// deploys, the storage is NOT persisting.
function checkStorageDurability({ env = process.env, appDir = process.cwd() } = {}) {
  const problems = [];
  const dir = env.STORAGE_DIR;
  if (!dir) problems.push("STORAGE_DIR is not set (files go to the container filesystem)");
  const resolved = path.resolve(dir || STORAGE_DIR);
  const app = path.resolve(appDir) + path.sep;
  if (dir && (resolved + path.sep).startsWith(app)) {
    problems.push("STORAGE_DIR is inside the app directory (wiped on redeploy)");
  }
  let volumeId = null;
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
    const marker = path.join(resolved, ".bes-volume-id");
    if (fs.existsSync(marker)) {
      volumeId = fs.readFileSync(marker, "utf8").trim();
    } else {
      volumeId = crypto.randomUUID();
      fs.writeFileSync(marker, volumeId);
    }
  } catch {
    problems.push("STORAGE_DIR is not writable");
  }
  return { durable: problems.length === 0, problems, volumeId };
}

function getSignedDownloadUrl(key, baseUrl) {
  const token = signDownloadToken(key);
  return `${baseUrl}/api/recordings/file/${encodeURIComponent(key)}?token=${token}`;
}

module.exports = {
  STORAGE_DIR,
  checkStorageDurability,
  signPayload,
  streamFile,
  verifyPayload,
  deleteUserFiles,
  getFilePath,
  getFileStream,
  getSignedDownloadUrl,
  hasStorageConfigured,
  saveFile,
  verifyDownloadToken,
};
