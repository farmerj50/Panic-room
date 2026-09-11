const prisma = require("../config/db");
const { decrypt, encrypt, safeDecrypt } = require("../services/cryptoService");
const {
  hasSmsProviderConfig,
  hasVoiceProviderConfig,
  sendSms,
  sendVoiceCall,
} = require("../services/smsServices");
const { getSignedDownloadUrl } = require("../services/storageService");

function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function describeNotificationFailure(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "TIMEOUT";
  if (error?.name === "TwilioProviderError") return `PROVIDER_ERROR: ${error.message}`;
  return "SEND_ERROR";
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function encryptedNumberToFloat(value) {
  const decrypted = safeDecrypt(value);
  if (decrypted === null) return null;
  const parsed = Number(decrypted);
  return Number.isFinite(parsed) ? parsed : null;
}

function keyToSignedUrl(encryptedKey, req) {
  const key = safeDecrypt(encryptedKey);
  return key ? getSignedDownloadUrl(key, getBaseUrl(req)) : undefined;
}

function serializeVideoSegment(segment, req) {
  return {
    id: segment.id,
    fileUrl: keyToSignedUrl(segment.fileUrl, req),
    facing: segment.facing,
    sequence: segment.sequence,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt ?? undefined,
  };
}

function serializeEmergencyEvent(event, req) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    latitude: encryptedNumberToFloat(event.latitudeEncrypted) ?? event.latitude ?? undefined,
    longitude: encryptedNumberToFloat(event.longitudeEncrypted) ?? event.longitude ?? undefined,
    status: event.status,
    audioUrl: keyToSignedUrl(event.audioUrl, req),
    // Legacy single-video field — no longer written to (see schema comment),
    // kept so pre-video-segments emergencies still show their video.
    videoUrl: keyToSignedUrl(event.videoUrl, req),
    videoSegments: (event.videoSegments ?? []).map((seg) => serializeVideoSegment(seg, req)),
    contactNotified: event.contactNotified,
    notificationError: event.notificationError ?? undefined,
    notificationAttempts: event.notificationAttempts,
  };
}

exports.createEmergencyEvent = async (req, res, next) => {
  try {
    const { latitude, longitude, status, audioUrl, videoUrl, contactNotified } = req.body;
    const parsedLatitude = toNullableNumber(latitude);
    const parsedLongitude = toNullableNumber(longitude);

    const event = await prisma.emergencyEvent.create({
      data: {
        userId: req.user.id,
        latitude: null,
        longitude: null,
        latitudeEncrypted: parsedLatitude === null ? null : encrypt(parsedLatitude),
        longitudeEncrypted: parsedLongitude === null ? null : encrypt(parsedLongitude),
        status: status || "ACTIVE",
        audioUrl: audioUrl ? encrypt(audioUrl) : null,
        videoUrl: videoUrl ? encrypt(videoUrl) : null,
        contactNotified: contactNotified || false,
      },
      include: { videoSegments: { orderBy: { sequence: "asc" } } },
    });

    res.status(201).json(serializeEmergencyEvent(event, req));
  } catch (error) {
    next(error);
  }
};

exports.updateEmergencyEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { audioUrl, videoUrl, status } = req.body;

    const event = await prisma.emergencyEvent.findFirst({ where: { id, userId: req.user.id } });
    if (!event) return res.status(404).json({ error: "Emergency event not found" });

    const data = {};
    if (audioUrl !== undefined) data.audioUrl = audioUrl ? encrypt(audioUrl) : null;
    if (videoUrl !== undefined) data.videoUrl = videoUrl ? encrypt(videoUrl) : null;
    if (status !== undefined) data.status = status;

    const updated = await prisma.emergencyEvent.update({
      where: { id },
      data,
      include: { videoSegments: { orderBy: { sequence: "asc" } } },
    });

    res.json(serializeEmergencyEvent(updated, req));
  } catch (error) {
    next(error);
  }
};

exports.callEmergencyContacts = async (req, res, next) => {
  try {
    const { contacts = [], message } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "At least one contact is required" });
    }

    if (!hasVoiceProviderConfig()) {
      return res.json({
        called: false,
        calledCount: 0,
        providerConfigured: false,
        error:
          "Voice provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
      });
    }

    const body =
      message ||
      "Bes emergency activated. Please check your text messages for the user's latest location.";

    const results = await Promise.allSettled(
      contacts.map((contact) => sendVoiceCall({ to: contact.phoneNumber, message: body }))
    );
    const calledCount = results.filter((result) => result.status === "fulfilled").length;

    res.json({
      called: calledCount > 0,
      calledCount,
      providerConfigured: true,
      failedCount: results.length - calledCount,
    });
  } catch (error) {
    next(error);
  }
};

exports.notifyEmergencyContacts = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { contacts = [], message } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      const storedContacts = await prisma.trustedContact.findMany({
        where: { userId: req.user.id },
      });
      contacts = storedContacts.map((contact) => ({
        name: decrypt(contact.name),
        phoneNumber: decrypt(contact.phoneNumber),
      }));
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "At least one contact is required" });
    }

    const event = await prisma.emergencyEvent.findFirst({ where: { id, userId: req.user.id } });
    if (!event) return res.status(404).json({ error: "Emergency event not found" });

    if (!hasSmsProviderConfig()) {
      return res.json({
        sent: false,
        notifiedCount: 0,
        providerConfigured: false,
        error:
          "SMS provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
      });
    }

    const serializedEvent = serializeEmergencyEvent(event, req);
    const body =
      message ||
      `Bes emergency activated. Location: ${
        serializedEvent.latitude != null && serializedEvent.longitude != null
          ? `https://maps.google.com/?q=${serializedEvent.latitude},${serializedEvent.longitude}`
          : "unavailable"
      }`;

    let notifiedCount = 0;
    let failedCount = contacts.length;

    try {
      const results = await Promise.allSettled(
        contacts.map((contact) => sendSms({ to: contact.phoneNumber, body }))
      );
      notifiedCount = results.filter((result) => result.status === "fulfilled").length;
      failedCount = results.length - notifiedCount;

      const notificationError =
        notifiedCount === results.length
          ? null
          : notifiedCount === 0
          ? describeNotificationFailure(results.find((r) => r.status === "rejected")?.reason)
          : `${failedCount}/${results.length} deliveries failed`;

      await prisma.emergencyEvent.update({
        where: { id },
        data: {
          contactNotified: notifiedCount > 0,
          notificationError,
          notificationAttempts: { increment: 1 },
        },
      });
    } catch (twilioError) {
      // Thrown outside the per-contact Promise.allSettled (e.g. a bug in the
      // dispatch loop itself) — still record that notification failed
      // instead of leaving contactNotified/notificationError stale.
      await prisma.emergencyEvent
        .update({
          where: { id },
          data: {
            contactNotified: false,
            notificationError: describeNotificationFailure(twilioError),
            notificationAttempts: { increment: 1 },
          },
        })
        .catch(() => {});
      throw twilioError;
    }

    res.json({
      sent: notifiedCount > 0,
      notifiedCount,
      providerConfigured: true,
      failedCount,
    });
  } catch (error) {
    next(error);
  }
};

exports.getEmergencyEvents = async (req, res, next) => {
  try {
    const events = await prisma.emergencyEvent.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { videoSegments: { orderBy: { sequence: "asc" } } },
    });

    res.json(events.map((event) => serializeEmergencyEvent(event, req)));
  } catch (error) {
    next(error);
  }
};

const VALID_FACINGS = new Set(["front", "back"]);

function parseValidDate(value) {
  if (value === undefined || value === null) return { ok: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, date };
}

exports.addVideoSegment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fileUrl, facing, sequence, startedAt, endedAt } = req.body;

    if (typeof fileUrl !== "string" || !fileUrl) {
      return res.status(400).json({ error: "fileUrl is required" });
    }
    if (!VALID_FACINGS.has(facing)) {
      return res.status(400).json({ error: "facing must be 'front' or 'back'" });
    }
    if (!Number.isInteger(sequence) || sequence < 1) {
      return res.status(400).json({ error: "sequence must be an integer >= 1" });
    }
    const startedAtParsed = parseValidDate(startedAt);
    if (!startedAtParsed.ok) {
      return res.status(400).json({ error: "startedAt must be a valid date" });
    }
    let endedAtParsed = null;
    if (endedAt !== undefined && endedAt !== null) {
      const parsed = parseValidDate(endedAt);
      if (!parsed.ok) {
        return res.status(400).json({ error: "endedAt must be a valid date" });
      }
      if (parsed.date.getTime() < startedAtParsed.date.getTime()) {
        return res.status(400).json({ error: "endedAt must not be before startedAt" });
      }
      endedAtParsed = parsed.date;
    }

    const emergency = await prisma.emergencyEvent.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!emergency) return res.status(404).json({ error: "Emergency event not found" });

    const encryptedFileUrl = encrypt(fileUrl);

    // Retrying a metadata POST after a lost response must not fail just
    // because the row already exists — that would make the client treat
    // safely-stored evidence as missing and retry forever. A retry with
    // the *same* data for this (emergencyId, sequence) returns the
    // existing row as success; different data for an already-used
    // sequence is a genuine conflict (409), not a retry.
    //
    // encrypt() uses a random IV, so re-encrypting the same plaintext
    // never produces the same ciphertext twice — "same data" must be
    // decided by comparing decrypted plaintext, never by comparing
    // ciphertext to a freshly-encrypted value.
    const existing = await prisma.emergencyVideoSegment.findUnique({
      where: { emergencyId_sequence: { emergencyId: id, sequence } },
    });

    if (existing) {
      const sameData =
        safeDecrypt(existing.fileUrl) === fileUrl && existing.facing === facing;
      if (!sameData) {
        return res.status(409).json({ error: "A different segment already exists for this sequence" });
      }
      return res.status(200).json(serializeVideoSegment(existing, req));
    }

    const segment = await prisma.emergencyVideoSegment.create({
      data: {
        emergencyId: id,
        fileUrl: encryptedFileUrl,
        facing,
        sequence,
        startedAt: startedAtParsed.date,
        endedAt: endedAtParsed,
      },
    });

    res.status(201).json(serializeVideoSegment(segment, req));
  } catch (error) {
    // A P2002 unique-constraint violation here means two requests for the
    // same (emergencyId, sequence) raced past the findUnique check above.
    // Re-apply the same same-data-is-success logic rather than treating a
    // concurrent identical retry as a failure.
    if (error?.code === "P2002") {
      try {
        const { fileUrl, facing, sequence } = req.body;
        const raced = await prisma.emergencyVideoSegment.findUnique({
          where: { emergencyId_sequence: { emergencyId: req.params.id, sequence } },
        });
        if (raced && safeDecrypt(raced.fileUrl) === fileUrl && raced.facing === facing) {
          return res.status(200).json(serializeVideoSegment(raced, req));
        }
      } catch {}
      return res.status(409).json({ error: "A segment already exists for this sequence" });
    }
    next(error);
  }
};
