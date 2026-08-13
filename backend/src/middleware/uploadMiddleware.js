const multer = require("multer");

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// Shared by both /api/recordings/upload and /api/covert-messages/upload —
// generic single-file-under-field-"file" multipart parsing, nothing
// recording-specific about it.
const singleFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
}).single("file");

module.exports = { singleFileUpload };
