const express = require("express");
const router = express.Router();

const {
  addLocations,
  addVideoSegment,
  callEmergencyContacts,
  createEmergencyEvent,
  getEmergencyEvents,
  getLiveViewStatus,
  notifyEmergencyContacts,
  revokeLiveView,
  rotateLiveView,
  shareLiveView,
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
router.post("/:id/locations", addLocations);
router.get("/:id/live-view", getLiveViewStatus);
router.post("/:id/live-view/:contactId/share", shareLiveView);
router.post("/:id/live-view/:contactId/rotate", rotateLiveView);
router.delete("/:id/live-view", revokeLiveView);
router.delete("/:id/live-view/:contactId", revokeLiveView);

module.exports = router;
