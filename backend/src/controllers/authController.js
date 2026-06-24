const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = require("../config/db");
const { decrypt, encrypt, hashLookup } = require("../services/cryptoService");

const PASSWORD_ROUNDS = 12;
const TOKEN_EXPIRES_IN = "12h";

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
  };
}

function signToken(userId) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    subject: userId,
    expiresIn: TOKEN_EXPIRES_IN,
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

    res.status(201).json({
      token: signToken(user.id),
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

    res.json({
      token: signToken(user.id),
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
