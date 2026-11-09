// Optional phone recovery tracking: after an SOS ends, the phone may keep
// sending its location into the same emergency until the owner marks it
// recovered, stops it from another device, or 72 hours pass.
//
// Tracking states (separate from the emergency's own ACTIVE/RESOLVED status,
// so evidence processing is unaffected):
//   SOS_ACTIVE         the emergency is ACTIVE
//   RECOVERY_TRACKING  ended SOS, recovery tracking on and not expired
//   CLOSED             nothing is being tracked any more
//
// Rules enforced here (the phone is never trusted to decide them):
//  - Recovery starts only in the request that first ends an ACTIVE emergency
//    (or creates one already ended, for an SOS that ran without signal),
//    from the owner's own authenticated app, and only if the account had
//    opted in at or before the moment the SOS ended.
//  - It never restarts: once it has ended, expired, or was never started for
//    this emergency, it stays that way.
//  - A remote stop or expiry is final immediately on the server, even while
//    the phone is offline; points recorded after that moment are rejected.

const prisma = require("../config/db");

const RECOVERY_TTL_MS = 72 * 60 * 60 * 1000;
const END_REASONS = new Set(["recovered", "remote_stop", "expired", "consent_withdrawn", "permission_revoked"]);

function expiresAtOf(event) {
  return event.recoveryExpiresAt ? new Date(event.recoveryExpiresAt).getTime() : null;
}

function trackingStateOf(event, now = Date.now()) {
  if (event.status === "ACTIVE") return "SOS_ACTIVE";
  if (event.recoveryStatus === "RECOVERY_TRACKING" && now < expiresAtOf(event)) return "RECOVERY_TRACKING";
  return "CLOSED";
}

// When recovery tracking ended (or will have ended, if it simply expired and
// nobody has looked since). Null if it never ran or is still running.
function recoveryEndOf(event, now = Date.now()) {
  if (!event.recoveryStatus) return null;
  if (event.recoveryEndedAt) return new Date(event.recoveryEndedAt).getTime();
  const expiresAt = expiresAtOf(event);
  return expiresAt !== null && now >= expiresAt ? expiresAt : null;
}

function trackingView(event, now = Date.now()) {
  const state = trackingStateOf(event, now);
  if (!event.recoveryStatus) return { state, recovery: null };
  const end = recoveryEndOf(event, now);
  return {
    state,
    recovery: {
      startedAt: event.recoveryStartedAt,
      expiresAt: event.recoveryExpiresAt,
      endedAt: end === null ? null : new Date(end),
      endReason: event.recoveryEndReason || (end !== null ? "expired" : null),
    },
  };
}

// The fields to write when an emergency is being resolved with the phone
// asking for recovery tracking — or null when it isn't allowed.
// endedAt: when the SOS ended (Date). user: { recoveryTrackingConsentAt }.
function recoveryStartFields(event, user, endedAt, now = Date.now()) {
  if (event.recoveryStatus) return null; // never twice
  const consentAt = user?.recoveryTrackingConsentAt ? new Date(user.recoveryTrackingConsentAt) : null;
  if (!consentAt || consentAt.getTime() > endedAt.getTime()) return null;
  const expiresAt = new Date(endedAt.getTime() + RECOVERY_TTL_MS);
  if (expiresAt.getTime() <= now) return null;
  return {
    recoveryStatus: "RECOVERY_TRACKING",
    recoveryConsentAt: consentAt,
    recoveryStartedAt: endedAt,
    recoveryExpiresAt: expiresAt,
  };
}

// Ends recovery tracking for one of the owner's emergencies. Idempotent:
// returns the (possibly unchanged) event, or null if it isn't the owner's.
async function stopRecovery({ emergencyId, userId, reason, now = new Date() }) {
  if (!END_REASONS.has(reason)) throw new Error(`Unknown recovery end reason: ${reason}`);
  const event = await prisma.emergencyEvent.findFirst({ where: { id: emergencyId, userId } });
  if (!event) return null;
  if (event.recoveryStatus !== "RECOVERY_TRACKING") return event;
  // Already past its expiry: record it as expired, at the expiry time.
  const expired = now.getTime() >= expiresAtOf(event);
  await prisma.emergencyEvent.updateMany({
    where: { id: emergencyId, recoveryStatus: "RECOVERY_TRACKING" },
    data: {
      recoveryStatus: "ENDED",
      recoveryEndedAt: expired ? event.recoveryExpiresAt : now,
      recoveryEndReason: expired ? "expired" : reason,
    },
  });
  return prisma.emergencyEvent.findUnique({ where: { id: emergencyId } });
}

// Turning the setting off withdraws consent and ends any tracking running now.
async function setConsent(userId, enabled, now = new Date()) {
  await prisma.user.update({ where: { id: userId }, data: { recoveryTrackingConsentAt: enabled ? now : null } });
  if (enabled) return;
  const running = await prisma.emergencyEvent.findMany({
    where: { userId, recoveryStatus: "RECOVERY_TRACKING" },
    select: { id: true },
  });
  for (const { id } of running) await stopRecovery({ emergencyId: id, userId, reason: "consent_withdrawn", now });
}

// Which point observation times the server accepts for this emergency.
//  - live: whether single live points are accepted (vs. offline backfill only)
//  - stopped: tracking has been stopped/expired — the phone should stop too
function pointWindow(event, { now = Date.now(), clockSkewMs, backfillGraceMs }) {
  const start = new Date(event.createdAt).getTime() - clockSkewMs;
  const state = trackingStateOf(event, now);
  if (state === "SOS_ACTIVE") return { start, end: now + clockSkewMs, live: true, stopped: false };
  if (state === "RECOVERY_TRACKING") {
    return { start, end: Math.min(now + clockSkewMs, expiresAtOf(event)), live: true, stopped: false };
  }
  const recoveryEnd = recoveryEndOf(event, now);
  if (recoveryEnd !== null) return { start, end: recoveryEnd, live: false, stopped: true };
  if (!event.endedAt) return { start, end: start, live: false, stopped: true };
  return { start, end: new Date(event.endedAt).getTime() + backfillGraceMs, live: false, stopped: true };
}

module.exports = {
  RECOVERY_TTL_MS,
  END_REASONS,
  trackingStateOf,
  trackingView,
  recoveryEndOf,
  recoveryStartFields,
  stopRecovery,
  setConsent,
  pointWindow,
};
