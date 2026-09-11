// Single source of truth for "is this user entitled to Bes Premium" — used
// by both the requirePremium middleware and the trusted-contacts cap check.
// RevenueCat is the actual billing system of record; this just reads the
// cached mirror of its state that the /api/billing/webhook handler keeps
// up to date on User.

const FREE_CONTACT_LIMIT = 3; // adjustable constant, not an architecture decision
const PREMIUM_CONTACT_LIMIT = null; // null = unlimited

function isUserPremium(user) {
  return Boolean(user?.subscriptionExpiresAt) && user.subscriptionExpiresAt.getTime() > Date.now();
}

module.exports = { isUserPremium, FREE_CONTACT_LIMIT, PREMIUM_CONTACT_LIMIT };
