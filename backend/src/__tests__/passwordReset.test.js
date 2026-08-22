const request = require("supertest");

jest.mock("../services/smsServices");
const { sendSms, hasSmsProviderConfig } = require("../services/smsServices");

const app = require("../app");
const prisma = require("../config/db");
const { issueResetCode } = require("../services/passwordResetService");

function uniqueEmail() {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

const PASSWORD = "SuperSecret123!";
const NEW_PASSWORD = "EvenMoreSecret456!";

// User.phoneHash is unique — each test needs its own number so parallel/
// repeated runs never collide over who "owns" a shared test phone number.
function uniquePhone() {
  return `+1555${String(Date.now()).slice(-7)}`;
}

async function deleteUserByEmail(email) {
  const users = await prisma.user.findMany();
  const { safeDecrypt } = require("../services/cryptoService");
  const match = users.find((u) => safeDecrypt(u.emailEncrypted) === email);
  if (match) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: match.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: match.id } });
    await prisma.user.delete({ where: { id: match.id } });
  }
}

// The DB only ever stores a one-way hash of the code, so tests recover the
// plaintext code the same way a real user would receive it: from the SMS body.
function extractCode(smsBody) {
  return smsBody.match(/\b(\d{6})\b/)[1];
}

async function registerWithPhone(email) {
  const phone = uniquePhone();
  const reg = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });
  const patchRes = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${reg.body.accessToken}`)
    .send({ phoneNumber: phone });
  if (patchRes.status !== 204) {
    throw new Error(`setting phone failed: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
  }
  return { ...reg.body, phone };
}

describe("password reset", () => {
  const createdEmails = [];

  beforeEach(() => {
    sendSms.mockClear();
    hasSmsProviderConfig.mockReturnValue(true);
    sendSms.mockResolvedValue({});
  });

  afterAll(async () => {
    await Promise.all(createdEmails.map(deleteUserByEmail));
    await prisma.$disconnect();
  });

  test("full happy path: request code, reset password, old sessions revoked, new password works", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const { refreshToken: originalRefreshToken, phone } = await registerWithPhone(email);

    const forgotRes = await request(app).post("/api/auth/forgot-password").send({ email });
    expect(forgotRes.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0].to).toBe(phone);

    const code = extractCode(sendSms.mock.calls[0][0].body);

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: NEW_PASSWORD });
    expect(resetRes.status).toBe(204);

    // Every session issued before the reset must now be dead.
    const refreshAfterReset = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: originalRefreshToken });
    expect(refreshAfterReset.status).toBe(401);

    const loginWithNew = await request(app).post("/api/auth/login").send({ email, password: NEW_PASSWORD });
    expect(loginWithNew.status).toBe(200);

    const loginWithOld = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
    expect(loginWithOld.status).toBe(401);
  });

  test("wrong code is rejected and does not consume the real code", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const { user } = await registerWithPhone(email);

    // Seed the code directly via the service (not the rate-limited HTTP
    // endpoint, which the forgot-password-specific tests below already cover).
    const realCode = await issueResetCode(user.id);
    const wrongCode = realCode === "000000" ? "111111" : "000000";

    const wrongRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: wrongCode, newPassword: NEW_PASSWORD });
    expect(wrongRes.status).toBe(400);

    const rightRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: realCode, newPassword: NEW_PASSWORD });
    expect(rightRes.status).toBe(204);
  });

  test("expired code is rejected", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const { user } = await registerWithPhone(email);

    const code = await issueResetCode(user.id);

    await prisma.passwordResetToken.updateMany({
      where: { consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  test("a code can only be used once", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const { user } = await registerWithPhone(email);

    const code = await issueResetCode(user.id);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(204);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "AnotherPassword789!" });
    expect(second.status).toBe(400);
  });

  test("account with no phone on file gets the generic response and no SMS is sent", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    await request(app).post("/api/auth/register").send({ email, password: PASSWORD, name: "T" });

    const res = await request(app).post("/api/auth/forgot-password").send({ email });
    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
  });

  test("nonexistent email gets the same generic response", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: uniqueEmail() });
    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
