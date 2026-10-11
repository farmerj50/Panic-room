// Emergency Live View: private, per-contact browser links that show one
// emergency's video clips and GPS while it's happening.
//
// Link security model (see also routes/liveViewRoutes.js):
//  - The token is 32 random bytes, delivered as https://…/live#<token>. The
//    fragment is never sent to any server, so the token can't land in proxy
//    or server logs, or a Referer header.
//  - Only sha256(token) is used for lookup. tokenEncrypted (AES-GCM) lets the
//    owner re-share the SAME link; sharing never disconnects a viewer.
//    Rotation is an explicit owner action.
//  - Video plays from short-lived signed media URLs bound to the link id and
//    its `generation`. Revoke/rotate bumps generation, and every media
//    request re-checks the link, so a leaked media URL dies immediately.
//  - A link only ever reaches its own emergency. Viewer responses carry the
//    owner's first name and nothing about the contacts.
//
// Nothing here may block an emergency: callers wrap these in try/catch.

const crypto = require("crypto");

const prisma = require("../config/db");
const { decrypt, encrypt, safeDecrypt } = require("./cryptoService");
const { signPayload, verifyPayload } = require("./storageService");
const { currentPhoneHash, firstNameOf } = require("./smsConsentService");

const HARD_TTL_MS = 72 * 60 * 60 * 1000;
const AFTER_END_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_URL_TTL_MS = 10 * 60 * 1000;
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_LOCATIONS = 20;

function isLiveViewEnabled() {
  return process.env.LIVE_VIEW_ENABLED === "true";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function liveViewUrl(baseUrl, token) {
  return `${baseUrl}/live#${token}`;
}

function effectiveExpiry(link, emergency) {
  const hard = new Date(link.hardExpiresAt).getTime();
  if (!emergency?.endedAt) return hard;
  return Math.min(hard, new Date(emergency.endedAt).getTime() + AFTER_END_TTL_MS);
}

// 'valid' | 'revoked' | 'expired' | 'number_changed'
function linkState(link, emergency, contact, now = Date.now()) {
  if (!link || !emergency || !contact) return "invalid";
  if (link.revokedAt) return "revoked";
  if (now > effectiveExpiry(link, emergency)) return "expired";
  if ((link.phoneHash || null) !== (currentPhoneHash(contact) || null)) return "number_changed";
  return "valid";
}

// Creates a link for every current trusted contact that doesn't have one for
// this emergency yet. Never touches existing links.
async function ensureLinks(emergency, { contactId } = {}) {
  const contacts = await prisma.trustedContact.findMany({
    where: { userId: emergency.userId, ...(contactId ? { id: contactId } : {}) },
  });
  if (contacts.length === 0) return 0;
  const hardExpiresAt = new Date(new Date(emergency.createdAt).getTime() + HARD_TTL_MS);
  const result = await prisma.liveViewLink.createMany({
    data: contacts.map((contact) => {
      const token = newToken();
      return {
        emergencyId: emergency.id,
        contactId: contact.id,
        userId: emergency.userId,
        tokenHash: sha256(token),
        tokenEncrypted: encrypt(token),
        phoneHash: currentPhoneHash(contact),
        hardExpiresAt,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

async function loadOwned(userId, emergencyId, contactId) {
  const emergency = await prisma.emergencyEvent.findFirst({ where: { id: emergencyId, userId } });
  if (!emergency) return {};
  const contact = await prisma.trustedContact.findFirst({ where: { id: contactId, userId } });
  return { emergency, contact };
}

async function rotate(link, contact) {
  const token = newToken();
  await prisma.liveViewLink.update({
    where: { id: link.id },
    data: {
      tokenHash: sha256(token),
      tokenEncrypted: encrypt(token),
      phoneHash: currentPhoneHash(contact),
      generation: { increment: 1 },
      revokedAt: null,
      rotatedAt: new Date(),
    },
  });
  return token;
}

// The owner's share link for one contact. Returns the SAME link every time
// while it's valid. A link the owner revoked (or whose contact number
// changed) has no viewer left to disconnect, so it is re-issued.
// Returns { url, expiresAt } | { error: 'not_found' | 'expired' }.
async function getShareLink({ userId, emergencyId, contactId, baseUrl }) {
  const { emergency, contact } = await loadOwned(userId, emergencyId, contactId);
  if (!emergency || !contact) return { error: "not_found" };

  await ensureLinks(emergency, { contactId });
  const link = await prisma.liveViewLink.findUnique({
    where: { emergencyId_contactId: { emergencyId, contactId } },
  });
  const state = linkState(link, emergency, contact);
  if (state === "expired") return { error: "expired" };

  const token = state === "valid" ? decrypt(link.tokenEncrypted) : await rotate(link, contact);
  return { url: liveViewUrl(baseUrl, token), expiresAt: new Date(effectiveExpiry(link, emergency)) };
}

// Explicit owner action: the old link (and its media URLs) stop working.
async function rotateLink({ userId, emergencyId, contactId, baseUrl }) {
  const { emergency, contact } = await loadOwned(userId, emergencyId, contactId);
  if (!emergency || !contact) return { error: "not_found" };
  await ensureLinks(emergency, { contactId });
  const link = await prisma.liveViewLink.findUnique({
    where: { emergencyId_contactId: { emergencyId, contactId } },
  });
  if (linkState(link, emergency, contact) === "expired") return { error: "expired" };
  const token = await rotate(link, contact);
  return { url: liveViewUrl(baseUrl, token), expiresAt: new Date(effectiveExpiry(link, emergency)) };
}

async function revokeLinks({ userId, emergencyId, contactId }) {
  const result = await prisma.liveViewLink.updateMany({
    where: { userId, emergencyId, ...(contactId ? { contactId } : {}), revokedAt: null },
    data: { revokedAt: new Date(), generation: { increment: 1 } },
  });
  return result.count;
}

// Called inside the contact-update transaction when the number changes.
async function revokeForContact(tx, contactId) {
  await tx.liveViewLink.updateMany({
    where: { contactId, revokedAt: null },
    data: { revokedAt: new Date(), generation: { increment: 1 } },
  });
}

// The current link for an SMS alert — never rotated or re-issued by dispatch.
async function existingLinkUrl({ emergency, contact, baseUrl }) {
  const link = await prisma.liveViewLink.findUnique({
    where: { emergencyId_contactId: { emergencyId: emergency.id, contactId: contact.id } },
  });
  if (linkState(link, emergency, contact) !== "valid") return null;
  return liveViewUrl(baseUrl, decrypt(link.tokenEncrypted));
}

async function ownerStatus({ userId, emergencyId }) {
  const links = await prisma.liveViewLink.findMany({
    where: { userId, emergencyId },
    include: { emergency: true, contact: true },
  });
  return links.map((link) => ({
    contactId: link.contactId,
    active: linkState(link, link.emergency, link.contact) === "valid",
    lastViewedAt: link.lastViewedAt,
    viewCount: link.viewCount,
  }));
}

// ── Viewer side ───────────────────────────────────────────────────────────

async function findByToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return { state: "invalid" };
  const link = await prisma.liveViewLink.findUnique({
    where: { tokenHash: sha256(token) },
    include: { emergency: true, contact: true },
  });
  if (!link) return { state: "invalid" };
  return { link, state: linkState(link, link.emergency, link.contact) };
}

function mediaPath(link, kind, sequence, now = Date.now()) {
  const exp = now + MEDIA_URL_TTL_MS;
  const ref = `${kind}${sequence}`;
  const sig = signPayload(`live-media:${link.id}:${link.generation}:${ref}:${exp}`);
  return `/live/media/${link.id}/${ref}?g=${link.generation}&exp=${exp}&sig=${sig}`;
}

// Validates a media request and returns the storage key to stream, or null.
// Re-checks the link in the database every time.
async function resolveMedia({ linkId, ref, g, exp, sig }) {
  const match = /^([va])(\d{1,6})$/.exec(String(ref || ""));
  const expires = Number(exp);
  const generation = Number(g);
  if (!match || !Number.isFinite(expires) || expires < Date.now() || !Number.isInteger(generation)) return null;
  if (!verifyPayload(`live-media:${linkId}:${generation}:${ref}:${expires}`, sig)) return null;

  const link = await prisma.liveViewLink.findUnique({
    where: { id: String(linkId) },
    include: { emergency: true, contact: true },
  });
  if (!link || link.generation !== generation) return null;
  if (linkState(link, link.emergency, link.contact) !== "valid") return null;

  const [, kind, seq] = match;
  if (kind === "a") return safeDecrypt(link.emergency.audioUrl);
  const segment = await prisma.emergencyVideoSegment.findUnique({
    where: { emergencyId_sequence: { emergencyId: link.emergencyId, sequence: Number(seq) } },
  });
  return segment ? safeDecrypt(segment.fileUrl) : null;
}

function decryptPoint(point) {
  const lat = Number(safeDecrypt(point.latitudeEncrypted));
  const lng = Number(safeDecrypt(point.longitudeEncrypted));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng, accuracy: point.accuracy ?? undefined, recordedAt: point.recordedAt };
}

// What the browser viewer sees. Scoped to the link's emergency only; no
// storage keys, contact details or phone numbers.
async function viewerState(link, { countOpen = false } = {}) {
  const emergencyId = link.emergencyId;
  const [user, segments, recent] = await Promise.all([
    prisma.user.findUnique({ where: { id: link.userId }, select: { nameEncrypted: true } }),
    prisma.emergencyVideoSegment.findMany({ where: { emergencyId }, orderBy: { sequence: "asc" } }),
    prisma.emergencyLocation.findMany({
      where: { emergencyId },
      orderBy: { recordedAt: "desc" },
      take: RECENT_LOCATIONS,
    }),
  ]);
  await prisma.liveViewLink.update({
    where: { id: link.id },
    data: { lastViewedAt: new Date(), ...(countOpen ? { viewCount: { increment: 1 } } : {}) },
  });

  const emergency = link.emergency;
  const recentLocations = recent.map(decryptPoint).filter(Boolean);
  let latestLocation = recentLocations[0] || null;
  if (!latestLocation) {
    const lat = Number(safeDecrypt(emergency.latitudeEncrypted));
    const lng = Number(safeDecrypt(emergency.longitudeEncrypted));
    if (Number.isFinite(lat) && Number.isFinite(lng) && emergency.latitudeEncrypted) {
      latestLocation = { latitude: lat, longitude: lng, recordedAt: emergency.createdAt };
    }
  }

  return {
    ownerFirstName: firstNameOf(user) || null,
    status: emergency.status === "RESOLVED" ? "ended" : "active",
    startedAt: emergency.createdAt,
    endedAt: emergency.endedAt,
    expiresAt: new Date(effectiveExpiry(link, emergency)),
    latestLocation,
    recentLocations,
    segments: segments.map((segment) => ({
      sequence: segment.sequence,
      facing: segment.facing,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      mediaUrl: mediaPath(link, "v", segment.sequence),
    })),
    audioUrl: emergency.audioUrl ? mediaPath(link, "a", 0) : null,
  };
}

async function purgeExpiredLinks(now = Date.now()) {
  const result = await prisma.liveViewLink.deleteMany({
    where: { hardExpiresAt: { lt: new Date(now - PURGE_AFTER_MS) } },
  });
  return result.count;
}

module.exports = {
  AFTER_END_TTL_MS,
  HARD_TTL_MS,
  MEDIA_URL_TTL_MS,
  effectiveExpiry,
  ensureLinks,
  existingLinkUrl,
  findByToken,
  getShareLink,
  isLiveViewEnabled,
  linkState,
  ownerStatus,
  purgeExpiredLinks,
  resolveMedia,
  revokeForContact,
  revokeLinks,
  rotateLink,
  viewerState,
};
