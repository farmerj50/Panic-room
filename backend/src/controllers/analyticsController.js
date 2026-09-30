const { sendServerGA4Event } = require("../services/ga4Service");

// Defensive caps — this is an unauthenticated endpoint (see analyticsRoutes.js),
// so payload shape can't be trusted the way an authenticated body can.
const MAX_ID_LENGTH = 128;
const MAX_EVENT_NAME_LENGTH = 64;

exports.trackEvent = async (req, res) => {
  const clientId = String(req.body?.clientId || "").trim().slice(0, MAX_ID_LENGTH);
  const eventName = String(req.body?.eventName || "").trim().slice(0, MAX_EVENT_NAME_LENGTH);
  const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};

  if (clientId && eventName) {
    await sendServerGA4Event(clientId, eventName, params);
  }

  // Always 200 — analytics must never surface as a visible failure to the app.
  res.status(200).json({ received: true });
};
