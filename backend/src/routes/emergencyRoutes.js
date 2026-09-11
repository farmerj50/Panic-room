const express = require("express");
const router = express.Router();

const {
  addVideoSegment,
  callEmergencyContacts,
  createEmergencyEvent,
  getEmergencyEvents,
  notifyEmergencyContacts,
  updateEmergencyEvent,
} = require("../controllers/emergencyController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.post("/", createEmergencyEvent);
router.get("/", getEmergencyEvents);
router.patch("/:id", updateEmergencyEvent);
router.post("/call", callEmergencyContacts);
router.post("/:id/notify", notifyEmergencyContacts);
router.post("/:id/video-segments", addVideoSegment);

module.exports = router;
