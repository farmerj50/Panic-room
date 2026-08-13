const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";

async function deleteUserByEmail(email) {
  const users = await prisma.user.findMany();
  const { safeDecrypt } = require("../services/cryptoService");
  const match = users.find((u) => safeDecrypt(u.emailEncrypted) === email);
  if (match) {
    await prisma.refreshToken.deleteMany({ where: { userId: match.id } });
    await prisma.user.delete({ where: { id: match.id } });
  }
}

describe("auth", () => {
  const createdEmails = [];

  afterAll(async () => {
    await Promise.all(createdEmails.map(deleteUserByEmail));
    await prisma.$disconnect();
  });

  test("register returns an access token and a refresh token", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(email);
  });

  test("login with correct credentials succeeds", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  test("login with wrong password is rejected", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    const res = await request(app).post("/api/auth/login").send({ email, password: "wrongpassword123" });

    expect(res.status).toBe(401);
  });

  test("refresh rotates the token and the old token can no longer be used", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const reg = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    const originalRefreshToken = reg.body.refreshToken;

    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: originalRefreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(originalRefreshToken);

    const reuseOld = await request(app).post("/api/auth/refresh").send({ refreshToken: originalRefreshToken });
    expect(reuseOld.status).toBe(401);
  });

  test("reusing a rotated (already-revoked) refresh token revokes the whole chain", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const reg = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    const originalRefreshToken = reg.body.refreshToken;

    const firstRefresh = await request(app).post("/api/auth/refresh").send({ refreshToken: originalRefreshToken });
    const newRefreshToken = firstRefresh.body.refreshToken;

    // Reuse the old (already-rotated) token — simulates a stolen token being
    // used after the legitimate client already rotated past it.
    await request(app).post("/api/auth/refresh").send({ refreshToken: originalRefreshToken });

    // The new token, which should still be legitimate, must now also be dead.
    const attemptWithNewToken = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: newRefreshToken });
    expect(attemptWithNewToken.status).toBe(401);
  });

  test("logout revokes the refresh token", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const reg = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    const refreshToken = reg.body.refreshToken;

    const logoutRes = await request(app).post("/api/auth/logout").send({ refreshToken });
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });

  test("/api/auth/me requires a valid access token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
