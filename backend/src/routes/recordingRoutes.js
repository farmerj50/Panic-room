const express = require("express");
const router = express.Router();

const {
  createRecording,
  getRecordings,
} = require("../controllers/recordingController");
const { authenticate } = require("../middleware/authMiddleware");

router.use(authenticate);
router.post("/", createRecording);
router.get("/", getRecordings);

module.exports = router;
