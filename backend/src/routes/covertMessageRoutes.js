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
const { singleFileUpload } = require("../middleware/uploadMiddleware");

router.use(authenticate, requireUserId);
router.post("/upload", singleFileUpload, uploadCovertMessageFile);
router.get("/recipient-key/:contactId", getRecipientPublicKey);
router.post("/", createCovertMessage);
router.get("/inbox", getInbox);
router.patch("/:id", markRead);

module.exports = router;
