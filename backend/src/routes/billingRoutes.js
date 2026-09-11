const express = require("express");
const router = express.Router();

const { handleWebhook, getStatus } = require("../controllers/billingController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");
const { verifyRevenueCatSecret } = require("../middleware/verifyRevenueCatSecret");

// RevenueCat's servers call this, not one of our JWT-bearing users.
router.post("/webhook", verifyRevenueCatSecret, handleWebhook);

// The mobile app calls this to read the backend-authoritative contact limit
// and subscription status (RevenueCat's own SDK is the source of truth for
// isPremium client-side UI gating; this is for values the client must not
// just self-report, like the contact cap).
router.get("/status", authenticate, requireUserId, getStatus);

module.exports = router;
