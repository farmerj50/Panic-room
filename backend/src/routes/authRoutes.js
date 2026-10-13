const express = require("express");
const router = express.Router();

const {
  forgotPassword,
  googleConfig,
  googleSignIn,
  linkGoogle,
  login,
  logout,
  me,
  refresh,
  register,
  resetPassword,
  unlinkGoogle,
} = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
// SMS sends cost money and are a stronger abuse target than a login POST.
const forgotPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const resetPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh", authLimiter, refresh);
router.post("/logout", authLimiter, logout);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
router.get("/me", authenticate, me);
router.get("/google/config", googleConfig);
router.post("/google", authLimiter, googleSignIn);
router.post("/google/link", authLimiter, authenticate, linkGoogle);
router.delete("/google/link", authenticate, unlinkGoogle);

module.exports = router;
