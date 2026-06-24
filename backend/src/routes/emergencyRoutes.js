const express = require("express");
const router = express.Router();

const {
  callEmergencyContacts,
  createEmergencyEvent,
  getEmergencyEvents,
  notifyEmergencyContacts,
} = require("../controllers/emergencyController");
const { authenticate } = require("../middleware/authMiddleware");

router.use(authenticate);
router.post("/", createEmergencyEvent);
router.get("/", getEmergencyEvents);
router.post("/call", callEmergencyContacts);
router.post("/:id/notify", notifyEmergencyContacts);

module.exports = router;
