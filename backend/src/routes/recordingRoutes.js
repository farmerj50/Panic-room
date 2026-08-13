const express = require("express");
const router = express.Router();

const {
  createRecording,
  downloadRecordingFile,
  getRecordings,
  uploadRecordingFile,
} = require("../controllers/recordingController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");
const { singleFileUpload } = require("../middleware/uploadMiddleware");

// Unauthenticated: access is controlled by the signed, expiring token in the
// query string (see storageService), not a bearer token — mobile playback
// via Linking.openURL can't attach an Authorization header.
router.get("/file/:key", downloadRecordingFile);

router.use(authenticate, requireUserId);
router.post("/", createRecording);
router.get("/", getRecordings);
router.post("/upload", singleFileUpload, uploadRecordingFile);

module.exports = router;
