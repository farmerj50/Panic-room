const express = require("express");
const router = express.Router();

const { login, me, register } = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.get("/me", authenticate, me);

module.exports = router;
