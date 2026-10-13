const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const storageService = require("../services/storageService");

jest.mock("../services/tiktokClient");
jest.mock("../services/instagramClient");
const tiktokClient = require("../services/tiktokClient");
const instagramClient = require("../services/instagramClient");
const { TikTokProviderError } = jest.requireActual("../services/tiktokClient");
const { InstagramProviderError } = jest.requireActual("../services/instagramClient");

const userIds = [];

async function makeUser() {
  const email = `share_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), nameEncrypted: encrypt("Share Test"), passwordHash: "unused" },
  });
  userIds.push(user.id);
  return { userId: user.id, token: jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" }) };
}

async function seed(provider = "tiktok") {
  const { userId, token } = await makeUser();
  const key = storageService.saveFile({ userId, buffer: Buffer.from("fake video bytes"), ext: "mp4" });
  const emergency = await prisma.emergencyEvent.create({ data: { userId, status: "ACTIVE" } });
  await prisma.emergencyVideoSegment.create({
    data: { emergencyId: emergency.id, fileUrl: encrypt(key), facing: "back", sequence: 1, startedAt: new Date() },
  });
  await prisma.emergencyLocation.create({
    data: { emergencyId: emergency.id, latitudeEncrypted: encrypt(1), longitudeEncrypted: encrypt(2), recordedAt: new Date() },
  });
  const connection = await prisma.socialConnection.create({
    data: {
      userId,
      provider,
      status: "connected",
      enabledForEmergency: true,
      providerUserId: "ig_1",
      accessTokenEncrypted: encrypt("access"),
      refreshTokenEncrypted: encrypt("refresh"),
      // Well outside both providers' refresh windows (Meta long-lived tokens last ~60 days).
      expiresAt: new Date(Date.now() + 50 * 86400000),
    },
  });
  return { userId, token, emergencyId: emergency.id, connectionId: connection.id };
}

const share = (ctx, provider, body = {}) =>
  request(app)
    .post(`/api/social/${provider}/share`)
    .set("Authorization", `Bearer ${ctx.token}`)
    .send({ emergencyId: ctx.emergencyId, sequence: 1, ...body });

function authError(message) {
  const error = new Error(message);
  error.authError = true;
  return error;
}

beforeEach(() => {
  jest.resetAllMocks();
  tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  for (const id of userIds) storageService.deleteUserFiles(id);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("provider error classification", () => {
  test("TikTok: revoked/expired authorization is an auth error; other failures are not", () => {
    expect(new TikTokProviderError("x", { code: "invalid_grant" }).authError).toBe(true);
    expect(new TikTokProviderError("x", { code: "access_token_invalid" }).authError).toBe(true);
    expect(new TikTokProviderError("x", { status: 401 }).authError).toBe(true);
    expect(new TikTokProviderError("x", { status: 500, code: "internal_error" }).authError).toBe(false);
    expect(new TikTokProviderError("x").authError).toBe(false);
  });

  test("Instagram: OAuthException code 190 or 401 is an auth error", () => {
    expect(new InstagramProviderError("x", { code: 190 }).authError).toBe(true);
    expect(new InstagramProviderError("x", { status: 401 }).authError).toBe(true);
    expect(new InstagramProviderError("x", { status: 400, code: 100 }).authError).toBe(false);
  });
});

describe("expired or revoked authorization", () => {
  test("TikTok refresh rejected → reconnect message, connection marked reauth_required", async () => {
    const ctx = await seed("tiktok");
    await prisma.socialConnection.update({ where: { id: ctx.connectionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    tiktokClient.refreshAccessToken.mockRejectedValue(authError("TikTok token refresh failed: invalid_grant"));

    const res = await share(ctx, "tiktok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: "failed", code: "reauth_required" }));
    expect(res.body.error).toMatch(/Reconnect TikTok/);
    expect(tiktokClient.publishVideoFile).not.toHaveBeenCalled();
    expect((await prisma.socialConnection.findUnique({ where: { id: ctx.connectionId } })).status).toBe("reauth_required");

    // Listed as needing reconnection, so the app stops offering it.
    const list = await request(app).get("/api/social").set("Authorization", `Bearer ${ctx.token}`);
    expect(list.body.connections.find((c) => c.provider === "tiktok").status).toBe("reauth_required");
  });

  test("Instagram token rejected at publish (code 190) → reconnect message", async () => {
    const ctx = await seed("instagram");
    instagramClient.publishReelFromUrl.mockRejectedValue(authError("Instagram API error: Error validating access token"));
    const res = await share(ctx, "instagram");
    expect(res.body).toEqual(expect.objectContaining({ status: "failed", code: "reauth_required" }));
    expect(res.body.error).toMatch(/Reconnect Instagram/);
  });

  test("an ordinary provider failure keeps the connection and the generic message", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockRejectedValue(new Error("upstream down"));
    const res = await share(ctx, "tiktok");
    expect(res.body).toEqual({ provider: "tiktok", status: "failed", error: "Could not post right now." });
    expect((await prisma.socialConnection.findUnique({ where: { id: ctx.connectionId } })).status).toBe("connected");
  });

  test("a failed share never touches the emergency, its clips or its GPS history", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockRejectedValue(new Error("upstream down"));
    await share(ctx, "tiktok");
    const emergency = await prisma.emergencyEvent.findUnique({
      where: { id: ctx.emergencyId },
      include: { videoSegments: true, locations: true },
    });
    expect(emergency.status).toBe("ACTIVE");
    expect(emergency.videoSegments).toHaveLength(1);
    expect(emergency.locations).toHaveLength(1);
  });
});

describe("no duplicate publishing", () => {
  test("two concurrent requests with the same requestId publish exactly once", async () => {
    const ctx = await seed("tiktok");
    let release;
    tiktokClient.publishVideoFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ publishId: "pub_1" });
        }),
    );
    const first = share(ctx, "tiktok", { requestId: "req-1" }).then((r) => r);
    // Wait until the first request has claimed the id and is publishing.
    for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 20));
    const second = await share(ctx, "tiktok", { requestId: "req-1" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("share_in_progress");
    release();
    const firstRes = await first;
    expect(firstRes.body.status).toBe("posted");
    expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(1);
  });

  test("a repeat after completion returns the stored result without publishing again", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
    const first = await share(ctx, "tiktok", { requestId: "req-2" });
    const repeat = await share(ctx, "tiktok", { requestId: "req-2" });
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);
    expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(1);
  });

  test("a new deliberate share (new requestId) publishes again", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
    await share(ctx, "tiktok", { requestId: "req-3" });
    await share(ctx, "tiktok", { requestId: "req-4" });
    expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(2);
  });

  test("requests without a requestId (older app builds) behave as before", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
    await share(ctx, "tiktok");
    await share(ctx, "tiktok");
    expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(2);
    expect(await prisma.socialShareRequest.count({ where: { userId: ctx.userId } })).toBe(0);
  });

  test("validation failures don't consume the requestId", async () => {
    const ctx = await seed("tiktok");
    tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
    const missing = await share(ctx, "tiktok", { requestId: "req-5", sequence: 9 });
    expect(missing.body.code).toBe("no_video");
    const ok = await share(ctx, "tiktok", { requestId: "req-5" });
    expect(ok.body.status).toBe("posted");
  });

  test("request ids are scoped per user", async () => {
    const a = await seed("tiktok");
    const b = await seed("tiktok");
    tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
    await share(a, "tiktok", { requestId: "same" });
    const other = await share(b, "tiktok", { requestId: "same" });
    expect(other.body.status).toBe("posted");
    expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(2);
  });
});
