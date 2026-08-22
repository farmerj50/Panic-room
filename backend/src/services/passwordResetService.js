const crypto = require("crypto");

const prisma = require("../config/db");
const { hashLookup } = require("./cryptoService");

const CODE_EXPIRES_IN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Invalidates any prior outstanding code for this user (only one active code
// at a time) and issues a new one. Returns the plaintext code — the caller is
// responsible for delivering it (SMS); only its hash is ever stored.
async function issueResetCode(userId) {
  await prisma.passwordResetToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateCode();
  await prisma.passwordResetToken.create({
    data: {
      userId,
      codeHash: hashLookup(code),
      expiresAt: new Date(Date.now() + CODE_EXPIRES_IN_MS),
    },
  });

  return code;
}

// Fails closed on anything but an exact, unexpired, not-yet-consumed,
// under-attempt-limit match. Single-use by construction: a verified code is
// marked consumed immediately, so it can never be replayed.
async function verifyAndConsumeResetCode(userId, code) {
  const token = await prisma.passwordResetToken.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!token) return { ok: false, reason: "no_active_code" };
  if (token.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (token.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  if (hashLookup(code) !== token.codeHash) {
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid_code" };
  }

  await prisma.passwordResetToken.update({
    where: { id: token.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true };
}

module.exports = { issueResetCode, verifyAndConsumeResetCode };
