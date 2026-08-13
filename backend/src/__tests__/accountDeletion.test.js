const fs = require("fs");
const path = require("path");

const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");
const { STORAGE_DIR } = require("../services/storageService");

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
});
