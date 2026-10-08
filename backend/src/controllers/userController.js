const bcrypt = require("bcrypt");

const prisma = require("../config/db");
const { encrypt, decrypt, hashLookup } = require("../services/cryptoService");
const { isValidPhoneNumber, normalizePhoneDigits } = require("../utils/phone");
const { deleteUserFiles } = require("../services/storageService");
const tiktokClient = require("../services/tiktokClient");
const { hasTikTokConfig } = require("../services/socialSharingConfig");

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

exports.deleteMe = async (req, res, next) => {
  try {
    const password = String(req.body.password || "");
    if (!password) {
      return res.status(400).json({ error: "password is required to delete your account." });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "User not found." });

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

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
