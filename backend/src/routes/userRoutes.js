const express = require("express");
const router = express.Router();

const {
  createDeletionChallenge,
  deleteMe,
  setPublicKey,
  updateMe,
  updateTourStatus,
} = require("../controllers/userController");
const { rateLimit } = require("../middleware/rateLimit");

// Each challenge sends an email — keep it hard to abuse.
const deletionChallengeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.patch("/me", updateMe);
router.patch("/me/tour", updateTourStatus);
router.put("/me/public-key", setPublicKey);
router.post("/me/delete-challenge", deletionChallengeLimiter, createDeletionChallenge);
router.delete("/me", deleteMe);

module.exports = router;
