const express = require("express");
const router = express.Router();

const {
  createContact,
  deleteContact,
  createSmsInvite,
  revokeSmsInvite,
  getContacts,
  updateContact,
} = require("../controllers/contactController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.post("/", createContact);
router.get("/", getContacts);
router.patch("/:id", updateContact);
router.delete("/:id", deleteContact);
router.post("/:id/sms-invite", createSmsInvite);
router.delete("/:id/sms-invite", revokeSmsInvite);

module.exports = router;
