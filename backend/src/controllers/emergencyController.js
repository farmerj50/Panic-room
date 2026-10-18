const prisma = require("../config/db");
const { decrypt, encrypt, safeDecrypt } = require("../services/cryptoService");
const { hasVoiceProviderConfig, sendVoiceCall } = require("../services/smsServices");
const { getSignedDownloadUrl } = require("../services/storageService");
const { dispatchEmergencyAlerts } = require("../services/smsDispatchService");
const { firstNameOf } = require("../services/smsConsentService");
const liveView = require("../services/liveViewService");

const VALID_STATUSES = new Set(["ACTIVE", "RESOLVED"]);

function getBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

// Short, user-safe reason shown on the emergency screen and stored on the
// event. Twilio's raw error body (which includes the account SID) is only
// ever logged server-side, never returned.
function describeNotificationFailure(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "TIMEOUT";
  if (error?.name === "TwilioProviderError") {
    const body = String(error.message || "").match(/\{.*\}/s);
    try {
      const parsed = body ? JSON.parse(body[0]) : null;
      if (parsed?.code) {
        const reason = String(parsed.message || "").replace(/\s+for account AC[0-9a-f]{32}/i, "");
        return `PROVIDER_ERROR: Twilio error ${parsed.code}${reason ? `: ${reason}` : ""}`;
      }
    } catch {
      // Not JSON — fall through to the plain message.
    }
    return `PROVIDER_ERROR: ${String(error.message || "").replace(/AC[0-9a-f]{32}/g, "[account]")}`;
  }
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
    endedAt: event.endedAt ?? undefined,
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

// Offline-first activation: the phone generates the emergency's id when the
// person activates it — with or without signal — and keeps recording against
// it. The create is idempotent on that id, so the phone can retry it until
// it succeeds without ever producing a second emergency.
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// How far back an offline activation time is accepted (the phone may only
// reconnect days later); anything older or in the future falls back to now.
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clientTime(value, notBefore) {
  const parsed = parseValidDate(value);
  if (!parsed.ok) return null;
  const t = parsed.date.getTime();
  const now = Date.now();
  if (t > now + CLOCK_SKEW_MS || t < now - MAX_OFFLINE_AGE_MS) return null;
  if (notBefore && t < notBefore.getTime()) return null;
  return parsed.date;
}

exports.createEmergencyEvent = async (req, res, next) => {
  try {
    const { id, activatedAt, endedAt, latitude, longitude, status, audioUrl, videoUrl, contactNotified } = req.body;
    const parsedLatitude = toNullableNumber(latitude);
    const parsedLongitude = toNullableNumber(longitude);
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "status must be 'ACTIVE' or 'RESOLVED'" });
    }
    if (id !== undefined && (typeof id !== "string" || !CLIENT_ID_RE.test(id))) {
      return res.status(400).json({ error: "id must be a UUID v4" });
    }

    const include = { videoSegments: { orderBy: { sequence: "asc" } } };
    if (id) {
      const existing = await prisma.emergencyEvent.findUnique({ where: { id }, include });
      if (existing) {
        // A retry of a create that already succeeded: the same emergency.
        if (existing.userId !== req.user.id) return res.status(409).json({ error: "Emergency id already in use" });
        return res.status(200).json(serializeEmergencyEvent(existing, req));
      }
    }

    const startedAt = clientTime(activatedAt);
    const resolved = status === "RESOLVED";
    const resolvedAt = resolved ? clientTime(endedAt, startedAt) ?? new Date() : null;

    let event;
    try {
      event = await prisma.emergencyEvent.create({
        data: {
          ...(id ? { id } : {}),
          ...(startedAt ? { createdAt: startedAt } : {}),
          userId: req.user.id,
          latitude: null,
          longitude: null,
          latitudeEncrypted: parsedLatitude === null ? null : encrypt(parsedLatitude),
          longitudeEncrypted: parsedLongitude === null ? null : encrypt(parsedLongitude),
          status: status || "ACTIVE",
          endedAt: resolvedAt,
          audioUrl: audioUrl ? encrypt(audioUrl) : null,
          videoUrl: videoUrl ? encrypt(videoUrl) : null,
          contactNotified: contactNotified || false,
        },
        include,
      });
    } catch (error) {
      // Two retries of the same create racing each other: the loser returns
      // the row the winner just wrote.
      if (id && error?.code === "P2002") {
        const winner = await prisma.emergencyEvent.findUnique({ where: { id }, include });
        if (winner && winner.userId === req.user.id) return res.status(200).json(serializeEmergencyEvent(winner, req));
        return res.status(409).json({ error: "Emergency id already in use" });
      }
      throw error;
    }

    // Live View links are best-effort: activation never fails because of them.
    if (!resolved && liveView.isLiveViewEnabled()) {
      await liveView
        .ensureLinks(event)
        .catch((error) => console.error("Live View link issue failed:", error?.message || error));
    }

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
    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ error: "status must be 'ACTIVE' or 'RESOLVED'" });
      }
      if (status === "ACTIVE" && event.status === "RESOLVED") {
        return res.status(409).json({ error: "A resolved emergency can't be reopened" });
      }
      data.status = status;
      // First resolution only — Live View expiry counts from here.
      if (status === "RESOLVED" && !event.endedAt) data.endedAt = new Date();
    }

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
    const failedCount = results.length - calledCount;
    const firstFailure = results.find((result) => result.status === "rejected")?.reason;
    if (failedCount > 0) console.error("Emergency voice call failed:", firstFailure?.message || firstFailure);

    res.json({
      called: calledCount > 0,
      calledCount,
      providerConfigured: true,
      failedCount,
      ...(calledCount === 0 && firstFailure ? { error: describeNotificationFailure(firstFailure) } : {}),
    });
  } catch (error) {
    next(error);
  }
};

exports.notifyEmergencyContacts = async (req, res, next) => {
  try {
    const { id } = req.params;

    const event = await prisma.emergencyEvent.findFirst({ where: { id, userId: req.user.id } });
    if (!event) return res.status(404).json({ error: "Emergency event not found" });

    // Recipients are chosen server-side from the user's STORED contacts and
    // filtered to those who consented to SMS for their current number — any
    // numbers in the request body are ignored. Calls are unaffected by this.
    const serializedEvent = serializeEmergencyEvent(event, req);
    const summary = await dispatchEmergencyAlerts({
      event: { id: event.id, latitude: serializedEvent.latitude, longitude: serializedEvent.longitude },
      userId: req.user.id,
    });

    let notificationError = null;
    if (!summary.smsAvailable) {
      notificationError = summary.error;
    } else if (summary.queuedCount === 0 && summary.failedCount > 0) {
      notificationError = describeNotificationFailure(summary.error);
    } else if (summary.queuedCount === 0 && summary.uncertainCount > 0) {
      notificationError = "TIMEOUT"; // outcome unknown — reconciled later, never re-sent
    } else if (summary.failedCount > 0) {
      notificationError = `${summary.failedCount}/${summary.eligibleCount} deliveries failed`;
    }

    if (summary.smsAvailable && summary.eligibleCount > 0) {
      await prisma.emergencyEvent.update({
        where: { id },
        data: {
          contactNotified: summary.queuedCount > 0,
          notificationError,
          notificationAttempts: { increment: 1 },
        },
      });
    }
    if (notificationError && summary.smsAvailable) console.error("Emergency SMS issue:", notificationError);

    // `queued` means Twilio accepted the request — NOT that it was delivered.
    res.json({
      smsAvailable: summary.smsAvailable,
      providerConfigured: summary.error !== "NOT_CONFIGURED",
      contactCount: summary.contactCount,
      eligibleCount: summary.eligibleCount,
      ineligibleCount: summary.ineligibleCount,
      queuedCount: summary.queuedCount,
      failedCount: summary.failedCount,
      uncertainCount: summary.uncertainCount,
      skippedDuplicateCount: summary.skippedDuplicateCount,
      // Back-compat for older app builds.
      sent: summary.queuedCount > 0,
      notifiedCount: summary.queuedCount,
      ...(notificationError ? { error: notificationError } : {}),
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
    // Segments are served to trusted contacts — only the owner's own
    // uploads may be attached.
    if (!fileUrl.startsWith(`${req.user.id}/`) || fileUrl.includes("..") || fileUrl.includes("\\")) {
      return res.status(400).json({ error: "fileUrl must be one of your uploads" });
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

// ── GPS history ───────────────────────────────────────────────────────────
// POST /api/emergency/:id/locations
//   live:  { latitude, longitude, accuracy?, recordedAt }
//   batch: { points: [{ latitude, longitude, accuracy?, recordedAt }], thinned? }
// Batches come from the phone's offline queue and may arrive after the
// emergency ended; they're accepted only inside its own time window.
const MAX_LOCATION_BATCH = 200;
const LIVE_POINT_MIN_GAP_MS = 10 * 1000;
const BACKFILL_GRACE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function parsePoint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const latitude = toNullableNumber(raw.latitude);
  const longitude = toNullableNumber(raw.longitude);
  const recordedAt = new Date(raw.recordedAt);
  if (latitude === null || latitude < -90 || latitude > 90) return null;
  if (longitude === null || longitude < -180 || longitude > 180) return null;
  if (raw.recordedAt === undefined || Number.isNaN(recordedAt.getTime())) return null;
  const accuracy = toNullableNumber(raw.accuracy);
  return { latitude, longitude, recordedAt, accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null };
}

exports.addLocations = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isBatch = Array.isArray(req.body?.points);
    const rawPoints = isBatch ? req.body.points : [req.body];
    if (rawPoints.length === 0) return res.status(400).json({ error: "points must not be empty" });
    if (rawPoints.length > MAX_LOCATION_BATCH) {
      return res.status(400).json({ error: `At most ${MAX_LOCATION_BATCH} points per request` });
    }
    const points = rawPoints.map(parsePoint);
    if (points.some((point) => !point)) {
      return res.status(400).json({ error: "Each point needs a valid latitude, longitude and recordedAt" });
    }

    const emergency = await prisma.emergencyEvent.findFirst({ where: { id, userId: req.user.id } });
    if (!emergency) return res.status(404).json({ error: "Emergency event not found" });

    const windowStart = new Date(emergency.createdAt).getTime() - CLOCK_SKEW_MS;
    let windowEnd = Date.now() + CLOCK_SKEW_MS;
    if (emergency.status === "RESOLVED") {
      if (!isBatch || !emergency.endedAt) return res.status(409).json({ error: "Emergency has ended" });
      windowEnd = new Date(emergency.endedAt).getTime() + BACKFILL_GRACE_MS;
    }
    const inWindow = points.filter((point) => {
      const t = point.recordedAt.getTime();
      return t >= windowStart && t <= windowEnd;
    });
    if (inWindow.length === 0) {
      return res.status(409).json({ error: "Points are outside this emergency's time window" });
    }

    // Live single points: at most one per 10s. Extra fixes are acknowledged
    // (202) but not stored, so the phone doesn't keep retrying them.
    if (!isBatch) {
      const latest = await prisma.emergencyLocation.findFirst({
        where: { emergencyId: id },
        orderBy: { recordedAt: "desc" },
      });
      const gap = latest ? inWindow[0].recordedAt.getTime() - new Date(latest.recordedAt).getTime() : Infinity;
      if (gap >= 0 && gap < LIVE_POINT_MIN_GAP_MS) {
        return res.status(202).json({ accepted: 0, ignored: 1 });
      }
    }

    const created = await prisma.emergencyLocation.createMany({
      data: inWindow.map((point) => ({
        emergencyId: id,
        latitudeEncrypted: encrypt(point.latitude),
        longitudeEncrypted: encrypt(point.longitude),
        accuracy: point.accuracy,
        recordedAt: point.recordedAt,
      })),
      skipDuplicates: true, // offline-queue retries are idempotent on recordedAt
    });
    const thinned = Number(req.body?.thinned);
    if (isBatch && Number.isInteger(thinned) && thinned > 0 && thinned < 1000000) {
      await prisma.emergencyEvent.update({ where: { id }, data: { locationsThinned: { increment: thinned } } });
    }

    res.status(201).json({ accepted: created.count, ignored: points.length - created.count });
  } catch (error) {
    next(error);
  }
};

// ── Live View (owner side) ────────────────────────────────────────────────
async function shareMessageFor(req, url) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { nameEncrypted: true } });
  const name = firstNameOf(user);
  return `${name ? `${name} activated` : "I activated"} a Bes emergency. Watch live video and location: ${url}`;
}

async function sendLinkResult(req, res, result) {
  if (result.error === "not_found") return res.status(404).json({ error: "Emergency or contact not found" });
  if (result.error === "expired") return res.status(410).json({ error: "Live View for this emergency has expired" });
  res.json({ url: result.url, expiresAt: result.expiresAt, shareMessage: await shareMessageFor(req, result.url) });
}

exports.getLiveViewStatus = async (req, res, next) => {
  try {
    if (!liveView.isLiveViewEnabled()) return res.json({ enabled: false, links: [] });
    const emergency = await prisma.emergencyEvent.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!emergency) return res.status(404).json({ error: "Emergency event not found" });
    res.json({ enabled: true, links: await liveView.ownerStatus({ userId: req.user.id, emergencyId: emergency.id }) });
  } catch (error) {
    next(error);
  }
};

// Returns the SAME link every time — sharing again never disconnects anyone.
exports.shareLiveView = async (req, res, next) => {
  try {
    if (!liveView.isLiveViewEnabled()) return res.status(404).json({ enabled: false, error: "Live View is not enabled" });
    const result = await liveView.getShareLink({
      userId: req.user.id,
      emergencyId: req.params.id,
      contactId: req.params.contactId,
      baseUrl: getBaseUrl(req),
    });
    await sendLinkResult(req, res, result);
  } catch (error) {
    next(error);
  }
};

// Explicit reset: the previous link and its media URLs stop working.
exports.rotateLiveView = async (req, res, next) => {
  try {
    if (!liveView.isLiveViewEnabled()) return res.status(404).json({ enabled: false, error: "Live View is not enabled" });
    const result = await liveView.rotateLink({
      userId: req.user.id,
      emergencyId: req.params.id,
      contactId: req.params.contactId,
      baseUrl: getBaseUrl(req),
    });
    await sendLinkResult(req, res, result);
  } catch (error) {
    next(error);
  }
};

// Works even with the feature switched off, so access can always be withdrawn.
exports.revokeLiveView = async (req, res, next) => {
  try {
    const emergency = await prisma.emergencyEvent.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!emergency) return res.status(404).json({ error: "Emergency event not found" });
    const revoked = await liveView.revokeLinks({
      userId: req.user.id,
      emergencyId: emergency.id,
      contactId: req.params.contactId,
    });
    res.json({ revoked });
  } catch (error) {
    next(error);
  }
};
