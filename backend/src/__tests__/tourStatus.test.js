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
    .send({ email, password: PASSWORD, name: "Tour Test User" });
  return { accessToken: res.body.accessToken, userId: res.body.user.id };
}

async function deleteUser(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("tour status", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("PATCH /api/users/me/tour requires auth", async () => {
    const res = await request(app).patch("/api/users/me/tour").send({ status: "completed" });
    expect(res.status).toBe(401);
  });

  test("rejects a missing or invalid status", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const missing = await request(app)
      .patch("/api/users/me/tour")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(missing.status).toBe(400);

    const invalid = await request(app)
      .patch("/api/users/me/tour")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "nope" });
    expect(invalid.status).toBe(400);
  });

  test("status: completed records tourCompletedAt and leaves tourSkippedAt unset", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .patch("/api/users/me/tour")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "completed" });
    expect(res.status).toBe(204);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.tourCompletedAt).toBeInstanceOf(Date);
    expect(user.tourSkippedAt).toBeNull();
  });

  test("status: skipped records tourSkippedAt and leaves tourCompletedAt unset", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .patch("/api/users/me/tour")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "skipped" });
    expect(res.status).toBe(204);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.tourSkippedAt).toBeInstanceOf(Date);
    expect(user.tourCompletedAt).toBeNull();
  });
});
