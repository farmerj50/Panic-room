const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup, safeDecrypt } = require("../services/cryptoService");
const { checkStorageDurability } = require("../services/storageService");

let userIds = [];

async function makeUser() {
  const email = `loc_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), nameEncrypted: encrypt("Alex"), passwordHash: "unused" },
  });
  userIds.push(user.id);
  return { userId: user.id, token: jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" }) };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function activate(token) {
  const res = await request(app).post("/api/emergency").set(auth(token)).send({ latitude: 40, longitude: -74 });
  return res.body.id;
}

const post = (token, id, body) => request(app).post(`/api/emergency/${id}/locations`).set(auth(token)).send(body);
const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("live GPS points", () => {
  test("stores an encrypted point and throttles live points to one per 10s", async () => {
    const { token } = await makeUser();
    const id = await activate(token);

    const first = await post(token, id, { latitude: 40.1, longitude: -74.1, accuracy: 8, recordedAt: at(0) });
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(1);

    const tooSoon = await post(token, id, { latitude: 40.2, longitude: -74.2, recordedAt: at(4000) });
    expect(tooSoon.status).toBe(202);
    expect(tooSoon.body.ignored).toBe(1);

    const later = await post(token, id, { latitude: 40.3, longitude: -74.3, recordedAt: at(12000) });
    expect(later.status).toBe(201);

    const rows = await prisma.emergencyLocation.findMany({ where: { emergencyId: id }, orderBy: { recordedAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].latitudeEncrypted).not.toContain("40.1");
    expect(Number(safeDecrypt(rows[0].latitudeEncrypted))).toBe(40.1);
    expect(rows[0].accuracy).toBe(8);
  });

  test("rejects invalid coordinates, empty or oversized batches, and other users' emergencies", async () => {
    const { token } = await makeUser();
    const id = await activate(token);
    expect((await post(token, id, { latitude: 91, longitude: 0, recordedAt: at(0) })).status).toBe(400);
    expect((await post(token, id, { latitude: 0, longitude: -181, recordedAt: at(0) })).status).toBe(400);
    expect((await post(token, id, { latitude: 0, longitude: 0, recordedAt: "not a date" })).status).toBe(400);
    expect((await post(token, id, { latitude: 0, longitude: 0 })).status).toBe(400);
    expect((await post(token, id, { points: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ latitude: 1, longitude: 1, recordedAt: at(i * 1000) }));
    expect((await post(token, id, { points: tooMany })).status).toBe(400);

    const stranger = await makeUser();
    expect((await post(stranger.token, id, { latitude: 1, longitude: 1, recordedAt: at(0) })).status).toBe(404);
  });
});

describe("offline GPS backfill", () => {
  test("a batch is stored in full, retries are idempotent, and thinned points are counted", async () => {
    const { token } = await makeUser();
    const id = await activate(token);
    const points = [0, 3000, 6000].map((ms, i) => ({ latitude: 41 + i / 100, longitude: -73, recordedAt: at(ms) }));

    const first = await post(token, id, { points, thinned: 4 });
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(3); // batches aren't throttled

    const retry = await post(token, id, { points, thinned: 0 });
    expect(retry.status).toBe(201);
    expect(retry.body.accepted).toBe(0);

    expect(await prisma.emergencyLocation.count({ where: { emergencyId: id } })).toBe(3);
    expect((await prisma.emergencyEvent.findUnique({ where: { id } })).locationsThinned).toBe(4);
  });

  test("after the emergency ends, only backfill inside its time window is accepted", async () => {
    const { token } = await makeUser();
    const id = await activate(token);
    await request(app).patch(`/api/emergency/${id}`).set(auth(token)).send({ status: "RESOLVED" });

    const live = await post(token, id, { latitude: 1, longitude: 1, recordedAt: at(0) });
    expect(live.status).toBe(409);

    const inside = await post(token, id, { points: [{ latitude: 1, longitude: 1, recordedAt: at(-1000) }] });
    expect(inside.status).toBe(201);
    expect(inside.body.accepted).toBe(1);

    const afterWindow = await post(token, id, { points: [{ latitude: 1, longitude: 1, recordedAt: at(10 * 60 * 1000) }] });
    expect(afterWindow.status).toBe(409);
    const beforeStart = await post(token, id, { points: [{ latitude: 1, longitude: 1, recordedAt: at(-60 * 60 * 1000) }] });
    expect(beforeStart.status).toBe(409);
  });
});

describe("emergency status", () => {
  test("only ACTIVE/RESOLVED are accepted, RESOLVED sets endedAt once, and resolved can't reopen", async () => {
    const { token } = await makeUser();
    const id = await activate(token);
    const patch = (body) => request(app).patch(`/api/emergency/${id}`).set(auth(token)).send(body);

    expect((await patch({ status: "WHATEVER" })).status).toBe(400);
    expect((await request(app).post("/api/emergency").set(auth(token)).send({ status: "nope" })).status).toBe(400);

    const resolved = await patch({ status: "RESOLVED" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.endedAt).toEqual(expect.any(String));

    const again = await patch({ status: "RESOLVED" });
    expect(again.body.endedAt).toBe(resolved.body.endedAt);

    expect((await patch({ status: "ACTIVE" })).status).toBe(409);
  });
});

describe("evidence storage durability check", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bes-storage-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("flags an unset STORAGE_DIR", () => {
    const result = checkStorageDurability({ env: {}, appDir: path.join(tmp, "app") });
    expect(result.durable).toBe(false);
    expect(result.problems.join(" ")).toMatch(/not set/);
  });

  test("flags a STORAGE_DIR inside the app directory (wiped on redeploy)", () => {
    const appDir = path.join(tmp, "app");
    const result = checkStorageDurability({ env: { STORAGE_DIR: path.join(appDir, "storage") }, appDir });
    expect(result.durable).toBe(false);
    expect(result.problems.join(" ")).toMatch(/inside the app directory/);
  });

  test("flags an unwritable STORAGE_DIR", () => {
    const file = path.join(tmp, "not-a-dir");
    fs.writeFileSync(file, "x");
    const result = checkStorageDurability({ env: { STORAGE_DIR: path.join(file, "sub") }, appDir: path.join(tmp, "app") });
    expect(result.durable).toBe(false);
    expect(result.problems.join(" ")).toMatch(/not writable/);
  });

  test("a mounted volume is durable and keeps the same volume id across boots", () => {
    const volume = path.join(tmp, "volume");
    const first = checkStorageDurability({ env: { STORAGE_DIR: volume }, appDir: path.join(tmp, "app") });
    const second = checkStorageDurability({ env: { STORAGE_DIR: volume }, appDir: path.join(tmp, "app") });
    expect(first.durable).toBe(true);
    expect(first.volumeId).toEqual(expect.any(String));
    expect(second.volumeId).toBe(first.volumeId);
  });
});
