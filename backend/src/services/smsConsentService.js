// Trusted-contact SMS consent: invitations, transactional accept/decline,
// and the retained audit trail. Accepting an invitation is the ONLY way SMS
// consent is created — carrier START/UNSTOP never creates consent (see
// twilioWebhookController), it only lifts a STOP suppression.

const crypto = require("crypto");

const prisma = require("../config/db");
const { decrypt, hashLookup } = require("./cryptoService");
const { normalizePhoneDigits } = require("../utils/phone");

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SMS_CONSENT_RETENTION_YEARS = 4;

// Versioned consent wording. Shown verbatim on the consent page and on the
// public /sms-alerts program page; its hash is stored with every event.
const CONSENT_VERSION = "2026-10-10.v1";
const CONSENT_TEXT =
  "By tapping Accept, you agree to receive emergency text alerts from Bes about {name} at this phone number. " +
  "Texts are sent only when {name} activates an emergency in the Bes app. Message frequency varies. " +
  "Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of any purchase.";
const CONSENT_TEXT_HASH = crypto.createHash("sha256").update(`${CONSENT_VERSION}\n${CONSENT_TEXT}`).digest("hex");

function consentTextFor(name) {
  return CONSENT_TEXT.replace(/\{name\}/g, name);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function phoneHashFor(rawPhone) {
  return hashLookup(normalizePhoneDigits(rawPhone));
}

// The contact's hash as stored; older rows may predate phoneHash.
function currentPhoneHash(contact) {
  return contact.phoneHash || phoneHashFor(decrypt(contact.phoneNumber));
}

function firstNameOf(user) {
  if (!user?.nameEncrypted) return null;
  try {
    const full = String(decrypt(user.nameEncrypted) || "").trim();
    return full ? full.split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

function maskPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}

function publicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

// Issues a fresh single-use invite for a contact the caller owns. Any
// still-open invite for that contact is revoked first.
async function issueInvite({ userId, contactId }) {
  const contact = await prisma.trustedContact.findFirst({ where: { id: contactId, userId } });
  if (!contact) return null;

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const phoneHash = currentPhoneHash(contact);

  const invite = await prisma.$transaction(async (tx) => {
    await tx.contactInvite.updateMany({
      where: { contactId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.contactInvite.create({
      data: {
        contactId,
        userId,
        tokenHash: sha256(token),
        phoneHash,
        consentVersion: CONSENT_VERSION,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    });
  });

  return { token, invite };
}

async function revokeOpenInvites({ userId, contactId }) {
  const result = await prisma.contactInvite.updateMany({
    where: { contactId, userId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

function inviteState(invite, contact, now = new Date()) {
  if (!invite || !contact) return "invalid";
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  if (currentPhoneHash(contact) !== invite.phoneHash) return "number_changed";
  return "valid";
}

// For rendering the consent page. Never returns the token or the full number.
async function getInviteForPage(token) {
  const invite = await prisma.contactInvite.findUnique({
    where: { tokenHash: sha256(token) },
    include: { contact: true, user: { select: { nameEncrypted: true } } },
  });
  const state = inviteState(invite, invite?.contact);
  if (state !== "valid") return { state };
  return {
    state,
    inviterName: firstNameOf(invite.user) || "A Bes user",
    maskedPhone: maskPhone(decrypt(invite.contact.phoneNumber)),
  };
}

class ConsentRollback extends Error {
  constructor(result) {
    super(result);
    this.result = result;
  }
}

// Accept/decline in ONE transaction of two conditional updates; both must hit
// exactly one row or everything rolls back:
//   1. invite: still unused, unrevoked, unexpired  -> mark used
//   2. contact: phoneHash still equals the invite's bound hash -> set consent
// Postgres re-checks an UPDATE's WHERE after waiting on a row lock, so a
// concurrent phone-number change that commits first makes step 2 match zero
// rows (rollback, "number_changed"); one that commits after resets consent in
// its own transaction (contactController.updateContact). Consent can never be
// bound to the wrong number.
async function respondToInvite(token, action, { ipHash = null } = {}) {
  if (action !== "accept" && action !== "decline") throw new Error("invalid action");
  const tokenHash = sha256(token);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const invite = await tx.contactInvite.findUnique({ where: { tokenHash } });
      if (!invite) throw new ConsentRollback("invalid");

      const claimed = await tx.contactInvite.updateMany({
        where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConsentRollback(invite.usedAt ? "used" : invite.revokedAt ? "revoked" : "expired");
      }

      const consent =
        action === "accept"
          ? {
              smsConsentStatus: "accepted",
              smsConsentPhoneHash: invite.phoneHash,
              smsConsentAt: now,
              smsConsentVersion: invite.consentVersion,
            }
          : {
              smsConsentStatus: "declined",
              smsConsentPhoneHash: null,
              smsConsentAt: now,
              smsConsentVersion: invite.consentVersion,
            };
      const updated = await tx.trustedContact.updateMany({
        where: { id: invite.contactId, phoneHash: invite.phoneHash },
        data: consent,
      });
      if (updated.count !== 1) throw new ConsentRollback("number_changed");

      await tx.smsConsentEvent.create({
        data: {
          contactId: invite.contactId,
          phoneHash: invite.phoneHash,
          action,
          consentVersion: invite.consentVersion,
          consentTextHash: CONSENT_TEXT_HASH,
          inviteId: invite.id,
          ipHash,
        },
      });
      return { result: action === "accept" ? "accepted" : "declined" };
    });
  } catch (error) {
    if (error instanceof ConsentRollback) return { result: error.result };
    throw error;
  }
}

// Called inside updateContact's transaction when the number changes.
async function resetConsentForNumberChange(tx, contactId, previousConsentStatus, phoneHash) {
  await tx.contactInvite.updateMany({
    where: { contactId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (previousConsentStatus === "accepted") {
    await tx.smsConsentEvent.create({
      data: { contactId, phoneHash, action: "revoke", consentVersion: null, consentTextHash: null },
    });
  }
}

async function purgeExpiredConsentEvents(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - SMS_CONSENT_RETENTION_YEARS);
  const result = await prisma.smsConsentEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

module.exports = {
  CONSENT_VERSION,
  CONSENT_TEXT,
  CONSENT_TEXT_HASH,
  INVITE_TTL_MS,
  SMS_CONSENT_RETENTION_YEARS,
  consentTextFor,
  phoneHashFor,
  currentPhoneHash,
  firstNameOf,
  maskPhone,
  publicBaseUrl,
  issueInvite,
  revokeOpenInvites,
  getInviteForPage,
  respondToInvite,
  resetConsentForNumberChange,
  purgeExpiredConsentEvents,
  sha256,
};
