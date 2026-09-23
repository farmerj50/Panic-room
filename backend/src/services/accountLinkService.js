const crypto = require("crypto");

const prisma = require("../config/db");
const { hashLookup } = require("./cryptoService");
const { MAX_LINKED_ACCOUNTS_PRO } = require("./subscriptionService");

// Sibling to passwordResetService.js, same secret-code shape (codeHash /
// expiresAt / consumedAt / attempts) — but passwordResetService's 6-digit
// numeric code is scoped to an already-known userId at lookup time (the
// requester proved identity via email first). An invite code has no known
// owner at redemption time: the lookup is a global
// `findFirst({ where: { codeHash } })`, so 6 digits is too weak against
// unscoped guessing. This uses a 10-character alphabet excluding
// ambiguous characters (0/O/1/I), displayed XXXX-XXXX-XX.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const CODE_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000; // invites are shared out-of-band (SMS/share sheet), not same-session like password reset
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode() {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return raw;
}

function formatCode(raw) {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
}

// Accepts either the formatted (XXXX-XXXX-XX) or raw form and normalizes
// to the raw uppercase form hashLookup was computed against.
function normalizeCode(input) {
  return String(input || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

// Caller (the controller) is responsible for the requirePremium gate and
// the numeric cap check before calling this — this function only creates
// the row and returns the plaintext code, which is never stored.
async function issueInvite(ownerUserId, relationshipType) {
  const rawCode = generateCode();
  const link = await prisma.accountLink.create({
    data: {
      ownerUserId,
      relationshipType,
      status: "pending",
      codeHash: hashLookup(rawCode),
      expiresAt: new Date(Date.now() + CODE_EXPIRES_IN_MS),
    },
  });

  return { link, code: formatCode(rawCode) };
}

// Read-only lookup for the consent-preview step — never mutates the row.
// Returns { ok: true, link } or { ok: false, reason }.
async function findPendingLinkByCode(rawInput) {
  const code = normalizeCode(rawInput);
  const link = await prisma.accountLink.findFirst({
    where: { codeHash: hashLookup(code), status: "pending", consumedAt: null },
    include: { ownerUser: { select: { id: true, nameEncrypted: true } } },
  });

  if (!link) return { ok: false, reason: "invalid_code" };
  if (link.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (link.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  return { ok: true, link };
}

// Fails closed on anything but an exact, unexpired, unconsumed,
// under-attempt-limit match, mirroring passwordResetService's
// verifyAndConsumeResetCode. Re-checks the owner's cap at accept time too
// (not just at invite-creation time) — counting pending+active rows for
// that owner *excluding this link itself*, since accepting it converts an
// already-counted slot rather than adding a new one; this guards the race
// where some other process pushed the owner's other rows to >= the cap in
// the gap between invite-creation and this accept call.
async function acceptInvite(linkedUserId, rawInput) {
  const lookup = await findPendingLinkByCode(rawInput);
  if (!lookup.ok) return lookup;

  const { link } = lookup;

  if (link.ownerUserId === linkedUserId) {
    return { ok: false, reason: "cannot_link_self" };
  }

  const otherSlotsCount = await prisma.accountLink.count({
    where: {
      ownerUserId: link.ownerUserId,
      status: { in: ["pending", "active"] },
      id: { not: link.id },
    },
  });
  if (otherSlotsCount >= MAX_LINKED_ACCOUNTS_PRO) {
    return { ok: false, reason: "owner_at_cap" };
  }

  const updated = await prisma.accountLink.update({
    where: { id: link.id },
    data: {
      linkedUserId,
      status: "active",
      consumedAt: new Date(),
      acceptedAt: new Date(),
    },
  });

  return { ok: true, link: updated };
}

module.exports = {
  issueInvite,
  findPendingLinkByCode,
  acceptInvite,
};
