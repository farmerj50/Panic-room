// Twilio webhooks. Every request must carry a valid X-Twilio-Signature
// (HMAC-SHA1 with the account Auth Token) or it is rejected with 403.
//
// Toll-free numbers: Twilio itself handles STOP/START/HELP and sends the
// replies, and still forwards the inbound text here with OptOutType. Bes
// therefore NEVER replies (always empty TwiML) — it only mirrors the
// suppression state. START lifts a suppression; it can never CREATE consent
// (eligibility still requires an accepted invitation for that number).

const express = require("express");

const prisma = require("../config/db");
const { isValidTwilioSignature } = require("../services/smsServices");
const { phoneHashFor } = require("../services/smsConsentService");
const { advanceStatus, recordOptOut } = require("../services/smsDispatchService");

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: "16kb" }));

function requestUrl(req) {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${req.originalUrl}`;
}

function verifySignature(req, res, next) {
  if (!isValidTwilioSignature(requestUrl(req), req.body || {}, req.get("X-Twilio-Signature"))) {
    return res.status(403).type("text/plain").send("Forbidden");
  }
  next();
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

router.post("/sms-inbound", verifySignature, async (req, res) => {
  try {
    const optOutType = String(req.body.OptOutType || "").toUpperCase();
    const from = req.body.From;
    if (from && (optOutType === "STOP" || optOutType === "START")) {
      const phoneHash = phoneHashFor(from);
      if (optOutType === "STOP") {
        await recordOptOut(phoneHash, "carrier_stop");
        await prisma.smsConsentEvent.create({ data: { phoneHash, action: "carrier_stop" } });
      } else {
        await prisma.smsOptOut.deleteMany({ where: { phoneHash } });
        await prisma.smsConsentEvent.create({ data: { phoneHash, action: "carrier_start" } });
      }
    }
  } catch (error) {
    console.error("Twilio inbound webhook failed:", error?.message || error);
  }
  res.type("text/xml").send(EMPTY_TWIML);
});

router.post("/sms-status", verifySignature, async (req, res) => {
  try {
    const sid = req.body.MessageSid || req.body.SmsSid;
    const status = String(req.body.MessageStatus || req.body.SmsStatus || "").toLowerCase();
    const errorCode = req.body.ErrorCode ? String(req.body.ErrorCode) : null;
    if (sid && status) {
      if (errorCode === "21610") {
        const message = await prisma.smsMessage.findUnique({ where: { twilioSid: sid } });
        if (message) await recordOptOut(message.toPhoneHash, "send_21610");
        await advanceStatus({ twilioSid: sid }, "opted_out", { errorCode });
      } else {
        await advanceStatus({ twilioSid: sid }, status, errorCode ? { errorCode } : {});
      }
    }
  } catch (error) {
    console.error("Twilio status webhook failed:", error?.message || error);
  }
  res.status(204).end();
});

module.exports = router;
