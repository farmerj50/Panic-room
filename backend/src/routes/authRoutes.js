const express = require("express");
const router = express.Router();

const {
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  register,
  resetPassword,
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

module.exports = router;
