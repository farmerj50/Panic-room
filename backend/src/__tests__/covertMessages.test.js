const request = require("supertest");

const app = require("../app");
const prisma = require("../config/db");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

function uniquePhone() {
  // Distinct 10-digit US-shaped numbers per test run to avoid phoneHash collisions.
  const suffix = String(Date.now()).slice(-9);
  return `+1555${suffix}`;
}

const PASSWORD = "SuperSecret123!";

async function registerUser() {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password: PASSWORD, name: "Covert Test User" });
  return { accessToken: res.body.accessToken, userId: res.body.user.id };
}

async function deleteUser(userId) {
  await prisma.covertMessage.deleteMany({ where: { OR: [{ senderId: userId }, { recipientUserId: userId }] } });
  await prisma.trustedContact.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("covert messages", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("PUT /api/users/me/public-key requires auth and a plausible key", async () => {
    const unauth = await request(app).put("/api/users/me/public-key").send({ publicKey: "x".repeat(44) });
    expect(unauth.status).toBe(401);

    const { accessToken, userId } = await registerUser();
    createdUserIds.push(userId);

    const badKey = await request(app)
      .put("/api/users/me/public-key")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ publicKey: "not-base64!!" });
    expect(badKey.status).toBe(400);

    const goodKey = await request(app)
      .put("/api/users/me/public-key")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ publicKey: Buffer.alloc(32, 7).toString("base64") });
    expect(goodKey.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.body.user.publicKey).toBe(Buffer.alloc(32, 7).toString("base64"));
  });

  test("PATCH /api/users/me registers a phone number and rejects a duplicate on another account", async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    createdUserIds.push(userA.userId, userB.userId);
    const phone = uniquePhone();

    const setPhoneA = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .send({ phoneNumber: phone });
    expect(setPhoneA.status).toBe(204);

    const setPhoneB = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${userB.accessToken}`)
      .send({ phoneNumber: phone });
    expect(setPhoneB.status).toBe(409);
  });

  test("GET /recipient-key resolves a contact's public key so the sender can encrypt before uploading", async () => {
    const sender = await registerUser();
    const recipient = await registerUser();
    createdUserIds.push(sender.userId, recipient.userId);

    const recipientPhone = uniquePhone();
    await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ phoneNumber: recipientPhone });

    const recipientKey = Buffer.alloc(32, 9).toString("base64");
    await request(app)
      .put("/api/users/me/public-key")
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ publicKey: recipientKey });

    const contact = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ name: "Recipient", phoneNumber: recipientPhone });

    const lookup = await request(app)
      .get(`/api/covert-messages/recipient-key/${contact.body.id}`)
      .set("Authorization", `Bearer ${sender.accessToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.publicKey).toBe(recipientKey);

    // A contact belonging to someone else must not leak a public key.
    const attacker = await registerUser();
    createdUserIds.push(attacker.userId);
    const attackerLookup = await request(app)
      .get(`/api/covert-messages/recipient-key/${contact.body.id}`)
      .set("Authorization", `Bearer ${attacker.accessToken}`);
    expect(attackerLookup.status).toBe(404);
  });

  test("GET /recipient-key fails clearly when the matched account hasn't set up a public key yet", async () => {
    const sender = await registerUser();
    const recipient = await registerUser();
    createdUserIds.push(sender.userId, recipient.userId);

    const recipientPhone = uniquePhone();
    await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ phoneNumber: recipientPhone });
    // Deliberately do not set a public key for the recipient.

    const contact = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ name: "Recipient", phoneNumber: recipientPhone });

    const lookup = await request(app)
      .get(`/api/covert-messages/recipient-key/${contact.body.id}`)
      .set("Authorization", `Bearer ${sender.accessToken}`);
    expect(lookup.status).toBe(422);
  });

  test("creating a covert message resolves the recipient via the contact's phone hash and delivers to their inbox", async () => {
    const sender = await registerUser();
    const recipient = await registerUser();
    createdUserIds.push(sender.userId, recipient.userId);

    const recipientPhone = uniquePhone();
    await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${recipient.accessToken}`)
      .send({ phoneNumber: recipientPhone });

    const contact = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ name: "Recipient", phoneNumber: recipientPhone });
    expect(contact.status).toBe(201);

    const upload = await request(app)
      .post("/api/covert-messages/upload")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .attach("file", Buffer.from("fake png bytes"), "message.png");
    expect(upload.status).toBe(201);

    const create = await request(app)
      .post("/api/covert-messages")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ recipientContactId: contact.body.id, fileKey: upload.body.key });
    expect(create.status).toBe(201);
    expect(create.body.senderId).toBe(sender.userId);
    expect(create.body.fileUrl).toEqual(expect.stringContaining("/api/recordings/file/"));

    const senderInbox = await request(app)
      .get("/api/covert-messages/inbox")
      .set("Authorization", `Bearer ${sender.accessToken}`);
    expect(senderInbox.body).toHaveLength(0);

    const recipientInbox = await request(app)
      .get("/api/covert-messages/inbox")
      .set("Authorization", `Bearer ${recipient.accessToken}`);
    expect(recipientInbox.body).toHaveLength(1);
    expect(recipientInbox.body[0].status).toBe("SENT");

    const markRead = await request(app)
      .patch(`/api/covert-messages/${recipientInbox.body[0].id}`)
      .set("Authorization", `Bearer ${recipient.accessToken}`);
    expect(markRead.status).toBe(200);
    expect(markRead.body.status).toBe("READ");

    // The sender must not be able to mark the recipient's message read.
    const senderMarkAttempt = await request(app)
      .patch(`/api/covert-messages/${recipientInbox.body[0].id}`)
      .set("Authorization", `Bearer ${sender.accessToken}`);
    expect(senderMarkAttempt.status).toBe(404);
  });

  test("rejects creating a message for a contact that hasn't registered a matching phone number", async () => {
    const sender = await registerUser();
    createdUserIds.push(sender.userId);

    const contact = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ name: "Nobody", phoneNumber: uniquePhone() });

    const upload = await request(app)
      .post("/api/covert-messages/upload")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .attach("file", Buffer.from("fake png bytes"), "message.png");

    const create = await request(app)
      .post("/api/covert-messages")
      .set("Authorization", `Bearer ${sender.accessToken}`)
      .send({ recipientContactId: contact.body.id, fileKey: upload.body.key });

    expect(create.status).toBe(404);
    expect(create.body.error).toEqual(expect.stringContaining("hasn't set up Bes"));
  });
});
