const bcrypt = require("bcrypt");

const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const { isValidPhoneNumber, normalizePhoneDigits } = require("../utils/phone");
const { deleteUserFiles } = require("../services/storageService");

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

    // Deletes the User row and, via onDelete: Cascade, every TrustedContact,
    // EmergencyEvent, Recording, RefreshToken, PrivateData, and
    // CovertMessage (sent or received) row tied to it.
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
