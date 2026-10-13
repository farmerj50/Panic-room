// Proof of ownership before deleting a Google-only account (no password):
//   1. a 6-digit code emailed to the account's (Google-verified) address, and
//   2. a fresh Google sign-in whose ID token carries this challenge's nonce
//      and was issued within FRESH_TOKEN_MS.
// Both must match one unconsumed, unexpired challenge, which is consumed
// atomically, so it can never be replayed.
const crypto = require("crypto");

const prisma = require("../config/db");
const { hashLookup } = require("./cryptoService");

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const FRESH_TOKEN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Replaces any open challenge. Returns the plaintext code (to email) and the
// nonce (for the app to pass to Google); only hashes are stored.
async function issueDeletionChallenge(userId) {
  await prisma.accountDeletionChallenge.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = generateCode();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const challenge = await prisma.accountDeletionChallenge.create({
    data: {
      userId,
      codeHash: hashLookup(`delete-code:${code}`),
      nonceHash: hashLookup(`delete-nonce:${nonce}`),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return { code, nonce, expiresAt: challenge.expiresAt };
}

// google: the verified token payload ({ subHash, nonce, iat }).
// Returns { ok: true } or { ok: false, reason }.
async function verifyAndConsumeDeletionChallenge(userId, { code, google, expectedSubHash }, now = Date.now()) {
  const challenge = await prisma.accountDeletionChallenge.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false, reason: "no_active_challenge" };
  if (challenge.expiresAt.getTime() < now) return { ok: false, reason: "expired" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  const codeOk = typeof code === "string" && hashLookup(`delete-code:${code.trim()}`) === challenge.codeHash;
  const nonceOk = typeof google?.nonce === "string" && hashLookup(`delete-nonce:${google.nonce}`) === challenge.nonceHash;
  const subOk = Boolean(expectedSubHash) && google?.subHash === expectedSubHash;
  const freshOk = Number.isFinite(google?.iat) && now - google.iat * 1000 <= FRESH_TOKEN_MS && google.iat * 1000 <= now + 60_000;

  if (!codeOk || !nonceOk || !subOk || !freshOk) {
    await prisma.accountDeletionChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    if (!codeOk) return { ok: false, reason: "invalid_code" };
    if (!subOk) return { ok: false, reason: "google_account_mismatch" };
    return { ok: false, reason: "google_reauth_required" };
  }

  // Atomic single use: only one concurrent request can consume it.
  const consumed = await prisma.accountDeletionChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1 ? { ok: true } : { ok: false, reason: "no_active_challenge" };
}

module.exports = { CHALLENGE_TTL_MS, FRESH_TOKEN_MS, issueDeletionChallenge, verifyAndConsumeDeletionChallenge };
