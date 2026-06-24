const express = require("express");
const router = express.Router();

const {
  createContact,
  deleteContact,
  getContacts,
  updateContact,
} = require("../controllers/contactController");
const { authenticate } = require("../middleware/authMiddleware");

router.use(authenticate);
router.post("/", createContact);
router.get("/", getContacts);
router.patch("/:id", updateContact);
router.delete("/:id", deleteContact);

module.exports = router;
