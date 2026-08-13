const path = require("path");

const prisma = require("../config/db");
const { encrypt, safeDecrypt } = require("../services/cryptoService");
const {
  getFileStream,
  getSignedDownloadUrl,
  hasStorageConfigured,
  saveFile,
  verifyDownloadToken,
} = require("../services/storageService");

const MIME_EXTENSIONS = {
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function guessExtension(file) {
  const fromName = path.extname(file.originalname || "").replace(".", "");
  if (fromName) return fromName;
  return MIME_EXTENSIONS[file.mimetype] || "";
}

function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function serializeRecording(recording, req) {
  const key = safeDecrypt(recording.fileUrl);
  return {
    id: recording.id,
    createdAt: recording.createdAt,
    fileUrl: key ? getSignedDownloadUrl(key, getBaseUrl(req)) : "",
    type: recording.type,
  };
}

exports.createRecording = async (req, res, next) => {
  try {
    const { fileUrl, type } = req.body;

    if (!fileUrl || !["audio", "video"].includes(type)) {
      return res.status(400).json({ error: "A valid fileUrl and type are required" });
    }

    const recording = await prisma.recording.create({
      data: {
        userId: req.user.id,
        fileUrl: encrypt(fileUrl),
        type,
      },
    });

    res.status(201).json(serializeRecording(recording, req));
  } catch (error) {
    next(error);
  }
};

exports.getRecordings = async (req, res, next) => {
  try {
    const recordings = await prisma.recording.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json(recordings.map((recording) => serializeRecording(recording, req)));
  } catch (error) {
    next(error);
  }
};

exports.uploadRecordingFile = async (req, res, next) => {
  try {
    if (!hasStorageConfigured()) {
      return res.status(503).json({ error: "Recording storage is not configured on this server." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "A file is required." });
    }

    const key = saveFile({
      userId: req.user.id,
      buffer: req.file.buffer,
      ext: guessExtension(req.file),
    });

    res.status(201).json({ key, url: getSignedDownloadUrl(key, getBaseUrl(req)) });
  } catch (error) {
    next(error);
  }
};

// Unauthenticated by design: mobile playback (Linking.openURL) can't attach
// an Authorization header, so access control is the signed, expiring token
// instead of a bearer token — see storageService's signDownloadToken.
exports.downloadRecordingFile = async (req, res) => {
  const key = req.params.key;
  const token = req.query.token;

  if (!verifyDownloadToken(key, token)) {
    return res.status(403).json({ error: "Invalid or expired download link." });
  }

  let stream;
  try {
    stream = getFileStream(key);
  } catch {
    return res.status(400).json({ error: "Invalid download link." });
  }

  const ext = path.extname(key);
  if (ext) res.type(ext);

  if (!stream) {
    return res.status(404).json({ error: "File not found." });
  }

  stream.on("error", () => res.status(500).end());
  stream.pipe(res);
};
