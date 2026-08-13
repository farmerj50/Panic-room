const express = require("express");
const router = express.Router();

const {
  createContact,
  deleteContact,
  getContacts,
  updateContact,
} = require("../controllers/contactController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.post("/", createContact);
router.get("/", getContacts);
router.patch("/:id", updateContact);
router.delete("/:id", deleteContact);

module.exports = router;
