const crypto = require("crypto");

const prisma = require("../config/db");
const { hashLookup } = require("./cryptoService");

const REFRESH_TOKEN_EXPIRES_IN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_TOKEN_BYTES = 32;

function generateRawToken() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

async function issueRefreshToken(userId, meta = {}) {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_MS);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashLookup(rawToken),
      expiresAt,
      userAgent: meta.userAgent || null,
    },
  });

  return rawToken;
}

async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashLookup(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Rotates a refresh token: validates it, revokes it, and issues a replacement.
// If a token that was already revoked is presented again, that's a signal of
// possible theft/reuse (the legitimate holder should already have the newer
// token), so every other active token for that user is revoked too.
async function rotateRefreshToken(rawToken, meta = {}) {
  if (!rawToken) return null;

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashLookup(rawToken) },
  });

  if (!existing) return null;

  if (existing.revokedAt || existing.expiresAt < new Date()) {
    if (existing.revokedAt) {
      await revokeAllForUser(existing.userId);
    }
    return null;
  }

  const newRawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_MS);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenHash: hashLookup(newRawToken),
      },
    }),
    prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashLookup(newRawToken),
        expiresAt,
        userAgent: meta.userAgent || null,
      },
    }),
  ]);

  return { userId: existing.userId, rawToken: newRawToken };
}

module.exports = {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
};
