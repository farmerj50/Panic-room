const request = require("supertest");
const jwt = require("jsonwebtoken");

// Twilio is mocked: sendAlertSms / listSentMessages never reach the network.
// Signature helpers stay real so webhook verification is genuinely tested.
jest.mock("../services/smsServices", () => {
  const actual = jest.requireActual("../services/smsServices");
  return { ...actual, sendAlertSms: jest.fn(), listSentMessages: jest.fn() };
});
const smsServices = require("../services/smsServices");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const consent = require("../services/smsConsentService");
const dispatch = require("../services/smsDispatchService");

const BASE = "https://bes.test";
const PHONE_A = "+15551230001";
const PHONE_B = "+15551230002";
const hashOf = (phone) => hashLookup(phone.replace(/\D/g, ""));

let userIds = [];
const saved = {};

async function makeUser(name = "Alex Rivera") {
  const email = `sms_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: {
      emailHash: hashLookup(email),
      emailEncrypted: encrypt(email),
      nameEncrypted: encrypt(name),
      passwordHash: "unused",
    },
  });
  userIds.push(user.id);
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" });
  return { userId: user.id, token };
}

async function makeContact(userId, phone = PHONE_A, extra = {}) {
  return prisma.trustedContact.create({
    data: { userId, name: encrypt("Sam"), phoneNumber: encrypt(phone), phoneHash: hashOf(phone), ...extra },
  });
}

async function acceptedContact(userId, phone = PHONE_A) {
  return makeContact(userId, phone, { smsConsentStatus: "accepted", smsConsentPhoneHash: hashOf(phone) });
}

async function invite(token, contactId) {
  const res = await request(app)
    .post(`/api/contacts/${contactId}/sms-invite`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(201);
  return { ...res.body, path: new URL(res.body.url).pathname };
}

const respond = (path, choice) => request(app).post(path).type("form").send({ choice });

async function makeEmergency(userId) {
  return prisma.emergencyEvent.create({ data: { userId, status: "ACTIVE" } });
}

function notify(token, emergencyId, body = {}) {
  return request(app).post(`/api/emergency/${emergencyId}/notify`).set("Authorization", `Bearer ${token}`).send(body);
}

function signedPost(path, params) {
  const signature = smsServices.computeTwilioSignature(`${BASE}${path}`, params);
  return request(app).post(path).set("X-Twilio-Signature", signature).type("form").send(params);
}

beforeAll(() => {
  for (const key of ["PUBLIC_BASE_URL", "SMS_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) {
    saved[key] = process.env[key];
  }
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "f".repeat(32);
  process.env.TWILIO_FROM_NUMBER = "+18775550000";
});

afterEach(() => {
  jest.clearAllMocks();
  process.env.SMS_ENABLED = "true";
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await prisma.smsOptOut.deleteMany({ where: { phoneHash: { in: [hashOf(PHONE_A), hashOf(PHONE_B)] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.smsConsentEvent.deleteMany({ where: { phoneHash: { in: [hashOf(PHONE_A), hashOf(PHONE_B)] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  process.env.SMS_ENABLED = "true";
  await prisma.smsOptOut.deleteMany({ where: { phoneHash: { in: [hashOf(PHONE_A), hashOf(PHONE_B)] } } });
});

describe("invitations and consent", () => {
  test("issues a single-use invite; only a hash of the token is stored", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);

    expect(inv.url).toMatch(/^https:\/\/bes\.test\/sms-consent\/[A-Za-z0-9_-]{40,}$/);
    expect(inv.shareMessage).toContain(inv.url);
    const rawToken = inv.path.split("/").pop();
    const rows = await prisma.contactInvite.findMany({ where: { contactId: contact.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(rows)).not.toContain(rawToken);
  });

  test("the consent page is protected, shows the masked number, and never echoes the token", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    const rawToken = inv.path.split("/").pop();

    const page = await request(app).get(inv.path);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.text).toContain("•••-•••-0001");
    expect(page.text).not.toContain("5551230001");
    expect(page.text).not.toContain(rawToken);
    expect(page.text).toContain("Alex added you");
    expect(page.text).toContain(consent.consentTextFor("Alex").replace(/&/g, "&amp;"));
  });

  test("accept binds consent to the number, records an audit event, and the link can't be reused", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);

    const first = await respond(inv.path, "accept");
    expect(first.status).toBe(200);
    expect(first.text).toContain("You're signed up");

    const updated = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(updated.smsConsentStatus).toBe("accepted");
    expect(updated.smsConsentPhoneHash).toBe(hashOf(PHONE_A));
    expect(updated.smsConsentVersion).toBe(consent.CONSENT_VERSION);
    const events = await prisma.smsConsentEvent.findMany({ where: { contactId: contact.id } });
    expect(events).toEqual([
      expect.objectContaining({ action: "accept", consentTextHash: consent.CONSENT_TEXT_HASH, phoneHash: hashOf(PHONE_A) }),
    ]);

    const again = await respond(inv.path, "accept");
    expect(again.status).toBe(410);
    expect(again.text).toContain("already used");
  });

  test("the browser's form submission (with an Origin header) is accepted, not blocked by CORS", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    const res = await request(app).post(inv.path).set("Origin", BASE).type("form").send({ choice: "accept" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("You're signed up");
  });

  test("decline records the choice and grants no consent", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    expect((await respond(inv.path, "decline")).text).toContain("No alerts will be sent");
    const updated = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(updated.smsConsentStatus).toBe("declined");
    expect(updated.smsConsentPhoneHash).toBeNull();
  });

  test("expired, revoked and unknown links are refused", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const first = await invite(token, contact.id);
    const second = await invite(token, contact.id); // revokes the first
    expect((await respond(first.path, "accept")).text).toContain("no longer valid");

    await prisma.contactInvite.updateMany({ where: { contactId: contact.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await respond(second.path, "accept")).text).toContain("expired");

    const unknown = await request(app).get("/sms-consent/not-a-real-token");
    expect(unknown.status).toBe(404);

    const final = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(final.smsConsentStatus).toBe("pending");
  });

  test("two concurrent accepts: exactly one succeeds", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    const results = await Promise.all([respond(inv.path, "accept"), respond(inv.path, "accept")]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.smsConsentEvent.count({ where: { contactId: contact.id, action: "accept" } })).toBe(1);
  });

  test("number changed BEFORE accept: the invite is refused and no consent is created", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);

    await request(app).patch(`/api/contacts/${contact.id}`).set("Authorization", `Bearer ${token}`).send({ phoneNumber: PHONE_B });
    // Changing the number through the API revokes the open invite.
    expect((await request(app).get(inv.path)).text).toContain("no longer valid");
    expect((await respond(inv.path, "accept")).text).toContain("no longer valid");
    const final = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(final.smsConsentStatus).toBe("pending");
    expect(final.smsConsentPhoneHash).toBeNull();
  });

  test("number changed AFTER accept: consent resets to pending for the new number", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    await respond(inv.path, "accept");

    const patched = await request(app).patch(`/api/contacts/${contact.id}`).set("Authorization", `Bearer ${token}`).send({ phoneNumber: PHONE_B });
    expect(patched.body.smsStatus).toBe("pending");
    const final = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(final.smsConsentStatus).toBe("pending");
    expect(final.smsConsentPhoneHash).toBeNull();
    expect(await prisma.smsConsentEvent.count({ where: { contactId: contact.id, action: "revoke" } })).toBe(1);
  });

  test("an invite whose bound number no longer matches is refused even if never revoked", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    // Simulate a number change that bypassed the API (no invite revocation).
    await prisma.trustedContact.update({ where: { id: contact.id }, data: { phoneNumber: encrypt(PHONE_B), phoneHash: hashOf(PHONE_B) } });
    expect((await respond(inv.path, "accept")).text).toContain("out of date");
    const final = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
    expect(final.smsConsentStatus).toBe("pending");
  });

  test("concurrent accept and number change never leave consent bound to the wrong number", async () => {
    for (let i = 0; i < 5; i += 1) {
      const { userId, token } = await makeUser();
      const contact = await makeContact(userId);
      const inv = await invite(token, contact.id);
      await Promise.all([
        respond(inv.path, "accept"),
        request(app).patch(`/api/contacts/${contact.id}`).set("Authorization", `Bearer ${token}`).send({ phoneNumber: PHONE_B }),
      ]);
      const final = await prisma.trustedContact.findUnique({ where: { id: contact.id } });
      const wrongBinding = final.smsConsentStatus === "accepted" && final.smsConsentPhoneHash !== final.phoneHash;
      expect(wrongBinding).toBe(false);
    }
  });

  test("GET /api/contacts reports each contact's SMS status", async () => {
    const { userId, token } = await makeUser();
    await acceptedContact(userId, PHONE_A);
    await makeContact(userId, PHONE_B);
    const res = await request(app).get("/api/contacts").set("Authorization", `Bearer ${token}`);
    expect(res.body.map((c) => c.smsStatus).sort()).toEqual(["accepted", "pending"]);
  });
});

describe("dispatch", () => {
  test("SMS_ENABLED=false sends nothing and notify still succeeds", async () => {
    process.env.SMS_ENABLED = "false";
    const { userId, token } = await makeUser();
    await acceptedContact(userId);
    const event = await makeEmergency(userId);
    const res = await notify(token, event.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ smsAvailable: false, error: "SMS_DISABLED", queuedCount: 0 }));
    expect(smsServices.sendAlertSms).not.toHaveBeenCalled();
  });

  test("only the eligible contact is texted; app-supplied numbers are ignored", async () => {
    const { userId, token } = await makeUser();
    await acceptedContact(userId, PHONE_A);
    await makeContact(userId, PHONE_B); // pending
    await makeContact(userId, "+15551230003", { smsConsentStatus: "declined" });
    await makeContact(userId, "+15551230004", { smsConsentStatus: "accepted", smsConsentPhoneHash: hashOf(PHONE_A) }); // number changed
    smsServices.sendAlertSms.mockResolvedValue({ sid: "SM_ok_1" });
    const event = await makeEmergency(userId);

    const res = await notify(token, event.id, { contacts: [{ name: "Intruder", phoneNumber: "+15559999999" }] });
    expect(res.body).toEqual(expect.objectContaining({ smsAvailable: true, eligibleCount: 1, ineligibleCount: 3, queuedCount: 1 }));
    expect(smsServices.sendAlertSms).toHaveBeenCalledTimes(1);
    expect(smsServices.sendAlertSms.mock.calls[0][0].to).toBe(PHONE_A);
    expect(smsServices.sendAlertSms.mock.calls[0][0].body).toMatch(/^Bes Safety Alert: Alex activated an emergency\. Reply STOP to opt out, HELP for help\.$/);
  });

  test("the location is included only when the emergency has coordinates", async () => {
    expect(dispatch.buildAlertBody({ senderName: "Alex", latitude: 1.5, longitude: 2.5 })).toContain(
      "Location: https://maps.google.com/?q=1.5,2.5",
    );
    expect(dispatch.buildAlertBody({ senderName: null, latitude: null, longitude: null })).toBe(
      "Bes Safety Alert: Your trusted contact activated an emergency. Reply STOP to opt out, HELP for help.",
    );
  });

  test("10 concurrent notify requests send exactly one alert per contact", async () => {
    const { userId, token } = await makeUser();
    await acceptedContact(userId);
    smsServices.sendAlertSms.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { sid: `SM_${Math.random().toString(36).slice(2)}` };
    });
    const event = await makeEmergency(userId);
    const results = await Promise.all(Array.from({ length: 10 }, () => notify(token, event.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(smsServices.sendAlertSms).toHaveBeenCalledTimes(1);
    expect(await prisma.smsMessage.count({ where: { emergencyId: event.id } })).toBe(1);
  });

  test("Twilio 21610 (recipient replied STOP) marks the message and suppresses the number", async () => {
    const { userId, token } = await makeUser();
    await acceptedContact(userId);
    smsServices.sendAlertSms.mockRejectedValue(
      new smsServices.TwilioProviderError('SMS provider failed: {"code":21610,"message":"Attempt to send to unsubscribed recipient"}', { status: 400 }),
    );
    const event = await makeEmergency(userId);
    await notify(token, event.id);

    const message = await prisma.smsMessage.findFirst({ where: { emergencyId: event.id } });
    expect(message.status).toBe("opted_out");
    expect(await prisma.smsOptOut.findUnique({ where: { phoneHash: hashOf(PHONE_A) } })).not.toBeNull();
    const contacts = await request(app).get("/api/contacts").set("Authorization", `Bearer ${token}`);
    expect(contacts.body[0].smsStatus).toBe("opted_out");
  });

  test("an uncertain send (timeout) is not retried and stays reserved for reconciliation", async () => {
    const { userId, token } = await makeUser();
    await acceptedContact(userId);
    smsServices.sendAlertSms.mockRejectedValue(new smsServices.UncertainSendError(new Error("timeout")));
    const event = await makeEmergency(userId);
    const res = await notify(token, event.id);
    expect(res.body).toEqual(expect.objectContaining({ uncertainCount: 1, queuedCount: 0, failedCount: 0 }));
    expect(smsServices.sendAlertSms).toHaveBeenCalledTimes(1);
    const message = await prisma.smsMessage.findFirst({ where: { emergencyId: event.id } });
    expect(message.status).toBe("reserved");
  });
});

describe("stale reservation recovery (never re-sends)", () => {
  async function staleMessage(body) {
    const { userId } = await makeUser();
    const contact = await acceptedContact(userId);
    const event = await makeEmergency(userId);
    const createdAt = new Date(Date.now() - 11 * 60 * 1000);
    const message = await prisma.smsMessage.create({
      data: {
        emergencyId: event.id,
        contactId: contact.id,
        toPhoneHash: hashOf(PHONE_A),
        bodyHash: dispatch.bodyHashOf(body),
        status: "reserved",
        createdAt,
      },
    });
    return { message, createdAt };
  }
  const BODY = "Bes Safety Alert: Alex activated an emergency. Reply STOP to opt out, HELP for help.";
  const candidate = (createdAt, overrides = {}) => ({
    sid: `SM_${Math.random().toString(36).slice(2)}`,
    from: process.env.TWILIO_FROM_NUMBER,
    to: PHONE_A,
    body: BODY,
    status: "delivered",
    date_created: new Date(createdAt.getTime() + 2000).toUTCString(),
    ...overrides,
  });

  test("an exact, unique match is attached", async () => {
    const { message, createdAt } = await staleMessage(BODY);
    const match = candidate(createdAt);
    smsServices.listSentMessages.mockResolvedValue([match]);
    await dispatch.sweepStaleReservations();
    const updated = await prisma.smsMessage.findUnique({ where: { id: message.id } });
    expect(updated).toEqual(expect.objectContaining({ twilioSid: match.sid, status: "delivered" }));
    expect(smsServices.sendAlertSms).not.toHaveBeenCalled();
  });

  test.each([
    ["a different body", (c) => [candidate(c, { body: "something else" })]],
    ["a different sender", (c) => [candidate(c, { from: "+18005550123" })]],
    ["two candidates", (c) => [candidate(c), candidate(c)]],
    ["no candidates", () => []],
    ["outside the time window", (c) => [candidate(c, { date_created: new Date(c.getTime() + 20 * 60 * 1000).toUTCString() })]],
  ])("%s -> unconfirmed, never re-sent", async (_label, build) => {
    const { message, createdAt } = await staleMessage(BODY);
    smsServices.listSentMessages.mockResolvedValue(build(createdAt));
    await dispatch.sweepStaleReservations();
    const updated = await prisma.smsMessage.findUnique({ where: { id: message.id } });
    expect(updated.status).toBe("unconfirmed");
    expect(updated.twilioSid).toBeNull();
    expect(smsServices.sendAlertSms).not.toHaveBeenCalled();
  });

  test("a sid already linked to another message is never reused", async () => {
    const { message, createdAt } = await staleMessage(BODY);
    const match = candidate(createdAt);
    const other = await staleMessage("other");
    await prisma.smsMessage.update({ where: { id: other.message.id }, data: { twilioSid: match.sid, status: "queued" } });
    smsServices.listSentMessages.mockResolvedValue([match]);
    await dispatch.sweepStaleReservations();
    expect((await prisma.smsMessage.findUnique({ where: { id: message.id } })).status).toBe("unconfirmed");
  });
});

describe("Twilio webhooks", () => {
  test("a bad or missing signature is rejected", async () => {
    const bad = await request(app).post("/api/twilio/sms-inbound").set("X-Twilio-Signature", "nope").type("form").send({ From: PHONE_A });
    expect(bad.status).toBe(403);
    const missing = await request(app).post("/api/twilio/sms-status").type("form").send({ MessageSid: "SMx" });
    expect(missing.status).toBe(403);
  });

  test("STOP suppresses, START lifts it; replies are always empty TwiML", async () => {
    const stop = await signedPost("/api/twilio/sms-inbound", { From: PHONE_A, Body: "STOP", OptOutType: "STOP" });
    expect(stop.status).toBe(200);
    expect(stop.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await prisma.smsOptOut.findUnique({ where: { phoneHash: hashOf(PHONE_A) } })).not.toBeNull();

    const start = await signedPost("/api/twilio/sms-inbound", { From: PHONE_A, Body: "START", OptOutType: "START" });
    expect(start.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await prisma.smsOptOut.findUnique({ where: { phoneHash: hashOf(PHONE_A) } })).toBeNull();

    const help = await signedPost("/api/twilio/sms-inbound", { From: PHONE_A, Body: "HELP", OptOutType: "HELP" });
    expect(help.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  test("START (or YES) never creates consent for a pending contact", async () => {
    const { userId, token } = await makeUser();
    await makeContact(userId, PHONE_A); // pending
    await signedPost("/api/twilio/sms-inbound", { From: PHONE_A, Body: "START", OptOutType: "START" });
    await signedPost("/api/twilio/sms-inbound", { From: PHONE_A, Body: "YES" });
    const event = await makeEmergency(userId);
    const res = await notify(token, event.id);
    expect(res.body.eligibleCount).toBe(0);
    expect(smsServices.sendAlertSms).not.toHaveBeenCalled();
  });

  test("status callbacks only move forward; final states never change", async () => {
    const { userId } = await makeUser();
    const contact = await acceptedContact(userId);
    const event = await makeEmergency(userId);
    const sid = `SM_${Date.now()}`;
    await prisma.smsMessage.create({
      data: { emergencyId: event.id, contactId: contact.id, toPhoneHash: hashOf(PHONE_A), bodyHash: "x", status: "queued", twilioSid: sid },
    });
    const status = (s) => signedPost("/api/twilio/sms-status", { MessageSid: sid, MessageStatus: s });
    const current = async () => (await prisma.smsMessage.findUnique({ where: { twilioSid: sid } })).status;

    await status("sent");
    expect(await current()).toBe("sent");
    await status("queued"); // late, older
    expect(await current()).toBe("sent");
    await status("delivered");
    expect(await current()).toBe("delivered");
    await status("sent"); // late
    await status("undelivered"); // conflicting final
    expect(await current()).toBe("delivered");
  });
});

describe("program page, deletion and retention", () => {
  test("/sms-alerts is public, permanent and shows the current consent wording", async () => {
    const res = await request(app).get("/sms-alerts");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.text).toContain("Emergency Text Alerts");
    expect(res.text).toContain(consent.consentTextFor("[the Bes user]").replace(/&/g, "&amp;"));
  });

  test("account deletion keeps consent evidence (unlinked) and opt-outs, removes invites", async () => {
    const { userId, token } = await makeUser();
    const contact = await makeContact(userId);
    const inv = await invite(token, contact.id);
    await respond(inv.path, "accept");
    await prisma.smsOptOut.create({ data: { phoneHash: hashOf(PHONE_A), source: "carrier_stop" } });

    await prisma.user.delete({ where: { id: userId } });
    userIds = userIds.filter((id) => id !== userId);

    const events = await prisma.smsConsentEvent.findMany({ where: { phoneHash: hashOf(PHONE_A), action: "accept" } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.contactId === null || e.contactId !== contact.id)).toBe(true);
    expect(await prisma.contactInvite.count({ where: { contactId: contact.id } })).toBe(0);
    expect(await prisma.smsOptOut.findUnique({ where: { phoneHash: hashOf(PHONE_A) } })).not.toBeNull();
  });

  test("consent events older than the retention window are purged", async () => {
    const old = await prisma.smsConsentEvent.create({
      data: { phoneHash: hashOf(PHONE_B), action: "accept", createdAt: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000) },
    });
    const recent = await prisma.smsConsentEvent.create({ data: { phoneHash: hashOf(PHONE_B), action: "accept" } });
    await consent.purgeExpiredConsentEvents();
    expect(await prisma.smsConsentEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.smsConsentEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
