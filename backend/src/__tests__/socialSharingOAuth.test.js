const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const { signState, verifyState } = require("../services/oauthStateService");
const storageService = require("../services/storageService");

jest.mock("../services/tiktokClient");
jest.mock("../services/instagramClient");
const tiktokClient = require("../services/tiktokClient");
const instagramClient = require("../services/instagramClient");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

// Users are created directly via Prisma, with access tokens minted the same
// way authController's signAccessToken() does — same approach and reason as
// accountLinks.test.js: going through POST /api/auth/register for every
// user here would exhaust the shared, process-wide authLimiter budget.
async function registerUser() {
  const email = uniqueEmail();
  const user = await prisma.user.create({
    data: {
      emailHash: hashLookup(email),
      emailEncrypted: encrypt(email),
      nameEncrypted: encrypt("OAuth Test User"),
      passwordHash: "unused-in-these-tests",
    },
  });
  const accessToken = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" });
  return { accessToken, userId: user.id, email };
}

async function deleteUser(userId) {
  await prisma.emergencyVideoSegment.deleteMany({ where: { emergency: { userId } } });
  await prisma.emergencyEvent.deleteMany({ where: { userId } });
  await prisma.socialConnection.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  storageService.deleteUserFiles(userId);
}

// TIKTOK_* / META_* are unset in .env.test (Phase A relies on that to
// assert `available: false`) — toggle them only inside the tests that need
// a "configured" provider, and always restore afterward so other test
// files in this --runInBand run never see a provider as configured when
// they don't expect it.
const CONFIG_KEYS = [
  "TIKTOK_CLIENT_ID",
  "TIKTOK_CLIENT_SECRET",
  "TIKTOK_REDIRECT_URI",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_LOGIN_CONFIG_ID",
  "INSTAGRAM_REDIRECT_URI",
];
const savedEnv = {};

function setTikTokConfigured() {
  process.env.TIKTOK_CLIENT_ID = "test_client_id";
  process.env.TIKTOK_CLIENT_SECRET = "test_client_secret";
  process.env.TIKTOK_REDIRECT_URI = "https://example.com/api/social/tiktok/callback";
}

function setInstagramConfigured() {
  process.env.META_APP_ID = "test_app_id";
  process.env.META_APP_SECRET = "test_app_secret";
  process.env.META_LOGIN_CONFIG_ID = "test_config_id";
  process.env.INSTAGRAM_REDIRECT_URI = "https://example.com/api/social/instagram/callback";
}

describe("social sharing OAuth (Phase B)", () => {
  const createdUserIds = [];

  beforeAll(() => {
    CONFIG_KEYS.forEach((key) => {
      savedEnv[key] = process.env[key];
    });
  });

  afterEach(() => {
    CONFIG_KEYS.forEach((key) => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  describe("oauthStateService", () => {
    test("sign/verify round-trip succeeds for the matching provider", () => {
      const state = signState({ userId: "user-1", provider: "tiktok" });
      expect(verifyState(state, "tiktok")).toEqual({ userId: "user-1", provider: "tiktok" });
    });

    test("rejects a tampered state", () => {
      const state = signState({ userId: "user-1", provider: "tiktok" });
      const tampered = state.slice(0, -2) + "zz";
      expect(verifyState(tampered, "tiktok")).toBeNull();
    });

    test("rejects a state issued for a different provider", () => {
      const state = signState({ userId: "user-1", provider: "tiktok" });
      expect(verifyState(state, "instagram")).toBeNull();
    });

    test("rejects an expired state", () => {
      jest.useFakeTimers().setSystemTime(Date.now());
      const state = signState({ userId: "user-1", provider: "tiktok" });
      jest.setSystemTime(Date.now() + 11 * 60 * 1000); // past the 10-minute TTL
      expect(verifyState(state, "tiktok")).toBeNull();
      jest.useRealTimers();
    });
  });

  describe("initiateConnect", () => {
    test("503s with the stable code when unconfigured", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);

      const res = await request(app)
        .post("/api/social/tiktok/connect")
        .set("Authorization", `Bearer ${accessToken}`);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("social_sharing_not_configured");
    });

    test("returns a real authorization URL carrying a verifiable state once configured", async () => {
      setTikTokConfigured();
      tiktokClient.buildAuthorizationUrl.mockImplementation((state) => `https://tiktok.example/auth?state=${state}`);

      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);

      const res = await request(app)
        .post("/api/social/tiktok/connect")
        .set("Authorization", `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.authorizationUrl).toMatch(/^https:\/\/tiktok\.example\/auth\?state=/);

      const state = new URL(res.body.authorizationUrl).searchParams.get("state");
      expect(verifyState(state, "tiktok")).toMatchObject({ userId });
    });
  });

  describe("GET /api/social/:provider/callback", () => {
    test("redirects to status=error and creates no row when state is invalid", async () => {
      const res = await request(app).get("/api/social/tiktok/callback").query({ code: "abc", state: "garbage" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^bes:\/\/social-callback\?status=error&provider=tiktok/);
    });

    test("redirects to status=error when the provider reports an error", async () => {
      const res = await request(app).get("/api/social/tiktok/callback").query({ error: "access_denied" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^bes:\/\/social-callback\?status=error&provider=tiktok&reason=access_denied/);
    });

    test("valid state + successful token exchange creates a connected row and redirects to status=connected", async () => {
      setTikTokConfigured();
      const { userId } = await registerUser();
      createdUserIds.push(userId);

      tiktokClient.exchangeCodeForToken.mockResolvedValue({
        access_token: "tt_access",
        refresh_token: "tt_refresh",
        expires_in: 86400,
      });
      tiktokClient.fetchProfile.mockResolvedValue({ providerUserId: "tt_open_id", username: "tiktok_user" });

      const state = signState({ userId, provider: "tiktok" });
      const res = await request(app).get("/api/social/tiktok/callback").query({ code: "real_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("bes://social-callback?status=connected&provider=tiktok");

      const row = await prisma.socialConnection.findUnique({
        where: { userId_provider: { userId, provider: "tiktok" } },
      });
      expect(row.status).toBe("connected");
      expect(row.providerUsername).toBe("tiktok_user");
      expect(row.accessTokenEncrypted).not.toBe("tt_access"); // stored encrypted, not raw
    });

    test("instagram: valid state + mocked exchange/discovery creates a connected row with the resolved IG user id", async () => {
      setInstagramConfigured();
      const { userId } = await registerUser();
      createdUserIds.push(userId);

      instagramClient.exchangeCodeForToken.mockResolvedValue({ access_token: "ig_short", expires_in: 3600 });
      instagramClient.exchangeForLongLivedToken.mockResolvedValue({
        accessToken: "ig_user_long",
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });
      instagramClient.resolveInstagramBusinessAccount.mockResolvedValue({
        igUserId: "ig_user_1",
        pageAccessToken: "ig_page_token",
      });
      instagramClient.fetchProfile.mockResolvedValue({ providerUserId: "ig_user_1", username: "ig_handle" });

      const state = signState({ userId, provider: "instagram" });
      const res = await request(app).get("/api/social/instagram/callback").query({ code: "real_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("bes://social-callback?status=connected&provider=instagram");

      const row = await prisma.socialConnection.findUnique({
        where: { userId_provider: { userId, provider: "instagram" } },
      });
      expect(row.status).toBe("connected");
      expect(row.providerUserId).toBe("ig_user_1");
      expect(row.providerUsername).toBe("ig_handle");
    });

    test("redirects to status=error (not a 500) when the token exchange throws", async () => {
      setTikTokConfigured();
      const { userId } = await registerUser();
      createdUserIds.push(userId);

      tiktokClient.exchangeCodeForToken.mockRejectedValue(new Error("boom"));

      const state = signState({ userId, provider: "tiktok" });
      const res = await request(app).get("/api/social/tiktok/callback").query({ code: "real_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("bes://social-callback?status=error&provider=tiktok&reason=connect_failed");

      const row = await prisma.socialConnection.findUnique({
        where: { userId_provider: { userId, provider: "tiktok" } },
      });
      expect(row).toBeNull();
    });
  });

  describe("POST /api/social/:provider/share", () => {
    async function seedEmergencyWithVideo(userId) {
      const key = storageService.saveFile({ userId, buffer: Buffer.from("fake video bytes"), ext: "mp4" });
      const emergency = await prisma.emergencyEvent.create({ data: { userId, status: "ACTIVE" } });
      await prisma.emergencyVideoSegment.create({
        data: {
          emergencyId: emergency.id,
          fileUrl: encrypt(key),
          facing: "back",
          sequence: 1,
          startedAt: new Date(),
        },
      });
      return emergency.id;
    }

    test("400s when not connected to the provider", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("not_connected");
    });

    test("400s when the provider is disabled for emergency sharing", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);

      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "tiktok",
          status: "connected",
          enabledForEmergency: false,
          accessTokenEncrypted: encrypt("tok"),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("disabled_for_emergency");
    });

    test("posts successfully on the happy path with a mocked provider client", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);

      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "tiktok",
          status: "connected",
          enabledForEmergency: true,
          accessTokenEncrypted: encrypt("tt_access"),
          refreshTokenEncrypted: encrypt("tt_refresh"),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
      tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "tiktok", status: "posted", privacyLevel: "SELF_ONLY" });
      expect(tiktokClient.publishVideoFile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "tt_access" }),
      );
    });

    test("returns status: failed (not a 500) when the provider client throws", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);

      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "tiktok",
          status: "connected",
          enabledForEmergency: true,
          accessTokenEncrypted: encrypt("tt_access"),
          refreshTokenEncrypted: encrypt("tt_refresh"),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      tiktokClient.publishVideoFile.mockRejectedValue(new Error("upstream down"));

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "tiktok", status: "failed", error: "Could not post right now." });
    });

    test("instagram happy path uses the signed download URL and the stored IG user id", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);

      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "instagram",
          status: "connected",
          enabledForEmergency: true,
          providerUserId: "ig_user_1",
          accessTokenEncrypted: encrypt("ig_page_token"),
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        },
      });

      instagramClient.publishReelFromUrl.mockResolvedValue({ status: "posted", mediaId: "media_1" });

      const res = await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "instagram", status: "posted", privacyLevel: "PUBLIC" });
      expect(instagramClient.publishReelFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({ igUserId: "ig_user_1", pageAccessToken: "ig_page_token" }),
      );
      const [[call]] = instagramClient.publishReelFromUrl.mock.calls;
      expect(call.videoUrl).toMatch(/^http.*\/api\/recordings\/file\//);
    });

    async function connectTikTok(userId) {
      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "tiktok",
          status: "connected",
          enabledForEmergency: true,
          accessTokenEncrypted: encrypt("tt_access"),
          refreshTokenEncrypted: encrypt("tt_refresh"),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    }

    async function connectInstagram(userId) {
      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "instagram",
          status: "connected",
          enabledForEmergency: true,
          providerUserId: "ig_user_1",
          accessTokenEncrypted: encrypt("ig_page_token"),
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        },
      });
    }

    test("tiktok: an allowed privacyLevel passes through, and the caption is sent as the title", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectTikTok(userId);

      tiktokClient.fetchCreatorInfo.mockResolvedValue({
        privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      });
      tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
      tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1, privacyLevel: "PUBLIC_TO_EVERYONE", caption: "  Help, I am being followed  " });

      expect(res.body).toEqual({ provider: "tiktok", status: "posted", privacyLevel: "PUBLIC_TO_EVERYONE" });
      expect(tiktokClient.publishVideoFile).toHaveBeenCalledWith(
        expect.objectContaining({ privacyLevel: "PUBLIC_TO_EVERYONE", title: "Help, I am being followed" }),
      );
    });

    test("tiktok: an unknown or not-allowed privacyLevel falls back to SELF_ONLY", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectTikTok(userId);

      // Unaudited app: TikTok only allows SELF_ONLY, so a public request must not get through.
      tiktokClient.fetchCreatorInfo.mockResolvedValue({ privacyLevelOptions: ["SELF_ONLY"] });
      tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
      tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");

      for (const privacyLevel of ["PUBLIC_TO_EVERYONE", "PUBLIC", "nonsense", undefined]) {
        const res = await request(app)
          .post("/api/social/tiktok/share")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ emergencyId, sequence: 1, privacyLevel });
        expect(res.body.privacyLevel).toBe("SELF_ONLY");
      }
      expect(tiktokClient.publishVideoFile).toHaveBeenCalledTimes(4);
      tiktokClient.publishVideoFile.mock.calls.forEach(([call]) => {
        expect(call.privacyLevel).toBe("SELF_ONLY");
      });
    });

    test("tiktok: creator_info failing at post time still posts as SELF_ONLY", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectTikTok(userId);

      tiktokClient.fetchCreatorInfo.mockRejectedValue(new Error("creator_info down"));
      tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
      tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");

      const res = await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1, privacyLevel: "PUBLIC_TO_EVERYONE" });

      expect(res.body).toEqual({ provider: "tiktok", status: "posted", privacyLevel: "SELF_ONLY" });
      expect(tiktokClient.publishVideoFile).toHaveBeenCalledWith(expect.objectContaining({ privacyLevel: "SELF_ONLY" }));
    });

    test("instagram: an unknown privacyLevel falls back to PUBLIC (not SELF_ONLY), and the caption is passed through", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectInstagram(userId);

      instagramClient.publishReelFromUrl.mockResolvedValue({ status: "posted", mediaId: "media_1" });

      const res = await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1, privacyLevel: "SELF_ONLY", caption: "Recording live" });

      expect(res.body).toEqual({ provider: "instagram", status: "posted", privacyLevel: "PUBLIC" });
      expect(instagramClient.publishReelFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "Recording live" }),
      );
    });

    test("a sequence pins the exact segment that was previewed, not the newest one", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectInstagram(userId);
      const newerKey = storageService.saveFile({ userId, buffer: Buffer.from("newer bytes"), ext: "mp4" });
      await prisma.emergencyVideoSegment.create({
        data: { emergencyId, fileUrl: encrypt(newerKey), facing: "front", sequence: 2, startedAt: new Date() },
      });

      instagramClient.publishReelFromUrl.mockResolvedValue({ status: "posted", mediaId: "media_1" });

      // Reviewed clip 1 while clip 2 finished uploading → clip 1 is posted.
      await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });
      await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 2 });

      const [[pinned], [second]] = instagramClient.publishReelFromUrl.mock.calls;
      expect(pinned.videoUrl).not.toContain(encodeURIComponent(newerKey));
      expect(second.videoUrl).toContain(`/file/${encodeURIComponent(newerKey)}?`);

      // No independent "newest" selection: a missing or malformed sequence is rejected.
      for (const body of [{ emergencyId }, { emergencyId, sequence: "2" }, { emergencyId, sequence: 0 }]) {
        const rejected = await request(app)
          .post("/api/social/instagram/share")
          .set("Authorization", `Bearer ${accessToken}`)
          .send(body);
        expect(rejected.status).toBe(400);
        expect(rejected.body.code).toBe("invalid_segment");
      }
      expect(instagramClient.publishReelFromUrl).toHaveBeenCalledTimes(2);

      const missing = await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 99 });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe("no_video");
    });

    test("a segment is only reachable through an emergency this user owns", async () => {
      const owner = await registerUser();
      const other = await registerUser();
      createdUserIds.push(owner.userId, other.userId);
      const ownersEmergencyId = await seedEmergencyWithVideo(owner.userId);
      await connectInstagram(other.userId);

      const res = await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${other.accessToken}`)
        .send({ emergencyId: ownersEmergencyId, sequence: 1 });

      expect(res.status).toBe(404);
      expect(instagramClient.publishReelFromUrl).not.toHaveBeenCalled();
    });

    test("an empty caption falls back to the default for both providers", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      const emergencyId = await seedEmergencyWithVideo(userId);
      await connectTikTok(userId);
      await connectInstagram(userId);

      tiktokClient.fetchCreatorInfo.mockResolvedValue({ privacyLevelOptions: ["SELF_ONLY"] });
      tiktokClient.publishVideoFile.mockResolvedValue({ publishId: "pub_1" });
      tiktokClient.pollPublishStatus.mockResolvedValue("PUBLISH_COMPLETE");
      instagramClient.publishReelFromUrl.mockResolvedValue({ status: "posted", mediaId: "media_1" });

      await request(app)
        .post("/api/social/tiktok/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1, caption: "   " });
      await request(app)
        .post("/api/social/instagram/share")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ emergencyId, sequence: 1 });

      expect(tiktokClient.publishVideoFile).toHaveBeenCalledWith(expect.objectContaining({ title: "Shared from Bes" }));
      expect(instagramClient.publishReelFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "Shared from Bes" }),
      );
    });
  });

  describe("GET /api/social/:provider/publish-options", () => {
    async function connectTikTok(userId) {
      await prisma.socialConnection.create({
        data: {
          userId,
          provider: "tiktok",
          status: "connected",
          enabledForEmergency: true,
          accessTokenEncrypted: encrypt("tt_access"),
          refreshTokenEncrypted: encrypt("tt_refresh"),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    }

    test("tiktok returns the levels TikTok's creator_info reports", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      await connectTikTok(userId);
      tiktokClient.fetchCreatorInfo.mockResolvedValue({ privacyLevelOptions: ["SELF_ONLY"] });

      const res = await request(app)
        .get("/api/social/tiktok/publish-options")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "tiktok", privacyLevels: ["SELF_ONLY"] });
      expect(tiktokClient.fetchCreatorInfo).toHaveBeenCalledWith("tt_access");
    });

    test("tiktok falls back to SELF_ONLY when creator_info throws", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);
      await connectTikTok(userId);
      tiktokClient.fetchCreatorInfo.mockRejectedValue(new Error("upstream down"));

      const res = await request(app)
        .get("/api/social/tiktok/publish-options")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "tiktok", privacyLevels: ["SELF_ONLY"] });
    });

    test("tiktok 400s when not connected", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);

      const res = await request(app)
        .get("/api/social/tiktok/publish-options")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("not_connected");
    });

    test("instagram always returns PUBLIC", async () => {
      const { accessToken, userId } = await registerUser();
      createdUserIds.push(userId);

      const res = await request(app)
        .get("/api/social/instagram/publish-options")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: "instagram", privacyLevels: ["PUBLIC"] });
    });

    test("requires authentication", async () => {
      const res = await request(app).get("/api/social/tiktok/publish-options");
      expect(res.status).toBe(401);
    });
  });
});
