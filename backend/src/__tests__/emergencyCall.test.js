const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");

// Twilio is mocked: these tests are about what POST /api/emergency/call
// reports back, not about reaching Twilio.
jest.mock("../services/smsServices", () => {
  const actual = jest.requireActual("../services/smsServices");
  return {
    ...actual,
    hasVoiceProviderConfig: jest.fn(() => true),
    hasSmsProviderConfig: jest.fn(() => true),
    sendVoiceCall: jest.fn(),
    sendSms: jest.fn(),
  };
});
const { sendVoiceCall, sendSms, TwilioProviderError } = require("../services/smsServices");

const CONTACTS = [{ name: "Alex", phoneNumber: "+15551234567" }];

async function makeUser() {
  const email = `test_call_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), passwordHash: "unused-in-these-tests" },
  });
  const accessToken = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "15m" });
  return { userId: user.id, accessToken };
}

describe("emergency calls and texts report why they failed", () => {
  const userIds = [];

  afterEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  test("reports success when Twilio accepts the calls", async () => {
    const { userId, accessToken } = await makeUser();
    userIds.push(userId);
    sendVoiceCall.mockResolvedValue({ sid: "CA1" });

    const res = await request(app)
      .post("/api/emergency/call")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ contacts: CONTACTS, message: "test" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ called: true, calledCount: 1, failedCount: 0 }));
    expect(res.body.error).toBeUndefined();
  });

  test("when Twilio rejects every call, says why instead of looking unconfigured", async () => {
    const { userId, accessToken } = await makeUser();
    userIds.push(userId);
    sendVoiceCall.mockRejectedValue(new TwilioProviderError("Voice provider failed: Authenticate", { status: 401 }));

    const res = await request(app)
      .post("/api/emergency/call")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ contacts: CONTACTS, message: "test" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ called: false, calledCount: 0, failedCount: 1, providerConfigured: true }),
    );
    expect(res.body.error).toBe("PROVIDER_ERROR: Voice provider failed: Authenticate");
  });

  test("when Twilio rejects every emergency text, the notify response says why", async () => {
    const { userId, accessToken } = await makeUser();
    userIds.push(userId);
    const event = await prisma.emergencyEvent.create({ data: { userId, status: "ACTIVE" } });
    sendSms.mockRejectedValue(new TwilioProviderError("SMS provider failed: Authenticate", { status: 401 }));

    const res = await request(app)
      .post(`/api/emergency/${event.id}/notify`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ contacts: CONTACTS, message: "test" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ sent: false, notifiedCount: 0, providerConfigured: true }));
    expect(res.body.error).toBe("PROVIDER_ERROR: SMS provider failed: Authenticate");
  });

  test("Twilio's raw error body (with the account SID) is reduced to a short reason", async () => {
    const { userId, accessToken } = await makeUser();
    userIds.push(userId);
    const raw =
      'Voice provider failed: {"code":20003,"message":"authentication failed, auth token is not valid for account ' + "AC" + "0123456789abcdef".repeat(2) + '","more_info":"https://www.twilio.com/docs/errors/20003","status":401}';
    sendVoiceCall.mockRejectedValue(new TwilioProviderError(raw, { status: 401 }));

    const res = await request(app)
      .post("/api/emergency/call")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ contacts: CONTACTS, message: "test" });

    expect(res.body.error).toBe("PROVIDER_ERROR: Twilio error 20003: authentication failed, auth token is not valid");
    expect(res.body.error).not.toMatch(/AC[0-9a-f]{32}/);
  });
});
