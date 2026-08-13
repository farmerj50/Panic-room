const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = require("../config/db");
const { decrypt, encrypt, hashLookup, safeDecrypt } = require("../services/cryptoService");
const {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} = require("../services/refreshTokenService");

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
