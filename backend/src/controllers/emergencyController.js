const prisma = require("../config/db");
const { decrypt, encrypt, safeDecrypt } = require("../services/cryptoService");

const hasSmsProviderConfig = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );

const hasVoiceProviderConfig = hasSmsProviderConfig;

const escapeTwiml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const sendSms = async ({ to, body }) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: from,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`SMS provider failed: ${details}`);
  }

  return response.json();
};

const sendVoiceCall = async ({ to, message }) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const twiml = `<Response><Say voice="alice">${escapeTwiml(message)}</Say></Response>`;
  const params = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Voice provider failed: ${details}`);
  }

  return response.json();
};

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

function serializeEmergencyEvent(event) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    latitude: encryptedNumberToFloat(event.latitudeEncrypted) ?? event.latitude ?? undefined,
    longitude: encryptedNumberToFloat(event.longitudeEncrypted) ?? event.longitude ?? undefined,
    status: event.status,
    audioUrl: safeDecrypt(event.audioUrl) ?? undefined,
    videoUrl: safeDecrypt(event.videoUrl) ?? undefined,
    contactNotified: event.contactNotified,
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

    res.status(201).json(serializeEmergencyEvent(event));
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
      "PanicRoom emergency activated. Please check your text messages for the user's latest location.";

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

    const serializedEvent = serializeEmergencyEvent(event);
    const body =
      message ||
      `PanicRoom emergency activated. Location: ${
        serializedEvent.latitude != null && serializedEvent.longitude != null
          ? `https://maps.google.com/?q=${serializedEvent.latitude},${serializedEvent.longitude}`
          : "unavailable"
      }`;

    const results = await Promise.allSettled(
      contacts.map((contact) => sendSms({ to: contact.phoneNumber, body }))
    );
    const notifiedCount = results.filter((result) => result.status === "fulfilled").length;

    await prisma.emergencyEvent.update({
      where: { id },
      data: { contactNotified: notifiedCount > 0 },
    });

    res.json({
      sent: notifiedCount > 0,
      notifiedCount,
      providerConfigured: true,
      failedCount: results.length - notifiedCount,
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

    res.json(events.map(serializeEmergencyEvent));
  } catch (error) {
    next(error);
  }
};
