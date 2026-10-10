// Emergency alert texts: atomic reservation -> Twilio -> SmsMessage audit.
// Never blocks an emergency: every failure is reported, not thrown.

const prisma = require("../config/db");
const { decrypt, hashLookup } = require("./cryptoService");
const smsServices = require("./smsServices");
const { isSmsEnabled, evaluateContacts } = require("./smsEligibilityService");
const { firstNameOf, phoneHashFor } = require("./smsConsentService");

const ALERT_WINDOW_MS = 2 * 60 * 1000;
const STALE_RESERVATION_MS = 10 * 60 * 1000;

// reserved < queued < sending < sent < (delivered | undelivered | failed | opted_out | unconfirmed)
const STATUS_RANK = { reserved: 0, accepted: 1, queued: 1, sending: 2, sent: 3 };
const FINAL_STATUSES = ["delivered", "undelivered", "failed", "opted_out", "unconfirmed"];
const rankOf = (status) => (FINAL_STATUSES.includes(status) ? 9 : STATUS_RANK[status] ?? -1);

function bodyHashOf(body) {
  return hashLookup(`sms-body:${body}`);
}

function buildAlertBody({ senderName, latitude, longitude }) {
  const who = senderName || "Your trusted contact";
  const location =
    latitude != null && longitude != null ? ` Location: https://maps.google.com/?q=${latitude},${longitude}` : "";
  return `Bes Safety Alert: ${who} activated an emergency.${location} Reply STOP to opt out, HELP for help.`;
}

function statusCallbackUrl() {
  return process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/api/twilio/sms-status` : undefined;
}

// Atomic per-(emergency, contact) reservation: at most one alert per window,
// even under concurrent notify requests. Postgres re-evaluates the UPDATE's
// WHERE after acquiring the row lock, so exactly one concurrent caller wins.
async function reserveAlert(emergencyId, contactId, now = new Date()) {
  try {
    await prisma.smsAlertState.create({ data: { emergencyId, contactId } });
  } catch (error) {
    if (error?.code !== "P2002") throw error; // already exists — fine
  }
  const cutoff = new Date(now.getTime() - ALERT_WINDOW_MS);
  const claimed = await prisma.smsAlertState.updateMany({
    where: { emergencyId, contactId, OR: [{ lastReservedAt: null }, { lastReservedAt: { lt: cutoff } }] },
    data: { lastReservedAt: now },
  });
  return claimed.count === 1;
}

// Moves a message forward only — an older/lower callback never overwrites a
// later status, and final statuses never change.
async function advanceStatus(where, status, extra = {}) {
  const lower = Object.keys(STATUS_RANK).filter((s) => rankOf(s) < rankOf(status));
  return prisma.smsMessage.updateMany({
    where: { ...where, status: { in: lower } },
    data: { status, statusUpdatedAt: new Date(), ...extra },
  });
}

async function recordOptOut(phoneHash, source) {
  await prisma.smsOptOut.upsert({ where: { phoneHash }, create: { phoneHash, source }, update: {} });
}

// Reconciles alert attempts stuck in `reserved` (the process died between
// reserving and Twilio answering, or the send timed out). NEVER re-sends —
// Twilio may already have accepted it. A Twilio message is attached only on
// an exact, unique match; anything ambiguous becomes `unconfirmed`.
async function sweepStaleReservations(now = new Date()) {
  const stale = await prisma.smsMessage.findMany({
    where: { status: "reserved", twilioSid: null, createdAt: { lt: new Date(now.getTime() - STALE_RESERVATION_MS) } },
    include: { contact: true },
    take: 50,
  });
  let resolved = 0;
  for (const message of stale) {
    let match = null;
    try {
      if (message.contact && smsServices.hasSmsProviderConfig()) {
        const to = decrypt(message.contact.phoneNumber);
        if (phoneHashFor(to) === message.toPhoneHash) {
          const windowStart = message.createdAt.getTime();
          const windowEnd = windowStart + STALE_RESERVATION_MS;
          const candidates = (await smsServices.listSentMessages({ to, since: message.createdAt })).filter((m) => {
            const created = new Date(m.date_created).getTime();
            return (
              m.from === process.env.TWILIO_FROM_NUMBER &&
              phoneHashFor(m.to) === message.toPhoneHash &&
              created >= windowStart - 1000 &&
              created <= windowEnd &&
              bodyHashOf(m.body) === message.bodyHash
            );
          });
          if (candidates.length === 1) {
            const alreadyLinked = await prisma.smsMessage.findUnique({ where: { twilioSid: candidates[0].sid } });
            if (!alreadyLinked) match = candidates[0];
          }
        }
      }
    } catch (error) {
      console.warn("SMS reconciliation lookup failed:", error?.message || error);
    }
    if (match) {
      await prisma.smsMessage.updateMany({
        where: { id: message.id, status: "reserved" },
        data: { twilioSid: match.sid, status: match.status || "sent", statusUpdatedAt: new Date() },
      });
    } else {
      await prisma.smsMessage.updateMany({
        where: { id: message.id, status: "reserved" },
        data: { status: "unconfirmed", statusUpdatedAt: new Date() },
      });
    }
    resolved += 1;
  }
  return resolved;
}

// Sends alert texts for an emergency to the user's ELIGIBLE stored contacts.
// Returns a summary; never throws for provider problems.
async function dispatchEmergencyAlerts({ event, userId }) {
  const evaluated = await evaluateContacts(userId);
  const eligible = evaluated.filter((entry) => entry.eligible);
  const summary = {
    smsAvailable: true,
    contactCount: evaluated.length,
    eligibleCount: eligible.length,
    ineligibleCount: evaluated.length - eligible.length,
    queuedCount: 0,
    failedCount: 0,
    skippedDuplicateCount: 0,
    uncertainCount: 0,
    error: null,
  };

  if (!isSmsEnabled()) return { ...summary, smsAvailable: false, error: "SMS_DISABLED" };
  if (!smsServices.hasSmsProviderConfig()) return { ...summary, smsAvailable: false, error: "NOT_CONFIGURED" };

  await sweepStaleReservations().catch((error) => console.warn("SMS sweep failed:", error?.message || error));

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { nameEncrypted: true } });
  const body = buildAlertBody({
    senderName: firstNameOf(user),
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
  });
  const bodyHash = bodyHashOf(body);

  for (const { contact } of eligible) {
    if (!(await reserveAlert(event.id, contact.id))) {
      summary.skippedDuplicateCount += 1;
      continue;
    }
    const to = decrypt(contact.phoneNumber);
    const toPhoneHash = phoneHashFor(to);
    const message = await prisma.smsMessage.create({
      data: { emergencyId: event.id, contactId: contact.id, toPhoneHash, bodyHash, status: "reserved" },
    });
    try {
      const sent = await smsServices.sendAlertSms({ to, body, statusCallback: statusCallbackUrl() });
      await prisma.smsMessage.updateMany({
        where: { id: message.id, status: "reserved" },
        data: { twilioSid: sent?.sid ?? null, status: "queued", statusUpdatedAt: new Date() },
      });
      summary.queuedCount += 1;
    } catch (error) {
      if (error?.uncertain) {
        summary.uncertainCount += 1; // stays `reserved` for the sweep — never retried
        continue;
      }
      const optedOut = error?.twilioCode === 21610;
      if (optedOut) await recordOptOut(toPhoneHash, "send_21610");
      await prisma.smsMessage.updateMany({
        where: { id: message.id, status: "reserved" },
        data: {
          status: optedOut ? "opted_out" : "failed",
          errorCode: String(error?.twilioCode ?? error?.status ?? "SEND_ERROR"),
          statusUpdatedAt: new Date(),
        },
      });
      summary.failedCount += 1;
      summary.error = summary.error || error;
    }
  }
  return summary;
}

module.exports = {
  ALERT_WINDOW_MS,
  STALE_RESERVATION_MS,
  FINAL_STATUSES,
  buildAlertBody,
  bodyHashOf,
  reserveAlert,
  advanceStatus,
  recordOptOut,
  sweepStaleReservations,
  dispatchEmergencyAlerts,
};
