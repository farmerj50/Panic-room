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
const { hasResendConfig, sendWelcomeEmail } = require("../services/emailService");
const { sendServerGA4Event } = require("../services/ga4Service");
const {
  GoogleTokenError,
  googleSubHash,
  isGoogleConfigured,
  verifyGoogleIdToken,
} = require("../services/googleAuthService");

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
    // Lets the client decide whether to offer the guided tour without a
    // separate round trip: true once the user has either completed or
    // explicitly skipped it, at the prompt or mid-tour.
    tourOffered: Boolean(user.tourCompletedAt || user.tourSkippedAt),
    // Google-only accounts have no password: the app hides password-based
    // actions for them (e.g. Delete Account uses an emailed code instead).
    hasPassword: Boolean(user.passwordHash),
    googleLinked: Boolean(user.googleSubHash),
  };
}

function cleanGa4ClientId(value) {
  return value ? String(value).trim().slice(0, 128) : null;
}

async function sendWelcomeEmailOnce(user, email) {
  if (!hasResendConfig() || user.welcomeEmailSentAt) return;
  try {
    await sendWelcomeEmail({ to: email });
    await prisma.user.update({ where: { id: user.id }, data: { welcomeEmailSentAt: new Date() } });
  } catch (error) {
    console.error("Failed to send Bes welcome email:", error?.message || error);
  }
}

// Server-side record that an account really was created (independent of the
// app's own sign_up event), so the funnel can be checked against the User table.
function reportAccountCreated(user, method) {
  if (user.ga4ClientId) void sendServerGA4Event(user.ga4ClientId, "account_created", { method });
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
    const ga4ClientId = req.body.ga4ClientId ? String(req.body.ga4ClientId).trim().slice(0, 128) : null;

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
        ga4ClientId,
      },
    });

    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.headers["user-agent"],
    });

    // `email` — the local plaintext var above: this schema stores email
    // encrypted, the Prisma User record has no plain `.email` field.
    await sendWelcomeEmailOnce(user, email);
    reportAccountCreated(user, "email");

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
    // Google-only accounts have no password — same generic answer, so this
    // never reveals which sign-in method an email uses.
    const matches = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

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

// ── Google Sign-In ─────────────────────────────────────────────────────────
function googleErrorResponse(res, error) {
  if (!(error instanceof GoogleTokenError)) throw error;
  if (error.code === "google_not_configured") {
    return res.status(503).json({ error: "Google sign-in isn't available right now.", code: error.code });
  }
  if (error.code === "google_email_unverified") {
    return res.status(401).json({ error: "Your Google account's email isn't verified.", code: error.code });
  }
  return res.status(401).json({ error: "Google sign-in failed. Please try again.", code: "google_token_invalid" });
}

// POST /api/auth/google { idToken, ga4ClientId? }
// Signs in a Google-linked account or creates a new one. An existing Bes
// account with the same email is NEVER linked or signed in automatically —
// the owner must sign in with their password and connect Google in Settings.
exports.googleSignIn = async (req, res, next) => {
  try {
    let google;
    try {
      google = await verifyGoogleIdToken(req.body.idToken);
    } catch (error) {
      return googleErrorResponse(res, error);
    }

    const subHash = googleSubHash(google.sub);
    let user = await prisma.user.findUnique({ where: { googleSubHash: subHash } });
    let isNewUser = false;

    if (!user) {
      const emailHash = hashLookup(google.email);
      const existing = await prisma.user.findUnique({ where: { emailHash } });
      if (existing) {
        return res.status(409).json({
          error: "An account with this email already exists. Sign in with your password, then connect Google in Settings.",
          code: "account_exists_link_required",
        });
      }
      try {
        user = await prisma.user.create({
          data: {
            emailHash,
            emailEncrypted: encrypt(google.email),
            nameEncrypted: google.name ? encrypt(google.name) : null,
            passwordHash: null,
            googleSubHash: subHash,
            ga4ClientId: cleanGa4ClientId(req.body.ga4ClientId),
          },
        });
        isNewUser = true;
      } catch (error) {
        // Two simultaneous first sign-ins with the same Google account.
        if (error?.code !== "P2002") throw error;
        user = await prisma.user.findUnique({ where: { googleSubHash: subHash } });
        if (!user) {
          return res.status(409).json({
            error: "An account with this email already exists. Sign in with your password, then connect Google in Settings.",
            code: "account_exists_link_required",
          });
        }
      }
      if (isNewUser) {
        await sendWelcomeEmailOnce(user, google.email);
        reportAccountCreated(user, "google");
      }
    }

    const refreshToken = await issueRefreshToken(user.id, { userAgent: req.headers["user-agent"] });
    res.status(isNewUser ? 201 : 200).json({
      accessToken: signAccessToken(user.id),
      refreshToken,
      user: serializeUser(user),
      isNewUser,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/google/link { idToken, password } — authenticated.
// Ownership is proven by the signed-in session AND the account password.
exports.linkGoogle = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "Account not found." });
    if (!user.passwordHash) {
      return res.status(400).json({ error: "This account already signs in with Google.", code: "already_google" });
    }
    const password = String(req.body.password || "");
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect password.", code: "invalid_password" });
    }

    let google;
    try {
      google = await verifyGoogleIdToken(req.body.idToken);
    } catch (error) {
      return googleErrorResponse(res, error);
    }

    const subHash = googleSubHash(google.sub);
    const owner = await prisma.user.findUnique({ where: { googleSubHash: subHash } });
    if (owner && owner.id !== user.id) {
      return res.status(409).json({
        error: "That Google account is already connected to a different Bes account.",
        code: "google_already_linked",
      });
    }
    try {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { googleSubHash: subHash } });
      res.json({ user: serializeUser(updated) });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      res.status(409).json({
        error: "That Google account is already connected to a different Bes account.",
        code: "google_already_linked",
      });
    }
  } catch (error) {
    next(error);
  }
};

// DELETE /api/auth/google/link — authenticated. Only accounts that can
// still sign in with a password may disconnect Google (no lock-out).
exports.unlinkGoogle = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "Account not found." });
    if (!user.passwordHash) {
      return res.status(400).json({
        error: "Add a password before disconnecting Google, or you won't be able to sign in.",
        code: "password_required",
      });
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data: { googleSubHash: null } });
    res.json({ user: serializeUser(updated) });
  } catch (error) {
    next(error);
  }
};

exports.googleConfig = (req, res) => {
  res.json({ enabled: isGoogleConfigured() });
};
