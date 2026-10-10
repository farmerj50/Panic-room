const prisma = require("../config/db");
const { decrypt, encrypt, hashLookup } = require("../services/cryptoService");
const { isValidPhoneNumber, normalizePhoneDigits } = require("../utils/phone");
const { isUserPremium, FREE_CONTACT_LIMIT } = require("../services/subscriptionService");
const { smsStatusFor, optedOutHashesFor } = require("../services/smsEligibilityService");
const {
  issueInvite,
  revokeOpenInvites,
  resetConsentForNumberChange,
  firstNameOf,
  publicBaseUrl,
} = require("../services/smsConsentService");

// smsStatus: 'accepted' | 'pending' | 'declined' | 'revoked' | 'opted_out' | 'number_changed'
function serializeContact(contact, optedOutHashes = new Set()) {
  return {
    id: contact.id,
    createdAt: contact.createdAt,
    name: decrypt(contact.name),
    phoneNumber: decrypt(contact.phoneNumber),
    isPriority: contact.isPriority,
    smsStatus: smsStatusFor(contact, optedOutHashes),
  };
}

async function serializeOne(contact) {
  return serializeContact(contact, await optedOutHashesFor([contact]));
}

exports.createContact = async (req, res, next) => {
  try {
    const { name, phoneNumber } = req.body;
    const trimmedName = String(name || "").trim();
    const trimmedPhone = String(phoneNumber || "").trim();

    if (!trimmedName || !trimmedPhone) {
      return res.status(400).json({ error: "Name and phone number are required" });
    }

    if (!isValidPhoneNumber(trimmedPhone)) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }

    const [existingCount, user] = await Promise.all([
      prisma.trustedContact.count({ where: { userId: req.user.id } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { subscriptionExpiresAt: true } }),
    ]);
    if (existingCount >= FREE_CONTACT_LIMIT && !isUserPremium(user)) {
      return res.status(403).json({
        error: `Free plan is limited to ${FREE_CONTACT_LIMIT} trusted contacts. Upgrade to Bes Premium for more.`,
        code: "CONTACT_LIMIT_REACHED",
      });
    }

    const contact = await prisma.trustedContact.create({
      data: {
        userId: req.user.id,
        name: encrypt(trimmedName),
        phoneNumber: encrypt(trimmedPhone),
        phoneHash: hashLookup(normalizePhoneDigits(trimmedPhone)),
        isPriority: Boolean(req.body.isPriority),
      },
    });

    res.status(201).json(await serializeOne(contact));
  } catch (error) {
    next(error);
  }
};

exports.getContacts = async (req, res, next) => {
  try {
    const contacts = await prisma.trustedContact.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    const optedOut = await optedOutHashesFor(contacts);
    res.json(contacts.map((contact) => serializeContact(contact, optedOut)));
  } catch (error) {
    next(error);
  }
};

exports.updateContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "Name cannot be empty" });
      data.name = encrypt(name);
    }
    if (req.body.phoneNumber !== undefined) {
      const phoneNumber = String(req.body.phoneNumber).trim();
      if (!phoneNumber) return res.status(400).json({ error: "Phone number cannot be empty" });
      if (!isValidPhoneNumber(phoneNumber)) {
        return res.status(400).json({ error: "Enter a valid phone number." });
      }
      data.phoneNumber = encrypt(phoneNumber);
      data.phoneHash = hashLookup(normalizePhoneDigits(phoneNumber));
    }
    if (req.body.isPriority !== undefined) data.isPriority = Boolean(req.body.isPriority);

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No supported contact fields provided" });
    }

    const existing = await prisma.trustedContact.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    // A different number invalidates SMS consent (it was given for the old
    // number) and any open invite — atomically with the number change.
    const numberChanged = data.phoneHash !== undefined && data.phoneHash !== existing.phoneHash;
    if (numberChanged) {
      Object.assign(data, {
        smsConsentStatus: "pending",
        smsConsentPhoneHash: null,
        smsConsentAt: null,
        smsConsentVersion: null,
      });
    }

    const contact = await prisma.$transaction(async (tx) => {
      if (numberChanged) {
        await resetConsentForNumberChange(tx, id, existing.smsConsentStatus, existing.phoneHash);
      }
      if (data.isPriority === true) {
        await tx.trustedContact.updateMany({
          where: { userId: req.user.id, id: { not: id } },
          data: { isPriority: false },
        });
      }

      return tx.trustedContact.update({
        where: { id },
        data,
      });
    });

    res.json(await serializeOne(contact));
  } catch (error) {
    next(error);
  }
};

// POST /api/contacts/:id/sms-invite — a fresh single-use consent link the
// user shares from their own messaging app. Revokes any open invite.
exports.createSmsInvite = async (req, res, next) => {
  try {
    const issued = await issueInvite({ userId: req.user.id, contactId: req.params.id });
    if (!issued) return res.status(404).json({ error: "Contact not found" });

    const url = `${publicBaseUrl(req)}/sms-consent/${issued.token}`;
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { nameEncrypted: true } });
    const name = firstNameOf(user);
    const shareMessage =
      `${name ? `It's ${name} — I've` : "I've"} added you as an emergency contact in Bes. ` +
      `To get a text if I ever activate an emergency, open this link and tap Accept: ${url}`;

    res.status(201).json({ url, shareMessage, expiresAt: issued.invite.expiresAt });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/contacts/:id/sms-invite — revokes the open invite, if any.
exports.revokeSmsInvite = async (req, res, next) => {
  try {
    const existing = await prisma.trustedContact.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ error: "Contact not found" });
    const revoked = await revokeOpenInvites({ userId: req.user.id, contactId: req.params.id });
    res.json({ revoked });
  } catch (error) {
    next(error);
  }
};

exports.deleteContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.trustedContact.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    await prisma.trustedContact.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
