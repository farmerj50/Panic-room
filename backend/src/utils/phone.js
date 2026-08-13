// Light E.164-ish check: accepts common human formatting (spaces, dashes,
// parens) but the underlying digits must look like a real phone number —
// optional leading '+', 8-15 digits, no leading 0. Not full E.164 validation
// (that requires a country-code table), just enough to reject garbage input.
function isValidPhoneNumber(value) {
  const stripped = String(value || "").replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(stripped);
}

// Normalizes a phone number to a digit-only string for hash-based matching
// (TrustedContact.phoneHash <-> User.phoneHash). Known limitation: this is a
// naive heuristic, not full E.164 parsing — "5551234567" and "+15551234567"
// normalize differently even though a human would recognize them as the same
// US number. Acceptable for v1 (no phone-ownership verification exists yet
// either); revisit together if this ships broadly.
function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

module.exports = { isValidPhoneNumber, normalizePhoneDigits };
