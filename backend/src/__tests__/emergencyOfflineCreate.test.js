const crypto = require("crypto");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");

// Offline-first activation: the phone generates the emergency id and keeps
// recording against it until the server create finally succeeds.
let userIds = [];

async function makeUser() {
  const email = `off_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), nameEncrypted: encrypt("Alex"), passwordHash: "unused" },
  });
  userIds.push(user.id);
  return { userId: user.id, token: jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" }) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const create = (token, body) => request(app).post("/api/emergency").set(auth(token)).send(body);
const ago = (ms) => new Date(Date.now() - ms).toISOString();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("offline-first emergency create", () => {
  test("uses the phone's id, and a retry returns the same emergency instead of a second one", async () => {
    const { token, userId } = await makeUser();
    const id = crypto.randomUUID();
    const first = await create(token, { id, latitude: 40, longitude: -74 });
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(id);

    const retry = await create(token, { id, latitude: 40, longitude: -74 });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(id);
    expect(await prisma.emergencyEvent.count({ where: { userId } })).toBe(1);
  });

  test("racing retries of the same create still produce one emergency", async () => {
    const { token, userId } = await makeUser();
    const id = crypto.randomUUID();
    const results = await Promise.all([0, 1, 2, 3].map(() => create(token, { id })));
    expect(results.every((r) => [200, 201].includes(r.status) && r.body.id === id)).toBe(true);
    expect(await prisma.emergencyEvent.count({ where: { userId } })).toBe(1);
  });

  test("an id that belongs to someone else is refused; malformed ids are rejected", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = crypto.randomUUID();
    expect((await create(owner.token, { id })).status).toBe(201);
    expect((await create(stranger.token, { id })).status).toBe(409);
    expect((await create(owner.token, { id: "not-a-uuid" })).status).toBe(400);
    expect((await create(owner.token, { id: 12345 })).status).toBe(400);
  });

  test("records when it was really activated, so GPS recorded offline is accepted", async () => {
    const { token } = await makeUser();
    const id = crypto.randomUUID();
    const activatedAt = ago(20 * 60 * 1000); // 20 minutes without signal
    const res = await create(token, { id, activatedAt });
    expect(res.status).toBe(201);
    expect(new Date(res.body.createdAt).toISOString()).toBe(activatedAt);

    const points = [18, 15, 10].map((min, i) => ({ latitude: 40 + i / 100, longitude: -74, recordedAt: ago(min * 60 * 1000) }));
    const backfill = await request(app).post(`/api/emergency/${id}/locations`).set(auth(token)).send({ points });
    expect(backfill.status).toBe(201);
    expect(backfill.body.accepted).toBe(3);
  });

  test("an emergency that already ended offline is created resolved, with its real end time", async () => {
    const { token } = await makeUser();
    const id = crypto.randomUUID();
    const activatedAt = ago(30 * 60 * 1000);
    const endedAt = ago(25 * 60 * 1000);
    const res = await create(token, { id, activatedAt, status: "RESOLVED", endedAt });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("RESOLVED");
    expect(new Date(res.body.endedAt).toISOString()).toBe(endedAt);

    // Backfill inside that window is accepted (it ended before the upload).
    const inside = await request(app)
      .post(`/api/emergency/${id}/locations`)
      .set(auth(token))
      .send({ points: [{ latitude: 1, longitude: 1, recordedAt: ago(27 * 60 * 1000) }] });
    expect(inside.status).toBe(201);
  });

  test("implausible times fall back to now", async () => {
    const { token } = await makeUser();
    const future = await create(token, { id: crypto.randomUUID(), activatedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(Math.abs(new Date(future.body.createdAt).getTime() - Date.now())).toBeLessThan(60 * 1000);
    const ancient = await create(token, { id: crypto.randomUUID(), activatedAt: ago(30 * 24 * 60 * 60 * 1000) });
    expect(Math.abs(new Date(ancient.body.createdAt).getTime() - Date.now())).toBeLessThan(60 * 1000);
    const endsBeforeStart = await create(token, { id: crypto.randomUUID(), activatedAt: ago(60_000), status: "RESOLVED", endedAt: ago(120_000) });
    expect(new Date(endsBeforeStart.body.endedAt).getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
  });

  test("creating without an id still works exactly as before", async () => {
    const { token } = await makeUser();
    const res = await create(token, { latitude: 40, longitude: -74, status: "ACTIVE" });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
