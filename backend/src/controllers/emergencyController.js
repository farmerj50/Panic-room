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

function serializeEmergencyEvent(event, req) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    latitude: encryptedNumberToFloat(event.latitudeEncrypted) ?? event.latitude ?? undefined,
    longitude: encryptedNumberToFloat(event.longitudeEncrypted) ?? event.longitude ?? undefined,
    status: event.status,
    audioUrl: keyToSignedUrl(event.audioUrl, req),
    videoUrl: keyToSignedUrl(event.videoUrl, req),
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

    const updated = await prisma.emergencyEvent.update({ where: { id }, data });

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
    });

    res.json(events.map((event) => serializeEmergencyEvent(event, req)));
  } catch (error) {
    next(error);
  }
};
