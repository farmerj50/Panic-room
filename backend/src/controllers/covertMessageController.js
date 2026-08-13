const prisma = require("../config/db");
const { decrypt, encrypt } = require("../services/cryptoService");
const { getSignedDownloadUrl, hasStorageConfigured, saveFile } = require("../services/storageService");

function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function serializeCovertMessage(message, req) {
  const key = decrypt(message.fileUrl);
  return {
    id: message.id,
    createdAt: message.createdAt,
    senderId: message.senderId,
    status: message.status,
    protocolVersion: message.protocolVersion,
    fileUrl: getSignedDownloadUrl(key, getBaseUrl(req)),
  };
}

exports.uploadCovertMessageFile = async (req, res, next) => {
  try {
    if (!hasStorageConfigured()) {
      return res.status(503).json({ error: "Storage is not configured on this server." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "A file is required." });
    }

    const key = saveFile({ userId: req.user.id, buffer: req.file.buffer, ext: "png" });

    res.status(201).json({ key });
  } catch (error) {
    next(error);
  }
};

// Shared by createCovertMessage and getRecipientPublicKey — both need to
// resolve "this contact of mine" to an actual registered Bes account via
// the phone-hash match, and fail the same way when that's not possible.
async function resolveRecipientForContact(contactId, userId) {
  const contact = await prisma.trustedContact.findFirst({
    where: { id: contactId, userId },
  });
  if (!contact) return { error: { status: 404, message: "Contact not found." } };

  if (!contact.phoneHash) {
    return {
      error: {
        status: 422,
        message:
          "This contact was saved before phone matching was added. Re-save the contact to enable covert messages.",
      },
    };
  }

  const recipient = await prisma.user.findUnique({ where: { phoneHash: contact.phoneHash } });
  if (!recipient) {
    return {
      error: { status: 404, message: "This contact hasn't set up Bes with this phone number yet." },
    };
  }

  return { recipient };
}

exports.getRecipientPublicKey = async (req, res, next) => {
  try {
    const { contactId } = req.params;
    const { recipient, error } = await resolveRecipientForContact(contactId, req.user.id);
    if (error) return res.status(error.status).json({ error: error.message });

    if (!recipient.publicKey) {
      return res.status(422).json({
        error: "This contact hasn't set up covert messaging on their device yet.",
      });
    }

    res.json({ publicKey: recipient.publicKey });
  } catch (error) {
    next(error);
  }
};

exports.createCovertMessage = async (req, res, next) => {
  try {
    const { recipientContactId, fileKey } = req.body;
    if (!recipientContactId || !fileKey) {
      return res.status(400).json({ error: "recipientContactId and fileKey are required." });
    }

    const { recipient, error } = await resolveRecipientForContact(recipientContactId, req.user.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const message = await prisma.covertMessage.create({
      data: {
        senderId: req.user.id,
        recipientUserId: recipient.id,
        fileUrl: encrypt(fileKey),
      },
    });

    res.status(201).json(serializeCovertMessage(message, req));
  } catch (error) {
    next(error);
  }
};

exports.getInbox = async (req, res, next) => {
  try {
    const messages = await prisma.covertMessage.findMany({
      where: { recipientUserId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json(messages.map((message) => serializeCovertMessage(message, req)));
  } catch (error) {
    next(error);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.covertMessage.findFirst({
      where: { id, recipientUserId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Message not found." });

    const message = await prisma.covertMessage.update({
      where: { id },
      data: { status: "READ" },
    });

    res.json(serializeCovertMessage(message, req));
  } catch (error) {
    next(error);
  }
};
