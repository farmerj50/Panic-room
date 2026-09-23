const express = require("express");
const router = express.Router();

const {
  createInvite,
  previewInvite,
  acceptInvite,
  getOwnedLinks,
  getLinksToMe,
  updatePermissions,
  revokeLink,
} = require("../controllers/accountLinkController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");
const { requirePremium } = require("../middleware/requirePremium");
const { rateLimit } = require("../middleware/rateLimit");

// /invite is already Pro-gated + cap-checked, so the standard auth-route
// shape is enough. /preview and /accept share a tighter limit — both are
// the global, unscoped code-lookup surface (closest analog to
// /reset-password), the higher-risk endpoints here.
const inviteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.use(authenticate, requireUserId);

router.post("/invite", requirePremium, inviteLimiter, createInvite);
router.post("/preview", codeLimiter, previewInvite);
router.post("/accept", codeLimiter, acceptInvite);
router.get("/", getOwnedLinks);
router.get("/linked-to-me", getLinksToMe);
router.patch("/:id/permissions", updatePermissions);
router.delete("/:id", revokeLink);

module.exports = router;
