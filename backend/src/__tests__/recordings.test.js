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
    .send({ email, password: PASSWORD, name: "Recording Test User" });
  return { accessToken: res.body.accessToken, userId: res.body.user.id };
}

async function deleteUser(userId) {
  await prisma.recording.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("recordings", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("upload requires authentication", async () => {
    const res = await request(app)
      .post("/api/recordings/upload")
      .field("type", "audio")
      .attach("file", Buffer.from("fake audio bytes"), "test.m4a");
    expect(res.status).toBe(401);
  });

  test("uploads a file and the returned signed URL downloads the same bytes", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const fileContents = Buffer.from("fake m4a bytes for jest");
    const uploadRes = await request(app)
      .post("/api/recordings/upload")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("type", "audio")
      .attach("file", fileContents, "test.m4a");

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.key).toEqual(expect.stringContaining(userId));
    expect(uploadRes.body.url).toEqual(expect.stringContaining("/api/recordings/file/"));

    const downloadPath = uploadRes.body.url.replace(/^https?:\/\/[^/]+/, "");
    const downloadRes = await request(app).get(downloadPath);

    expect(downloadRes.status).toBe(200);
    // superagent parses the body as a Buffer or as text depending on how it
    // resolves the .m4a content type — handle either shape.
    const receivedBuffer =
      Buffer.isBuffer(downloadRes.body) && downloadRes.body.length > 0
        ? downloadRes.body
        : Buffer.from(downloadRes.text || "", "utf8");
    expect(receivedBuffer.equals(fileContents)).toBe(true);
  });

  test("download rejects a tampered token", async () => {
    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const uploadRes = await request(app)
      .post("/api/recordings/upload")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("type", "audio")
      .attach("file", Buffer.from("bytes"), "test.m4a");

    const downloadPath = uploadRes.body.url.replace(/^https?:\/\/[^/]+/, "");
    const res = await request(app).get(`${downloadPath}xxxtampered`);
    expect(res.status).toBe(403);
  });

  test("GET /api/recordings requires authentication and is scoped per user", async () => {
    const unauth = await request(app).get("/api/recordings");
    expect(unauth.status).toBe(401);

    const userA = await registerUser();
    const userB = await registerUser();
    createdUserIds.push(userA.userId, userB.userId);

    await request(app)
      .post("/api/recordings")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .send({ fileUrl: `${userA.userId}/manual.m4a`, type: "audio" });

    const listForB = await request(app)
      .get("/api/recordings")
      .set("Authorization", `Bearer ${userB.accessToken}`);
    expect(listForB.body).toHaveLength(0);

    const listForA = await request(app)
      .get("/api/recordings")
      .set("Authorization", `Bearer ${userA.accessToken}`);
    expect(listForA.body).toHaveLength(1);
  });
});
