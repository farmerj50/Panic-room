const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = require("../config/db");
const { decrypt, encrypt, hashLookup, safeDecrypt } = require("../services/cryptoService");
const {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
} = require("../services/refreshTokenService");
const { issueResetCode, verifyAndConsumeResetCode } = require("../services/passwordResetService");
const { sendSms, hasSmsProviderConfig } = require("../services/smsServices");

const PASSWORD_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRES_IN = "15m";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serializeUser(user) {
  return {
    id: user.id,
    email: decrypt(user.emailEncrypted),
    name: user.nameEncrypted ? decrypt(user.nameEncrypted) : "",
    createdAt: user.createdAt,
    publicKey: user.publicKey ?? undefined,
    phoneNumber: user.phoneEncrypted ? safeDecrypt(user.phoneEncrypted) ?? undefined : undefined,
  };
}

function signAccessToken(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    subject: userId,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

exports.register = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (password.length < 12) {
      return res.status(400).json({ error: "Password must be at least 12 characters." });
    }

    const emailHash = hashLookup(email);
    const existing = await prisma.user.findUnique({ where: { emailHash } });
    if (existing) {
      return res.status(409).json({ error: "An account already exists for this email." });
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
    const user = await prisma.user.create({
      data: {
        emailHash,
        emailEncrypted: encrypt(email),
        nameEncrypted: name ? encrypt(name) : null,
        passwordHash,
      },
    });

    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      accessToken: signAccessToken(user.id),
      refreshToken,
      user: serializeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!isValidEmail(email) || !password) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = await prisma.user.findUnique({ where: { emailHash: hashLookup(email) } });
    const matches = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!matches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.headers["user-agent"],
    });

    res.json({
      accessToken: signAccessToken(user.id),
      refreshToken,
      user: serializeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

exports.me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const rawToken = String(req.body.refreshToken || "");
    if (!rawToken) {
      return res.status(400).json({ error: "refreshToken is required." });
    }

    const rotated = await rotateRefreshToken(rawToken, {
      userAgent: req.headers["user-agent"],
    });

    if (!rotated) {
      return res.status(401).json({ error: "Invalid or expired refresh token." });
    }

    res.json({
      accessToken: signAccessToken(rotated.userId),
      refreshToken: rotated.rawToken,
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const rawToken = String(req.body.refreshToken || "");
    if (rawToken) {
      await revokeRefreshToken(rawToken);
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

const FORGOT_PASSWORD_RESPONSE = {
  message: "If an account with SMS recovery set up exists for this email, a reset code has been sent.",
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const user = await prisma.user.findUnique({ where: { emailHash: hashLookup(email) } });

    // Deliberately identical response whether or not the account exists, has
    // a phone on file, or SMS is even configured — never leak account
    // existence to the caller. (The Twilio call, when it does fire, is a
    // known timing side-channel we've accepted rather than solved — same
    // risk posture as the covert-messaging phone-matching feature.)
    if (user?.phoneEncrypted && hasSmsProviderConfig()) {
      const code = await issueResetCode(user.id);
      const phone = decrypt(user.phoneEncrypted);
      sendSms({
        to: phone,
        body: `Your Bes password reset code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`,
      }).catch((err) => {
        console.error("[auth] failed to send password reset SMS:", err?.message ?? err);
      });
    }

    res.status(200).json(FORGOT_PASSWORD_RESPONSE);
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!isValidEmail(email) || !code) {
      return res.status(400).json({ error: "Invalid request." });
    }
    if (newPassword.length < 12) {
      return res.status(400).json({ error: "Password must be at least 12 characters." });
    }

    const user = await prisma.user.findUnique({ where: { emailHash: hashLookup(email) } });
    const verified = user ? await verifyAndConsumeResetCode(user.id, code) : { ok: false };

    if (!verified.ok) {
      return res.status(400).json({ error: "Invalid or expired code." });
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    // A password reset is a strong signal of possible account compromise —
    // kill every existing session, same as rotateRefreshToken's reuse
    // detection does when it sees a stolen/replayed token.
    await revokeAllForUser(user.id);

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
