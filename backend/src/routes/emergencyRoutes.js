const express = require("express");
const router = express.Router();

const {
  addLocations,
  addVideoSegment,
  callEmergencyContacts,
  createEmergencyEvent,
  getEmergencyEvents,
  getLiveViewStatus,
  getRecoveryConsent,
  getRoute,
  getTracking,
  notifyEmergencyContacts,
  revokeLiveView,
  rotateLiveView,
  setRecoveryConsent,
  shareLiveView,
  stopRecoveryTracking,
  updateEmergencyEvent,
} = require("../controllers/emergencyController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.post("/", createEmergencyEvent);
router.get("/", getEmergencyEvents);
router.get("/recovery-consent", getRecoveryConsent);
router.put("/recovery-consent", setRecoveryConsent);
router.patch("/:id", updateEmergencyEvent);
router.post("/call", callEmergencyContacts);
router.post("/:id/notify", notifyEmergencyContacts);
router.post("/:id/video-segments", addVideoSegment);
router.post("/:id/locations", addLocations);
router.get("/:id/route", getRoute);
router.get("/:id/tracking", getTracking);
router.post("/:id/recovery/stop", stopRecoveryTracking);
router.get("/:id/live-view", getLiveViewStatus);
router.post("/:id/live-view/:contactId/share", shareLiveView);
router.post("/:id/live-view/:contactId/rotate", rotateLiveView);
router.delete("/:id/live-view", revokeLiveView);
router.delete("/:id/live-view/:contactId", revokeLiveView);

module.exports = router;
