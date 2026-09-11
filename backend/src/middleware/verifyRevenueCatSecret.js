// Authenticates RevenueCat's webhook calls — this is NOT one of our users,
// so it doesn't go through the normal JWT authenticate() middleware. Instead
// RevenueCat sends back, verbatim on every request, whatever Authorization
// header value is configured for this webhook in the RevenueCat dashboard
// (Project Settings -> Integrations -> Webhooks).
function verifyRevenueCatSecret(req, res, next) {
  const header = req.headers.authorization || "";
  const expected = `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`;
  if (!process.env.REVENUECAT_WEBHOOK_SECRET || header !== expected) {
    return res.status(401).json({ error: "Invalid webhook credentials" });
  }
  next();
}

module.exports = { verifyRevenueCatSecret };
