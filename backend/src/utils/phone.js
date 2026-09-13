// Light E.164-ish check: accepts common human formatting (spaces, dashes,
// parens) but the underlying digits must look like a real phone number —
// optional leading '+', 8-15 digits, no leading 0. Not full E.164 validation
// (that requires a country-code table), just enough to reject garbage input.
function isValidPhoneNumber(value) {
  const stripped = String(value || "").replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(stripped);
}

// Normalizes a phone number to a digit-only string for hash-based matching
// (TrustedContact.phoneHash <-> User.phoneHash). Not full E.164 parsing —
// there's no country-code picker anywhere in the app, so both sides of a
// match are free-typed text — but since Bes is US-focused (the emergency
// dialer is hardcoded to 911), a bare 10-digit number is assumed to be a
// local US number and normalized to include the "1" country code, so
// "5551234567" and "+15551234567" collapse to the same hash input. This
// previously did not happen (see git history), which caused a real
// production case where a contact's number didn't match its owner's own
// account. Changing this alone does not fix already-stored hashes — see
// scripts/backfillPhoneHashes.js.
function normalizePhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

module.exports = { isValidPhoneNumber, normalizePhoneDigits };
