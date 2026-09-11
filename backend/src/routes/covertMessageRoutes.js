const express = require("express");
const router = express.Router();

const {
  createCovertMessage,
  getInbox,
  getRecipientPublicKey,
  markRead,
  uploadCovertMessageFile,
} = require("../controllers/covertMessageController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");
const { requirePremium } = require("../middleware/requirePremium");
const { singleFileUpload } = require("../middleware/uploadMiddleware");

router.use(authenticate, requireUserId);
// Sending is a Bes Premium feature; receiving/reading a message a premium
// friend already sent you is not — requirePremium runs before
// singleFileUpload so no file bytes are accepted from a non-premium user.
router.post("/upload", requirePremium, singleFileUpload, uploadCovertMessageFile);
router.get("/recipient-key/:contactId", getRecipientPublicKey);
router.post("/", requirePremium, createCovertMessage);
router.get("/inbox", getInbox);
router.patch("/:id", markRead);

module.exports = router;
