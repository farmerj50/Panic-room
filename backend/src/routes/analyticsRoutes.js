const express = require("express");
const router = express.Router();

const { trackEvent } = require("../controllers/analyticsController");
const { rateLimit } = require("../middleware/rateLimit");

// Higher ceiling than auth's limiters — multiple funnel events fire per
// screen (e.g. permission explanation-viewed + granted/denied back to back).
const analyticsLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

router.post("/event", analyticsLimiter, trackEvent);

module.exports = router;
