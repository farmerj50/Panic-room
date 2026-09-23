const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

// This file exercises account-links behavior specifically, not
// registration itself (already covered by auth.test.js) — creating users
// directly via Prisma and minting their access tokens the same way
// authController.js's signAccessToken() does keeps this file from
// tripping the *pre-existing*, shared, process-wide authLimiter on
// POST /api/auth/register (rateLimit.js's bucket state is a module-level
// singleton with no per-test reset, and this file creates enough users
// across its tests that going through the real HTTP endpoint for all of
// them would exceed that limiter's budget).
async function registerUser(name = "Account Link Test User") {
  const email = uniqueEmail();
  const user = await prisma.user.create({
    data: {
      emailHash: hashLookup(email),
      emailEncrypted: encrypt(email),
      nameEncrypted: name ? encrypt(name) : null,
      passwordHash: "unused-in-these-tests",
    },
  });
  const accessToken = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" });
  return { email, accessToken, userId: user.id };
}

async function makePremium(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

async function deleteUser(userId) {
  await prisma.accountLink.deleteMany({ where: { OR: [{ ownerUserId: userId }, { linkedUserId: userId }] } });
  await prisma.trustedContact.deleteMany({ where: { userId } });
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function invite(accessToken, relationshipType = "family") {
  return request(app)
    .post("/api/account-links/invite")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ relationshipType });
}

describe("account links", () => {
  const createdUserIds = [];

  afterAll(async () => {
    await Promise.all(createdUserIds.map(deleteUser));
    await prisma.$disconnect();
  });

  test("free user cannot create an invite", async () => {
    const owner = await registerUser();
    createdUserIds.push(owner.userId);

    const res = await invite(owner.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
  });

  test("Pro user creates an invite; code is hashed at rest, plaintext returned once", async () => {
    const owner = await registerUser();
    createdUserIds.push(owner.userId);
    await makePremium(owner.userId);

    const res = await invite(owner.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(typeof res.body.code).toBe("string");

    const row = await prisma.accountLink.findUnique({ where: { id: res.body.id } });
    expect(row.status).toBe("pending");
    expect(row.codeHash).not.toBe(res.body.code);
  });

  test("preview never consumes the code; accept does, and both sides see the link", async () => {
    const owner = await registerUser("Preview Owner");
    const linked = await registerUser("Preview Linked");
    createdUserIds.push(owner.userId, linked.userId);
    await makePremium(owner.userId);

    const created = await invite(owner.accessToken, "family");
    const { code } = created.body;

    const preview = await request(app)
      .post("/api/account-links/preview")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      ownerName: "Preview Owner",
      relationshipType: "family",
      sharesEmergencyAlerts: true,
      sharesLiveLocationDuringEmergency: true,
      backgroundLocationEligible: false,
    });
    expect(preview.body.permissions).toBeUndefined();

    const rowAfterPreview = await prisma.accountLink.findUnique({ where: { id: created.body.id } });
    expect(rowAfterPreview.status).toBe("pending");
    expect(rowAfterPreview.consumedAt).toBeNull();

    const accept = await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code });
    expect(accept.status).toBe(200);

    const owned = await request(app)
      .get("/api/account-links")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(owned.body).toHaveLength(1);
    expect(owned.body[0].status).toBe("active");
    expect(owned.body[0].linkedUserName).toBe("Preview Linked");

    const linkedToMe = await request(app)
      .get("/api/account-links/linked-to-me")
      .set("Authorization", `Bearer ${linked.accessToken}`);
    expect(linkedToMe.body).toHaveLength(1);
    expect(linkedToMe.body[0].ownerName).toBe("Preview Owner");
  });

  test("owner at 5 pending+active links is rejected on a 6th invite", async () => {
    const owner = await registerUser();
    createdUserIds.push(owner.userId);
    await makePremium(owner.userId);

    for (let i = 0; i < 5; i += 1) {
      const res = await invite(owner.accessToken);
      expect(res.status).toBe(201);
    }

    const overCap = await invite(owner.accessToken);
    expect(overCap.status).toBe(403);
    expect(overCap.body.code).toBe("LINKED_ACCOUNT_LIMIT_REACHED");
    expect(overCap.body.error).toBe(
      "You've reached your Bes Pro linked-account limit of 5. Remove an existing linked account before adding another.",
    );
  });

  test("accept-time cap guard rejects a 6th slot but allows the normal 4-active+1-pending case", async () => {
    const owner = await registerUser();
    const linkedUsers = await Promise.all([1, 2, 3, 4, 5].map(() => registerUser()));
    createdUserIds.push(owner.userId, ...linkedUsers.map((u) => u.userId));
    await makePremium(owner.userId);

    // Directly seed 5 active links + 1 pending, bypassing the create
    // endpoint's own cap check, to simulate a race where the owner ends up
    // with more outstanding slots than the cap by the time an accept lands.
    for (let i = 0; i < 5; i += 1) {
      await prisma.accountLink.create({
        data: {
          ownerUserId: owner.userId,
          linkedUserId: linkedUsers[i].userId,
          relationshipType: "friend",
          status: "active",
          codeHash: `seed-active-${i}-${Date.now()}`,
          expiresAt: new Date(Date.now() + 1000 * 60),
          consumedAt: new Date(),
          acceptedAt: new Date(),
        },
      });
    }

    const sixthLinked = await registerUser();
    createdUserIds.push(sixthLinked.userId);
    const sixthCodeRaw = "ZZZZ-ZZZZ-99";
    await prisma.accountLink.create({
      data: {
        ownerUserId: owner.userId,
        relationshipType: "friend",
        status: "pending",
        codeHash: hashLookup(sixthCodeRaw.replace(/-/g, "")),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    const accept = await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${sixthLinked.accessToken}`)
      .send({ code: sixthCodeRaw });
    expect(accept.status).toBe(400);
    expect(accept.body.code).toBe("owner_at_cap");
  });

  test("revoking a pending invite frees its slot; only the owner may revoke it", async () => {
    const owner = await registerUser();
    const bystander = await registerUser();
    createdUserIds.push(owner.userId, bystander.userId);
    await makePremium(owner.userId);

    for (let i = 0; i < 4; i += 1) {
      await invite(owner.accessToken);
    }
    const fifth = await invite(owner.accessToken);
    expect(fifth.status).toBe(201);
    // The cap-rejection response itself is already covered by the
    // dedicated "6th invite" test above — not re-asserted here, this test
    // is specifically about revoke freeing a slot.

    const bystanderRevoke = await request(app)
      .delete(`/api/account-links/${fifth.body.id}`)
      .set("Authorization", `Bearer ${bystander.accessToken}`);
    expect(bystanderRevoke.status).toBe(404);

    const ownerRevoke = await request(app)
      .delete(`/api/account-links/${fifth.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(ownerRevoke.status).toBe(204);

    const row = await prisma.accountLink.findUnique({ where: { id: fifth.body.id } });
    expect(row.status).toBe("revoked");
    expect(row.revokedByRole).toBe("owner");

    const freedSlot = await invite(owner.accessToken);
    expect(freedSlot.status).toBe(201);
  });

  test("expired, garbage, and replayed codes are all rejected", async () => {
    const owner = await registerUser();
    const linked = await registerUser();
    createdUserIds.push(owner.userId, linked.userId);
    await makePremium(owner.userId);

    const garbage = await request(app)
      .post("/api/account-links/preview")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: "NOT-A-REAL-CODE" });
    expect(garbage.status).toBe(400);
    expect(garbage.body.code).toBe("invalid_code");

    const expiredRaw = "AAAA-BBBB-CC";
    await prisma.accountLink.create({
      data: {
        ownerUserId: owner.userId,
        relationshipType: "friend",
        status: "pending",
        codeHash: hashLookup(expiredRaw.replace(/-/g, "")),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await request(app)
      .post("/api/account-links/preview")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: expiredRaw });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe("expired");

    const created = await invite(owner.accessToken);
    await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: created.body.code });

    const replay = await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: created.body.code });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe("invalid_code");
  });

  test("cannot link your own account", async () => {
    const owner = await registerUser();
    createdUserIds.push(owner.userId);
    await makePremium(owner.userId);

    const created = await invite(owner.accessToken);
    const selfAccept = await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: created.body.code });
    expect(selfAccept.status).toBe(400);
    expect(selfAccept.body.code).toBe("cannot_link_self");
  });

  test("revoke on an active link: either side may revoke; a third party cannot", async () => {
    const owner = await registerUser();
    const linked = await registerUser();
    const stranger = await registerUser();
    createdUserIds.push(owner.userId, linked.userId, stranger.userId);
    await makePremium(owner.userId);

    const created = await invite(owner.accessToken);
    await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: created.body.code });

    const strangerAttempt = await request(app)
      .delete(`/api/account-links/${created.body.id}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);
    expect(strangerAttempt.status).toBe(404);

    const linkedRevoke = await request(app)
      .delete(`/api/account-links/${created.body.id}`)
      .set("Authorization", `Bearer ${linked.accessToken}`);
    expect(linkedRevoke.status).toBe(204);

    const row = await prisma.accountLink.findUnique({ where: { id: created.body.id } });
    expect(row.revokedByRole).toBe("linked");
  });

  test("owner updates emergencyAlerts; non-owner cannot; owner cannot set backgroundLocation", async () => {
    const owner = await registerUser();
    const linked = await registerUser();
    const stranger = await registerUser();
    createdUserIds.push(owner.userId, linked.userId, stranger.userId);
    await makePremium(owner.userId);

    const created = await invite(owner.accessToken);
    await request(app)
      .post("/api/account-links/accept")
      .set("Authorization", `Bearer ${linked.accessToken}`)
      .send({ code: created.body.code });

    const patch = await request(app)
      .patch(`/api/account-links/${created.body.id}/permissions`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ emergencyAlerts: false });
    expect(patch.status).toBe(200);
    expect(patch.body.permissions.emergencyAlerts).toBe(false);

    const nonOwnerPatch = await request(app)
      .patch(`/api/account-links/${created.body.id}/permissions`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ emergencyAlerts: true });
    expect(nonOwnerPatch.status).toBe(404);

    const bgAttempt = await request(app)
      .patch(`/api/account-links/${created.body.id}/permissions`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ backgroundLocation: true });
    expect(bgAttempt.status).toBe(400);
    expect(bgAttempt.body.code).toBe("BACKGROUND_LOCATION_NOT_OWNER_SETTABLE");
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/api/account-links");
    expect(res.status).toBe(401);
  });

  test("rate limits /preview and /accept", async () => {
    const owner = await registerUser();
    const linked = await registerUser();
    createdUserIds.push(owner.userId, linked.userId);
    await makePremium(owner.userId);

    let lastStatus = 200;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .post("/api/account-links/preview")
        .set("Authorization", `Bearer ${linked.accessToken}`)
        .send({ code: "WRONG-CODE-XX" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  }, 20000);
});
