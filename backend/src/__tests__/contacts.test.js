const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");
const { safeDecrypt } = require("../services/cryptoService");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";

async function registerUser() {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Contact Test User" });
  return { email, accessToken: res.body.accessToken, userId: res.body.user.id };
}

async function deleteUser(userId) {
  await prisma.trustedContact.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("contacts", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("creates a contact and stores name/phone encrypted at rest", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Jane Doe", phoneNumber: "+1 555-123-4567" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Jane Doe");
    expect(res.body.phoneNumber).toBe("+1 555-123-4567");

    const row = await prisma.trustedContact.findUnique({ where: { id: res.body.id } });
    expect(row.name).not.toContain("Jane Doe");
    expect(row.phoneNumber).not.toContain("555-123-4567");
    expect(safeDecrypt(row.name)).toBe("Jane Doe");
    expect(safeDecrypt(row.phoneNumber)).toBe("+1 555-123-4567");
  });

  test("rejects an invalid phone number on create", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Bad Phone", phoneNumber: "not-a-number" });

    expect(res.status).toBe(400);
  });

  test("rejects an invalid phone number on update", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const created = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Ok Contact", phoneNumber: "+15551234567" });

    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ phoneNumber: "12" });

    expect(res.status).toBe(400);
  });

  test("accepts a plausible international phone number", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const res = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Intl Contact", phoneNumber: "+44 20 7946 0958" });

    expect(res.status).toBe(201);
  });

  test("a user cannot update or delete another user's contact", async () => {
    const owner = await registerUser();
    const attacker = await registerUser();
    createdUserIds.push(owner.userId, attacker.userId);

    const created = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Owner's Contact", phoneNumber: "+15551234567" });

    const patchAttempt = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${attacker.accessToken}`)
      .send({ name: "Hijacked" });
    expect(patchAttempt.status).toBe(404);

    const deleteAttempt = await request(app)
      .delete(`/api/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${attacker.accessToken}`);
    expect(deleteAttempt.status).toBe(404);
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/api/contacts");
    expect(res.status).toBe(401);
  });
});
