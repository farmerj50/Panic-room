// Single source of truth for "is this user entitled to Bes Premium" — used
// by both the requirePremium middleware and the trusted-contacts cap check.
// RevenueCat is the actual billing system of record; this just reads the
// cached mirror of its state that the /api/billing/webhook handler keeps
// up to date on User.

const FREE_CONTACT_LIMIT = 3; // adjustable constant, not an architecture decision
const PREMIUM_CONTACT_LIMIT = null; // null = unlimited

// Bes Pro "Linked Accounts" cap — a separate feature from Trusted Contacts
// with its own counter; never share this constant with FREE_CONTACT_LIMIT.
// Free users get 0 (not unlimited-null like PREMIUM_CONTACT_LIMIT above —
// this cap is never unlimited, even for Pro).
const MAX_LINKED_ACCOUNTS_PRO = 5;

function isUserPremium(user) {
  return Boolean(user?.subscriptionExpiresAt) && user.subscriptionExpiresAt.getTime() > Date.now();
}

module.exports = { isUserPremium, FREE_CONTACT_LIMIT, PREMIUM_CONTACT_LIMIT, MAX_LINKED_ACCOUNTS_PRO };
