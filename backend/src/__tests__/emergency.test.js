const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";

// Node's global fetch (undici) does not route through the http/https module,
// so nock — which patches http.ClientRequest — cannot intercept it. Stubbing
// global.fetch directly is the reliable way to control Twilio's HTTP calls
// from smsServices.js in tests.
const originalFetch = global.fetch;

function stubTwilioResponse(handler) {
  global.fetch = async (url, opts) => {
    if (!String(url).includes("twilio.com")) return originalFetch(url, opts);
    return handler(url, opts);
  };
}

// Mimics a real fetch that never resolves until the AbortSignal fires —
// needed so smsServices' AbortSignal.timeout() actually has something to
// abort, instead of a stub that ignores the signal entirely.
function stubTwilioHang(delayMs) {
  global.fetch = (url, opts) => {
    if (!String(url).includes("twilio.com")) return originalFetch(url, opts);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ ok: true, status: 201, json: async () => ({ sid: "too-late" }) }),
        delayMs,
      );
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        reject(err);
      });
    });
  };
}

async function registerUserWithContact() {
  const email = uniqueEmail();
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Emergency Test User" });
  const accessToken = reg.body.accessToken;
  const userId = reg.body.user.id;

  await request(app)
    .post("/api/contacts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Trusted One", phoneNumber: "+15551234567" });

  return { accessToken, userId };
}

async function deleteUser(userId) {
  await prisma.emergencyEvent.deleteMany({ where: { userId } });
  await prisma.trustedContact.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("emergency", () => {
  const createdUserIds = [];

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("requires authentication to create an event", async () => {
    const res = await request(app).post("/api/emergency").send({ latitude: 1, longitude: 2 });
    expect(res.status).toBe(401);
  });

  test("a user cannot notify or view another user's emergency event", async () => {
    const owner = await registerUserWithContact();
    const attacker = await registerUserWithContact();
    createdUserIds.push(owner.userId, attacker.userId);

    const created = await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const notifyAttempt = await request(app)
      .post(`/api/emergency/${created.body.id}/notify`)
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({});
    expect(notifyAttempt.status).toBe(404);
  });

  test("notify succeeds and persists contactNotified when Twilio accepts the message", async () => {
    const { accessToken, userId } = await registerUserWithContact();
    createdUserIds.push(userId);

    stubTwilioResponse(async () => ({ ok: true, status: 201, json: async () => ({ sid: "SM_fake" }) }));

    const created = await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const res = await request(app)
      .post(`/api/emergency/${created.body.id}/notify`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.notifiedCount).toBe(1);

    const events = await request(app)
      .get("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`);
    const event = events.body.find((e) => e.id === created.body.id);
    expect(event.contactNotified).toBe(true);
    expect(event.notificationError).toBeUndefined();
  });

  test("notify persists a failure and does not mark contactNotified when Twilio keeps returning 500", async () => {
    const { accessToken, userId } = await registerUserWithContact();
    createdUserIds.push(userId);

    // withRetry attempts up to 3 times total (1 + 2 retries) for a 5xx.
    stubTwilioResponse(async () => ({ ok: false, status: 500, text: async () => "twilio internal error" }));

    const created = await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const res = await request(app)
      .post(`/api/emergency/${created.body.id}/notify`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.notifiedCount).toBe(0);

    const events = await request(app)
      .get("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`);
    const event = events.body.find((e) => e.id === created.body.id);
    expect(event.contactNotified).toBe(false);
    expect(event.notificationError).toEqual(expect.stringContaining("PROVIDER_ERROR"));
    expect(event.notificationAttempts).toBe(1);
  }, 15000);

  test("notify persists a TIMEOUT failure when Twilio never responds in time", async () => {
    const { accessToken, userId } = await registerUserWithContact();
    createdUserIds.push(userId);

    // TWILIO_TIMEOUT_MS is 200 in .env.test; hang well past that on every
    // retry attempt so each one aborts.
    stubTwilioHang(2000);

    const created = await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const res = await request(app)
      .post(`/api/emergency/${created.body.id}/notify`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);

    const events = await request(app)
      .get("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`);
    const event = events.body.find((e) => e.id === created.body.id);
    expect(event.notificationError).toBe("TIMEOUT");
  }, 15000);

  test("notify reports providerConfigured:false when Twilio credentials are missing", async () => {
    const { accessToken, userId } = await registerUserWithContact();
    createdUserIds.push(userId);

    const savedSid = process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_ACCOUNT_SID;

    try {
      const created = await request(app)
        .post("/api/emergency")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ latitude: 40, longitude: -73 });

      const res = await request(app)
        .post(`/api/emergency/${created.body.id}/notify`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.providerConfigured).toBe(false);
    } finally {
      process.env.TWILIO_ACCOUNT_SID = savedSid;
    }
  });

  test("PATCH persists audioUrl/videoUrl as a signed download URL and rejects other users", async () => {
    const owner = await registerUserWithContact();
    const attacker = await registerUserWithContact();
    createdUserIds.push(owner.userId, attacker.userId);

    const created = await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const fakeKey = `${owner.userId}/fake-recording.m4a`;
    const patch = await request(app)
      .patch(`/api/emergency/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ audioUrl: fakeKey });

    expect(patch.status).toBe(200);
    expect(patch.body.audioUrl).toEqual(expect.stringContaining("/api/recordings/file/"));
    expect(patch.body.audioUrl).toEqual(expect.stringContaining(encodeURIComponent(fakeKey)));

    const attackerPatch = await request(app)
      .patch(`/api/emergency/${created.body.id}`)
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({ audioUrl: "hijacked/key.m4a" });
    expect(attackerPatch.status).toBe(404);
  });
});
