const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";
const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

async function registerUser() {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Billing Test User" });
  return { accessToken: res.body.accessToken, userId: res.body.user.id };
}

async function deleteUser(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

function sendWebhook(event, secret = WEBHOOK_SECRET) {
  return request(app)
    .post("/api/billing/webhook")
    .set("Authorization", secret ? `Bearer ${secret}` : "")
    .send({ api_version: "1.0", event });
}

function entitlingEvent(overrides) {
  return {
    type: "INITIAL_PURCHASE",
    app_user_id: overrides.app_user_id,
    product_id: "bes_premium_monthly",
    entitlement_ids: ["premium"],
    purchased_at_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
    event_timestamp_ms: Date.now(),
    environment: "SANDBOX",
    store: "PLAY_STORE",
    ...overrides,
  };
}

describe("billing", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("GET /api/billing/status requires authentication", async () => {
    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(401);
  });

  test("a new user is free, with the 3-contact limit, until a purchase webhook lands", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .get("/api/billing/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.isPremium).toBe(false);
    expect(res.body.subscriptionStatus).toBe("free");
    expect(res.body.contactLimit).toBe(3);
  });

  test("webhook rejects a missing or wrong Authorization header", async () => {
    const { userId } = await registerUser();
    createdUserIds.push(userId);

    const missing = await sendWebhook(entitlingEvent({ app_user_id: userId }), null);
    expect(missing.status).toBe(401);

    const wrong = await sendWebhook(entitlingEvent({ app_user_id: userId }), "not-the-secret");
    expect(wrong.status).toBe(401);
  });

  test("INITIAL_PURCHASE grants premium and unlimited contactLimit", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const webhook = await sendWebhook(entitlingEvent({ app_user_id: userId }));
    expect(webhook.status).toBe(200);

    const status = await request(app)
      .get("/api/billing/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(status.body.isPremium).toBe(true);
    expect(status.body.subscriptionStatus).toBe("active");
    expect(status.body.contactLimit).toBeNull();
  });

  test("CANCELLATION keeps the user entitled until their expiry, EXPIRATION revokes it", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    await sendWebhook(entitlingEvent({ app_user_id: userId, event_timestamp_ms: Date.now() }));

    const cancelled = await sendWebhook({
      type: "CANCELLATION",
      app_user_id: userId,
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      event_timestamp_ms: Date.now() + 1,
    });
    expect(cancelled.status).toBe(200);

    const stillEntitled = await request(app)
      .get("/api/billing/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(stillEntitled.body.isPremium).toBe(true);
    expect(stillEntitled.body.subscriptionStatus).toBe("cancelled");

    const expired = await sendWebhook({
      type: "EXPIRATION",
      app_user_id: userId,
      expiration_at_ms: Date.now() - 1000,
      event_timestamp_ms: Date.now() + 2,
    });
    expect(expired.status).toBe(200);

    const noLongerEntitled = await request(app)
      .get("/api/billing/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(noLongerEntitled.body.isPremium).toBe(false);
    expect(noLongerEntitled.body.subscriptionStatus).toBe("expired");
  });

  test("a stale, out-of-order webhook event is dropped rather than regressing entitlement", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const now = Date.now();
    // Apply the NEWER event first...
    const newer = await sendWebhook(
      entitlingEvent({ app_user_id: userId, event_timestamp_ms: now + 1000, expiration_at_ms: now + 60_000_000 }),
    );
    expect(newer.status).toBe(200);

    // ...then a stale EXPIRATION that claims an earlier timestamp arrives late.
    const stale = await sendWebhook({
      type: "EXPIRATION",
      app_user_id: userId,
      expiration_at_ms: now - 1000,
      event_timestamp_ms: now, // older than the event already processed above
    });
    expect(stale.status).toBe(200); // still acked, just ignored

    const status = await request(app)
      .get("/api/billing/status")
      .set("Authorization", `Bearer ${accessToken}`);
    // The later-timestamped INITIAL_PURCHASE must still win.
    expect(status.body.isPremium).toBe(true);
    expect(status.body.subscriptionStatus).toBe("active");
  });

  test("webhook for an unknown app_user_id is acknowledged, not an error", async () => {
    const res = await sendWebhook(entitlingEvent({ app_user_id: "00000000-0000-0000-0000-000000000000" }));
    expect(res.status).toBe(200);
  });

  test("a malformed webhook payload is acknowledged, not an error", async () => {
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Authorization", `Bearer ${WEBHOOK_SECRET}`)
      .send({ not: "a real payload" });
    expect(res.status).toBe(200);
  });

  test("an unrecognized event type is acknowledged and ignored", async () => {
    const { userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await sendWebhook({
      type: "SUBSCRIPTION_PAUSED",
      app_user_id: userId,
      event_timestamp_ms: Date.now(),
    });
    expect(res.status).toBe(200);
  });
});
