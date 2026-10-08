const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";

async function registerUser() {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Social Sharing Test User" });
  return { accessToken: res.body.accessToken, userId: res.body.user.id, email };
}

async function deleteUser(userId) {
  await prisma.socialConnection.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("social sharing (Phase A)", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("GET /api/social requires auth", async () => {
    const res = await request(app).get("/api/social");
    expect(res.status).toBe(401);
  });

  test("GET /api/social returns no connections and both providers unavailable with no env vars set", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app).get("/api/social").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([]);
    expect(res.body.available).toEqual({ tiktok: false, instagram: false });
  });

  test("POST /api/social/:provider/connect 503s with a stable error code when unconfigured", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .post("/api/social/tiktok/connect")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("social_sharing_not_configured");
  });

  test("POST /api/social/:provider/connect rejects an unknown provider", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .post("/api/social/myspace/connect")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
  });

  test("DELETE /api/social/:provider on a non-existent connection is a safe no-op", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .delete("/api/social/instagram")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: "instagram", status: "revoked" });
  });

  test("PATCH /api/social/:provider toggles enabledForEmergency and persists it", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    await prisma.socialConnection.create({
      data: { userId, provider: "tiktok", status: "connected", providerUsername: "seeded_user" },
    });

    const res = await request(app)
      .patch("/api/social/tiktok")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ enabledForEmergency: false });
    expect(res.status).toBe(200);
    expect(res.body.enabledForEmergency).toBe(false);

    const row = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId, provider: "tiktok" } },
    });
    expect(row.enabledForEmergency).toBe(false);
  });

  test("PATCH /api/social/:provider 404s when no connection exists for that provider", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .patch("/api/social/tiktok")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ enabledForEmergency: true });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/social/:provider on an existing connection revokes and clears tokens", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    await prisma.socialConnection.create({
      data: {
        userId,
        provider: "instagram",
        status: "connected",
        providerUsername: "seeded_ig",
        accessTokenEncrypted: "v1:fake:fake:fake",
      },
    });

    const res = await request(app)
      .delete("/api/social/instagram")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");

    const row = await prisma.socialConnection.findUnique({
      where: { userId_provider: { userId, provider: "instagram" } },
    });
    expect(row.status).toBe("revoked");
    expect(row.accessTokenEncrypted).toBeNull();
  });
});
