const request = require("supertest");

const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

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

describe("welcome email", () => {
  const createdEmails = [];
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalTemplateId = process.env.RESEND_WELCOME_TEMPLATE_ID;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });
    process.env.RESEND_API_KEY = "test_resend_key";
    process.env.RESEND_WELCOME_TEMPLATE_ID = "test_template_id";
  });

  afterAll(async () => {
    // Restore so later test files (or a re-run of this one) see the same
    // "unconfigured" state .env.test itself establishes — these tests must
    // never leak config that makes other suites' registrations start
    // actually calling Resend.
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalTemplateId === undefined) delete process.env.RESEND_WELCOME_TEMPLATE_ID;
    else process.env.RESEND_WELCOME_TEMPLATE_ID = originalTemplateId;

    await Promise.all(createdEmails.map(deleteUserByEmail));
    await prisma.$disconnect();
  });

  test("registration triggers the welcome email", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    expect(res.status).toBe(201);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("correct recipient is used", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: email }));
  });

  test("Resend failure does not fail registration", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "provider down" } });
    const email = uniqueEmail();
    createdEmails.push(email);

    const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  test("successful send records welcomeEmailSentAt", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    const user = await prisma.user.findUnique({ where: { id: res.body.user.id } });

    expect(user.welcomeEmailSentAt).toBeInstanceOf(Date);
  });

  test("Resend failure leaves welcomeEmailSentAt unset", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "provider down" } });
    const email = uniqueEmail();
    createdEmails.push(email);

    const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    const user = await prisma.user.findUnique({ where: { id: res.body.user.id } });

    expect(user.welcomeEmailSentAt).toBeNull();
  });

  test("duplicate registration/retry cannot send a second welcome email", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    const first = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
    expect(second.status).toBe(409);

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("API key remains backend-only", () => {
    const fs = require("fs");
    const path = require("path");

    const mobileRoot = path.join(__dirname, "..", "..", "..", "mobile");
    const offenders = [];

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "android" || entry.name === "ios") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(js|jsx|ts|tsx|json)$/.test(entry.name)) {
          if (fs.readFileSync(full, "utf8").includes("RESEND")) offenders.push(full);
        }
      }
    }
    walk(mobileRoot);

    expect(offenders).toEqual([]);
  });
});
