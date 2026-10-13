const bcrypt = require("bcrypt");

const prisma = require("../config/db");
const { encrypt, decrypt, hashLookup } = require("../services/cryptoService");
const { isValidPhoneNumber, normalizePhoneDigits } = require("../utils/phone");
const { deleteUserFiles } = require("../services/storageService");
const tiktokClient = require("../services/tiktokClient");
const { hasTikTokConfig } = require("../services/socialSharingConfig");
const { hasTransactionalEmailConfig, sendAccountDeletionCode } = require("../services/emailService");
const { GoogleTokenError, googleSubHash, verifyGoogleIdToken } = require("../services/googleAuthService");
const {
  issueDeletionChallenge,
  verifyAndConsumeDeletionChallenge,
} = require("../services/accountDeletionChallengeService");

const REVOKE_BUDGET_MS = 5000;

// Best-effort: revoke Bes's access on the user's TikTok account before the
// stored tokens are deleted. Never blocks or fails account deletion — the
// tokens are removed from Bes either way. Instagram has no equivalent call:
// we only hold a Page access token, and Meta's permission revoke needs the
// user's own token, so the deletion screen tells users how to remove Bes in
// Facebook settings instead.
async function revokeTikTokAccess(userId) {
  if (!hasTikTokConfig()) return;
  try {
    const connection = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId, provider: "tiktok" } },
    });
    if (!connection?.accessTokenEncrypted) return;
    await Promise.race([
      tiktokClient.revokeAccessToken(decrypt(connection.accessTokenEncrypted)),
      new Promise((resolve) => setTimeout(resolve, REVOKE_BUDGET_MS)),
    ]);
  } catch (error) {
    console.warn("TikTok revoke during account deletion failed:", error?.message || error);
  }
}

exports.setPublicKey = async (req, res, next) => {
  try {
    const publicKey = String(req.body.publicKey || "").trim();
    if (!publicKey) {
      return res.status(400).json({ error: "publicKey is required." });
    }

    // tweetnacl box public keys are 32 raw bytes -> 44 base64 chars.
    if (!/^[A-Za-z0-9+/]{40,50}={0,2}$/.test(publicKey)) {
      return res.status(400).json({ error: "publicKey does not look like a valid base64 key." });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { publicKey },
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

// POST /api/users/me/delete-challenge — Google-only accounts (no password)
// only. Emails a one-time code and returns the nonce the app passes to a
// fresh Google sign-in. Both are required by DELETE /api/users/me.
exports.createDeletionChallenge = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.passwordHash) {
      return res.status(400).json({ error: "Confirm with your password instead.", code: "password_account" });
    }
    if (!hasTransactionalEmailConfig()) {
      return res.status(503).json({ error: "Email isn't available right now. Try again later.", code: "email_unavailable" });
    }
    const { code, nonce, expiresAt } = await issueDeletionChallenge(user.id);
    await sendAccountDeletionCode({ to: decrypt(user.emailEncrypted), code });
    res.status(201).json({ nonce, expiresAt });
  } catch (error) {
    next(error);
  }
};

// Password accounts: unchanged password confirmation.
// Google-only accounts: emailed code + fresh Google sign-in (see
// accountDeletionChallengeService) — never a token or session alone.
async function confirmDeletion(req, res, user) {
  if (user.passwordHash) {
    const password = String(req.body.password || "");
    if (!password) {
      res.status(400).json({ error: "password is required to delete your account." });
      return false;
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "Incorrect password." });
      return false;
    }
    return true;
  }

  const code = String(req.body.code || "");
  if (!code || !req.body.googleIdToken) {
    res.status(400).json({ error: "Enter the code we emailed you and confirm with Google.", code: "deletion_proof_required" });
    return false;
  }
  let google;
  try {
    google = await verifyGoogleIdToken(req.body.googleIdToken);
  } catch (error) {
    if (!(error instanceof GoogleTokenError)) throw error;
    res.status(401).json({ error: "Google confirmation failed. Please try again.", code: "google_reauth_required" });
    return false;
  }
  const result = await verifyAndConsumeDeletionChallenge(user.id, {
    code,
    google: { subHash: googleSubHash(google.sub), nonce: google.nonce, iat: google.iat },
    expectedSubHash: user.googleSubHash,
  });
  if (!result.ok) {
    const messages = {
      invalid_code: "That code isn't right.",
      expired: "That code has expired. Request a new one.",
      no_active_challenge: "Request a new code to continue.",
      too_many_attempts: "Too many attempts. Request a new code.",
      google_account_mismatch: "Confirm with the Google account that owns this Bes account.",
      google_reauth_required: "Please confirm with Google again.",
    };
    res.status(401).json({ error: messages[result.reason] || "Couldn't confirm it's you.", code: result.reason });
    return false;
  }
  return true;
}

exports.deleteMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "User not found." });

    if (!(await confirmDeletion(req, res, user))) return;

    await revokeTikTokAccess(req.user.id);

    // Deletes the User row and, via onDelete: Cascade, every TrustedContact,
    // EmergencyEvent (and its video segments), Recording, RefreshToken,
    // PrivateData, CovertMessage (sent or received), and SocialConnection
    // (with every stored TikTok/Instagram token) row tied to it.
    await prisma.user.delete({ where: { id: req.user.id } });

    // Best-effort: the account is already gone at this point regardless of
    // whether this cleanup succeeds, so a storage error here shouldn't turn
    // into a failure response for an operation that already completed.
    try {
      deleteUserFiles(req.user.id);
    } catch {
      // Orphaned files are a minor storage-cleanup issue, not a functional
      // or security problem — the account and its DB records are gone.
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;
    if (phoneNumber === undefined) {
      return res.status(400).json({ error: "No supported fields provided." });
    }

    const trimmedPhone = String(phoneNumber || "").trim();
    if (!isValidPhoneNumber(trimmedPhone)) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }

    const phoneHash = hashLookup(normalizePhoneDigits(trimmedPhone));

    const existing = await prisma.user.findUnique({ where: { phoneHash } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: "This phone number is already registered to another account." });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { phoneEncrypted: encrypt(trimmedPhone), phoneHash },
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

exports.updateTourStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (status !== "completed" && status !== "skipped") {
      return res.status(400).json({ error: 'status must be "completed" or "skipped".' });
    }

    const field = status === "completed" ? "tourCompletedAt" : "tourSkippedAt";
    await prisma.user.update({
      where: { id: req.user.id },
      data: { [field]: new Date() },
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
