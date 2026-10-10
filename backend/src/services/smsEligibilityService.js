// Who may receive an emergency text. Kept separate from dispatch so the rules
// live in one place and are re-checked at send time:
//   consent accepted  AND  consent bound to the contact's CURRENT number
//   AND  that number has not replied STOP  AND  SMS is enabled.
// Trusted-contact *calls* are not gated by any of this.

const prisma = require("../config/db");
const { currentPhoneHash } = require("./smsConsentService");

function isSmsEnabled() {
  return process.env.SMS_ENABLED === "true";
}

// One of: 'accepted' | 'pending' | 'declined' | 'revoked' | 'opted_out' | 'number_changed'
function smsStatusFor(contact, optedOutHashes) {
  const phoneHash = currentPhoneHash(contact);
  if (optedOutHashes.has(phoneHash)) return "opted_out";
  if (contact.smsConsentStatus === "accepted") {
    return contact.smsConsentPhoneHash === phoneHash ? "accepted" : "number_changed";
  }
  return contact.smsConsentStatus || "pending";
}

async function optedOutHashesFor(contacts) {
  const hashes = contacts.map(currentPhoneHash).filter(Boolean);
  if (hashes.length === 0) return new Set();
  const rows = await prisma.smsOptOut.findMany({ where: { phoneHash: { in: hashes } }, select: { phoneHash: true } });
  return new Set(rows.map((row) => row.phoneHash));
}

// Status for each of a user's stored contacts (never app-supplied numbers).
async function evaluateContacts(userId) {
  const contacts = await prisma.trustedContact.findMany({ where: { userId } });
  const optedOut = await optedOutHashesFor(contacts);
  return contacts.map((contact) => {
    const smsStatus = smsStatusFor(contact, optedOut);
    return { contact, smsStatus, eligible: smsStatus === "accepted" };
  });
}

module.exports = { isSmsEnabled, smsStatusFor, optedOutHashesFor, evaluateContacts };
