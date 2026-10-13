// Google Sign-In: verifies the ID token the app gets from Android Credential
// Manager. Bes keeps its own accounts and sessions — Google only proves who
// the person is. The token's audience must be our Web OAuth client
// (GOOGLE_WEB_CLIENT_ID), which the app passes as Credential Manager's
// serverClientId.
const { OAuth2Client } = require("google-auth-library");

const { hashLookup } = require("./cryptoService");

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

class GoogleTokenError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "GoogleTokenError";
    this.code = code;
  }
}

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client();
  return client;
}

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_WEB_CLIENT_ID);
}

// Stable, non-reversible link between a Google account and a Bes user —
// same keyed-HMAC convention as emailHash/phoneHash.
function googleSubHash(sub) {
  return hashLookup(`google:${sub}`);
}

// Returns { sub, email, name, iat, nonce } for a valid, verified-email token.
// Throws GoogleTokenError: google_not_configured | google_token_invalid |
// google_email_unverified.
async function verifyGoogleIdToken(idToken) {
  if (!isGoogleConfigured()) throw new GoogleTokenError("google_not_configured");
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 8192) {
    throw new GoogleTokenError("google_token_invalid");
  }
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience: process.env.GOOGLE_WEB_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new GoogleTokenError("google_token_invalid");
  }
  if (!payload || !GOOGLE_ISSUERS.has(payload.iss) || !payload.sub) {
    throw new GoogleTokenError("google_token_invalid");
  }
  if (payload.email_verified !== true || !payload.email) {
    throw new GoogleTokenError("google_email_unverified");
  }
  return {
    sub: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(" ") || "",
    iat: payload.iat,
    nonce: payload.nonce,
  };
}

module.exports = { GoogleTokenError, googleSubHash, isGoogleConfigured, verifyGoogleIdToken };
