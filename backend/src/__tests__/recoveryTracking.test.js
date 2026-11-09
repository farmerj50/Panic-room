const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const { effectiveExpiry } = require("../services/liveViewService");

const userIds = [];

async function makeUser() {
  const email = `recov_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), nameEncrypted: encrypt("Alex Rivera"), passwordHash: "unused" },
  });
  userIds.push(user.id);
  return { userId: user.id, token: jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" }) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const MIN = 60 * 1000;

const consent = (token, enabled) => request(app).put("/api/emergency/recovery-consent").set(auth(token)).send({ enabled });
const activate = async (token) => (await request(app).post("/api/emergency").set(auth(token)).send({ latitude: 40, longitude: -74 })).body.id;
const resolve = (token, id, body = {}) =>
  request(app).patch(`/api/emergency/${id}`).set(auth(token)).send({ status: "RESOLVED", ...body });
const points = (token, id, list) => request(app).post(`/api/emergency/${id}/locations`).set(auth(token)).send({ points: list });
const live = (token, id, point) => request(app).post(`/api/emergency/${id}/locations`).set(auth(token)).send(point);
const pt = (offsetMs, extra = {}) => ({ latitude: 40.01, longitude: -74.01, accuracy: 8, recordedAt: at(offsetMs), ...extra });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("consent", () => {
  test("is off by default, recorded when turned on, cleared when turned off", async () => {
    const { token } = await makeUser();
    expect((await request(app).get("/api/emergency/recovery-consent").set(auth(token))).body.enabled).toBe(false);
    const on = await consent(token, true);
    expect(on.body).toMatchObject({ enabled: true });
    expect(on.body.consentedAt).toBeTruthy();
    expect((await consent(token, false)).body).toEqual({ enabled: false, consentedAt: null });
    expect((await consent(token, "yes")).status).toBe(400);
  });
});

describe("starting recovery tracking", () => {
  test("without consent, ending the SOS closes tracking as before", async () => {
    const { token } = await makeUser();
    const id = await activate(token);
    const res = await resolve(token, id, { recoveryTracking: true });
    expect(res.body.tracking).toEqual({ state: "CLOSED", recovery: null });
    expect((await live(token, id, pt(0))).status).toBe(409);
  });

  test("with consent, ending the SOS moves into RECOVERY_TRACKING for 72 hours and keeps accepting points", async () => {
    const { token } = await makeUser();
    await consent(token, true);
    const id = await activate(token);
    expect((await request(app).get(`/api/emergency/${id}/tracking`).set(auth(token))).body.state).toBe("SOS_ACTIVE");
    const res = await resolve(token, id, { recoveryTracking: true });
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.tracking.state).toBe("RECOVERY_TRACKING");
    const { startedAt, expiresAt } = res.body.tracking.recovery;
    expect(new Date(expiresAt) - new Date(startedAt)).toBe(72 * 60 * MIN);

    const ok = await points(token, id, [pt(1000, { batteryLevel: 64 }), pt(31_000)]);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ accepted: 2, tracking: { state: "RECOVERY_TRACKING" } });
    expect((await live(token, id, pt(61_000))).status).toBe(201);
    const stored = await prisma.emergencyLocation.findMany({ where: { emergencyId: id }, orderBy: { recordedAt: "asc" } });
    expect(stored[0].batteryLevel).toBe(64);
  });

  test("a resolved emergency can't be put into recovery tracking later, and it never restarts", async () => {
    const { token } = await makeUser();
    await consent(token, true);
    const plain = await activate(token);
    await resolve(token, plain);
    const again = await resolve(token, plain, { recoveryTracking: true });
    expect(again.body.tracking.state).toBe("CLOSED");

    const id = await activate(token);
    await resolve(token, id, { recoveryTracking: true });
    await request(app).post(`/api/emergency/${id}/recovery/stop`).set(auth(token)).send({ reason: "recovered" });
    const retry = await resolve(token, id, { recoveryTracking: true });
    expect(retry.body.tracking.state).toBe("CLOSED");
  });

  test("an SOS that ran offline arrives ended and starts tracking only if consent predates its end", async () => {
    const { token } = await makeUser();
    const before = await prisma.user.findUnique({ where: { id: userIds[userIds.length - 1] } });
    expect(before.recoveryTrackingConsentAt).toBeNull();
    await consent(token, true);
    const offline = (endedOffsetMs) =>
      request(app)
        .post("/api/emergency")
        .set(auth(token))
        .send({ activatedAt: at(-30 * MIN), endedAt: at(endedOffsetMs), status: "RESOLVED", recoveryTracking: true });
    // Ended 20 minutes ago — before consent was given just now.
    expect((await offline(-20 * MIN)).body.tracking.state).toBe("CLOSED");
    // Ended now (consent already on).
    expect((await offline(0)).body.tracking.state).toBe("RECOVERY_TRACKING");
  });
});

describe("stopping", () => {
  async function tracking() {
    const { token } = await makeUser();
    await consent(token, true);
    const id = await activate(token);
    await resolve(token, id, { recoveryTracking: true });
    return { token, id };
  }

  test("remote stop is final at once: later points are refused with TRACKING_STOPPED, earlier offline ones still land", async () => {
    const { token, id } = await tracking();
    const stop = await request(app).post(`/api/emergency/${id}/recovery/stop`).set(auth(token)).send({ reason: "remote_stop" });
    expect(stop.body).toMatchObject({ state: "CLOSED", recovery: { endReason: "remote_stop" } });

    const late = await points(token, id, [pt(60_000)]);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("TRACKING_STOPPED");
    expect((await live(token, id, pt(1000))).body.code).toBe("TRACKING_STOPPED");
    // Buffered while offline, recorded before the stop: kept.
    const backfill = await points(token, id, [pt(-2000), pt(120_000)]);
    expect(backfill.body).toMatchObject({ accepted: 1, tracking: { state: "CLOSED" } });
  });

  test("'Phone recovered' is recorded as recovered; stopping twice is harmless", async () => {
    const { token, id } = await tracking();
    await request(app).post(`/api/emergency/${id}/recovery/stop`).set(auth(token)).send({ reason: "recovered" });
    const second = await request(app).post(`/api/emergency/${id}/recovery/stop`).set(auth(token)).send({ reason: "remote_stop" });
    expect(second.body.recovery.endReason).toBe("recovered");
  });

  test("expires after 72 hours without anyone stopping it", async () => {
    const { token, id } = await tracking();
    await prisma.emergencyEvent.update({ where: { id }, data: { recoveryExpiresAt: new Date(Date.now() - 1000) } });
    const view = await request(app).get(`/api/emergency/${id}/tracking`).set(auth(token));
    expect(view.body).toMatchObject({ state: "CLOSED", recovery: { endReason: "expired" } });
    expect((await points(token, id, [pt(0)])).body.code).toBe("TRACKING_STOPPED");
  });

  test("turning the setting off ends tracking that is running", async () => {
    const { token, id } = await tracking();
    await consent(token, false);
    const view = await request(app).get(`/api/emergency/${id}/tracking`).set(auth(token));
    expect(view.body.recovery.endReason).toBe("consent_withdrawn");
  });

  test("another account can't read the route, check tracking, stop it or add points", async () => {
    const { id } = await tracking();
    const other = await makeUser();
    for (const res of [
      await request(app).get(`/api/emergency/${id}/route`).set(auth(other.token)),
      await request(app).get(`/api/emergency/${id}/tracking`).set(auth(other.token)),
      await request(app).post(`/api/emergency/${id}/recovery/stop`).set(auth(other.token)).send({}),
      await points(other.token, id, [pt(0)]),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await request(app).get(`/api/emergency/${id}/route`)).status).toBe(401);
  });
});

describe("route endpoint", () => {
  test("returns the trail, stops, latest point, battery and freshness", async () => {
    const { token } = await makeUser();
    const id = (await request(app).post("/api/emergency").set(auth(token)).send({ activatedAt: at(-25 * MIN) })).body.id;
    const M = 1 / 111_320;
    const list = [];
    // Drive 1 km over 2 minutes, park 5 minutes, then drive on.
    for (let i = 0; i <= 8; i += 1) list.push({ latitude: 40 + i * 125 * M, longitude: -74, recordedAt: at(-20 * MIN + i * 15_000) });
    for (let i = 1; i <= 5; i += 1) list.push({ latitude: 40 + 1000 * M + (i % 2) * 5 * M, longitude: -74, recordedAt: at(-18 * MIN + i * MIN) });
    list.push({ latitude: 40 + 1300 * M, longitude: -74, accuracy: 12, batteryLevel: 55, recordedAt: at(-12 * MIN) });
    expect((await points(token, id, list)).status).toBe(201);

    const route = (await request(app).get(`/api/emergency/${id}/route`).set(auth(token))).body;
    expect(route.tracking.state).toBe("SOS_ACTIVE");
    expect(route.points.length).toBe(list.length);
    expect(route.stops).toHaveLength(1);
    expect(route.stops[0].durationSeconds).toBeGreaterThanOrEqual(5 * 60);
    expect(route.latest).toMatchObject({ accuracy: 12, batteryLevel: 55 });
    expect(route.batteryLevel).toBe(55);
    // Last point is 12 minutes old while the SOS is active: not shown as live.
    expect(route.freshness.status).toBe("stale");
  });
});

describe("Live View links during recovery tracking", () => {
  const created = Date.now() - 2 * 60 * MIN;
  const link = { hardExpiresAt: new Date(created + 72 * 60 * MIN) };
  const endedAt = new Date(created + 60 * MIN);

  test("an emergency without recovery tracking keeps the 24h-after-end rule", () => {
    expect(effectiveExpiry(link, { endedAt })).toBe(endedAt.getTime() + 24 * 60 * MIN);
  });

  test("while tracking runs the link lives until tracking expires; afterwards 24h from its end", () => {
    const recoveryExpiresAt = new Date(endedAt.getTime() + 72 * 60 * MIN);
    const running = { endedAt, recoveryStatus: "RECOVERY_TRACKING", recoveryExpiresAt };
    expect(effectiveExpiry(link, running)).toBe(recoveryExpiresAt.getTime());
    const recoveryEndedAt = new Date(endedAt.getTime() + 10 * 60 * MIN);
    const ended = { ...running, recoveryStatus: "ENDED", recoveryEndedAt };
    expect(effectiveExpiry(link, ended)).toBe(recoveryEndedAt.getTime() + 24 * 60 * MIN);
  });
});
