const prisma = require("../config/db");
const { encrypt, safeDecrypt } = require("../services/cryptoService");

function serializeRecording(recording) {
  return {
    id: recording.id,
    createdAt: recording.createdAt,
    fileUrl: safeDecrypt(recording.fileUrl) ?? "",
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

    res.status(201).json(serializeRecording(recording));
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

    res.json(recordings.map(serializeRecording));
  } catch (error) {
    next(error);
  }
};
