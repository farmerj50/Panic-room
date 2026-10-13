// The one place that talks to GA4 Measurement Protocol. Used by both the
// mobile-analytics proxy endpoint (analyticsController.js) and the
// RevenueCat webhook (billingController.js), so the real API secret lives
// server-side only — never shipped to a client, unlike the mobile app's
// old direct-to-GA4 approach.
const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const COLLECT_URL = "https://www.google-analytics.com/mp/collect";

async function sendServerGA4Event(clientId, eventName, params = {}) {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET || !clientId) return;

  try {
    // engagement_time_msec is required for an event to count toward active
    // users / Realtime; server-originated events have no app session.
    const fullParams = { engagement_time_msec: 1, ...params };
    const response = await fetch(`${COLLECT_URL}?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`, {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        events: [{ name: eventName, params: fullParams }],
      }),
    });
    if (!response.ok) console.warn(`GA4 rejected ${eventName}: HTTP ${response.status}`);
  } catch {
    // Fire-and-forget — analytics must never surface as a user-facing failure.
  }
}

module.exports = { sendServerGA4Event };
