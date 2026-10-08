const crypto = require("crypto");

// Signs a short-lived, tamper-evident `state` parameter for the social
// OAuth connect flow — mirrors storageService's signDownloadToken/
// verifyDownloadToken (HMAC with the DATA_ENCRYPTION_KEY-derived key,
// base64url). This is what lets the provider's callback (an unauthenticated
// browser redirect — no bearer token possible) recover which user
// initiated the connection.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a login redirect

function getSigningKey() {
  return crypto.createHash("sha256").update(process.env.DATA_ENCRYPTION_KEY || "").digest();
}

function signState({ userId, provider }) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${userId}:${provider}:${nonce}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", getSigningKey()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${hmac}`).toString("base64url");
}

// Returns { userId, provider } on success, or null on any failure
// (malformed, tampered, expired, or provider mismatch).
function verifyState(token, expectedProvider) {
  try {
    const decoded = Buffer.from(String(token), "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 5) return null;
    const [userId, provider, nonce, expiresAtRaw, hmac] = parts;

    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
    if (provider !== expectedProvider) return null;

    const payload = `${userId}:${provider}:${nonce}:${expiresAtRaw}`;
    const expected = crypto.createHmac("sha256", getSigningKey()).update(payload).digest("hex");
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(hmac);
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return null;
    }

    return { userId, provider };
  } catch {
    return null;
  }
}

module.exports = { signState, verifyState };
