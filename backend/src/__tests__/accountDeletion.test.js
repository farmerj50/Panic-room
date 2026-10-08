const fs = require("fs");
const path = require("path");

const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");
const { STORAGE_DIR } = require("../services/storageService");
const { encrypt } = require("../services/cryptoService");

jest.mock("../services/tiktokClient");
const tiktokClient = require("../services/tiktokClient");

const TIKTOK_KEYS = ["TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"];

async function seedSocialConnections(userId) {
  const base = { userId, status: "connected", enabledForEmergency: true, expiresAt: new Date(Date.now() + 86400000) };
  await prisma.socialConnection.create({
    data: {
      ...base,
      provider: "tiktok",
      accessTokenEncrypted: encrypt("tt_access_secret"),
      refreshTokenEncrypted: encrypt("tt_refresh_secret"),
    },
  });
  await prisma.socialConnection.create({
    data: { ...base, provider: "instagram", providerUserId: "ig_1", accessTokenEncrypted: encrypt("ig_page_secret") },
  });
}

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";

async function registerUser(email = uniqueEmail()) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Deletion Test User" });
  return { email, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id };
}

describe("account deletion", () => {
  const createdUserIds = [];
  const savedEnv = {};

  beforeAll(() => {
    TIKTOK_KEYS.forEach((key) => {
      savedEnv[key] = process.env[key];
    });
  });

  afterEach(() => {
    TIKTOK_KEYS.forEach((key) => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
    jest.resetAllMocks();
  });

  function setTikTokConfigured() {
    process.env.TIKTOK_CLIENT_ID = "test_client_id";
    process.env.TIKTOK_CLIENT_SECRET = "test_client_secret";
    process.env.TIKTOK_REDIRECT_URI = "https://example.com/api/social/tiktok/callback";
  }

  afterAll(async () => {
    // Best-effort cleanup for any test that failed before deleting itself.
    await Promise.all(
      createdUserIds.map((id) =>
        prisma.user.delete({ where: { id } }).catch(() => {}),
      ),
    );
    await prisma.$disconnect();
  });

  test("requires authentication", async () => {
    const res = await request(app).delete("/api/users/me").send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  test("requires a password in the body", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test("rejects an incorrect password without deleting anything", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "wrong-password-entirely" });
    expect(res.status).toBe(401);

    const stillExists = await prisma.user.findUnique({ where: { id: userId } });
    expect(stillExists).not.toBeNull();
  });

  test("deletes the account, cascades related records, revokes sessions, and cleans up storage files", async () => {
    const { accessToken, refreshToken, userId, email } = await registerUser();

    // Create related records across every table that should cascade.
    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Some Contact", phoneNumber: "+15551234567" });

    await request(app)
      .post("/api/emergency")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ latitude: 40, longitude: -73 });

    const upload = await request(app)
      .post("/api/recordings/upload")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("type", "audio")
      .attach("file", Buffer.from("fake audio bytes"), "test.m4a");
    const storedFilePath = path.join(STORAGE_DIR, userId, path.basename(upload.body.key));
    expect(fs.existsSync(storedFilePath)).toBe(true);

    await seedSocialConnections(userId);

    const del = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(204);

    // User row and every cascaded child row are gone.
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.trustedContact.findMany({ where: { userId } })).toHaveLength(0);
    expect(await prisma.emergencyEvent.findMany({ where: { userId } })).toHaveLength(0);
    expect(await prisma.recording.findMany({ where: { userId } })).toHaveLength(0);
    expect(await prisma.refreshToken.findMany({ where: { userId } })).toHaveLength(0);
    // Connected TikTok/Instagram accounts, and with them every stored
    // provider access/refresh token, are gone too.
    expect(await prisma.socialConnection.findMany({ where: { userId } })).toHaveLength(0);

    // The still-unexpired access token is rejected immediately, not just
    // once its 15 minutes run out.
    for (const [method, url] of [["get", "/api/contacts"], ["post", "/api/emergency"], ["get", "/api/social"], ["get", "/api/auth/me"]]) {
      const res = await request(app)[method](url).set("Authorization", `Bearer ${accessToken}`).send({});
      expect(res.status).toBe(401);
    }

    // The refresh token issued at registration no longer works.
    const refreshAttempt = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(refreshAttempt.status).toBe(401);

    // Uploaded files were cleaned up from storage.
    expect(fs.existsSync(path.join(STORAGE_DIR, userId))).toBe(false);

    // The email is free to register again.
    const reRegister = await request(app)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, name: "Reused Email" });
    expect(reRegister.status).toBe(201);
    createdUserIds.push(reRegister.body.user.id);
  });

  test("revokes Bes's TikTok access with the decrypted token before deleting", async () => {
    setTikTokConfigured();
    const { accessToken, userId } = await registerUser();
    await seedSocialConnections(userId);
    tiktokClient.revokeAccessToken.mockResolvedValue(undefined);

    const del = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD });

    expect(del.status).toBe(204);
    expect(tiktokClient.revokeAccessToken).toHaveBeenCalledTimes(1);
    expect(tiktokClient.revokeAccessToken).toHaveBeenCalledWith("tt_access_secret");
    expect(await prisma.socialConnection.findMany({ where: { userId } })).toHaveLength(0);
  });

  test("a failed TikTok revoke never blocks deletion", async () => {
    setTikTokConfigured();
    const { accessToken, userId } = await registerUser();
    await seedSocialConnections(userId);
    tiktokClient.revokeAccessToken.mockRejectedValue(new Error("TikTok down"));

    const del = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD });

    expect(del.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.socialConnection.findMany({ where: { userId } })).toHaveLength(0);
  });

  test("does not call TikTok when TikTok isn't configured, or the user never connected it", async () => {
    const first = await registerUser();
    await seedSocialConnections(first.userId); // connected, but provider unconfigured
    await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ password: PASSWORD });

    setTikTokConfigured();
    const second = await registerUser(); // configured, but no connection
    const del = await request(app)
      .delete("/api/users/me")
      .set("Authorization", `Bearer ${second.accessToken}`)
      .send({ password: PASSWORD });

    expect(del.status).toBe(204);
    expect(tiktokClient.revokeAccessToken).not.toHaveBeenCalled();
  });
});
