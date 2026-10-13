const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

// Google's verifier is mocked at the library boundary, so our own checks
// (issuer, verified email, audience passed through) are exercised for real.
const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: (...a) => mockVerifyIdToken(...a) })),
}));
jest.mock("../services/emailService", () => ({
  hasResendConfig: () => false,
  sendWelcomeEmail: jest.fn(),
  hasTransactionalEmailConfig: () => true,
  sendAccountDeletionCode: jest.fn().mockResolvedValue({}),
}));
jest.mock("../services/ga4Service", () => ({ sendServerGA4Event: jest.fn().mockResolvedValue(undefined) }));

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const { googleSubHash } = require("../services/googleAuthService");
const emailService = require("../services/emailService");
const { sendServerGA4Event } = require("../services/ga4Service");

const WEB_CLIENT = "test-web-client.apps.googleusercontent.com";
const userIds = new Set();
const emails = [];
let saved;

function uniqueEmail() {
  const email = `g_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  emails.push(email);
  return email;
}

// The ID token string is opaque to us; the mocked verifier maps it to claims.
function googleToken(claims) {
  const token = `tok_${Math.random().toString(36).slice(2)}_${"x".repeat(30)}`;
  mockVerifyIdToken.mockImplementation(async ({ idToken, audience }) => {
    if (idToken !== token || audience !== WEB_CLIENT) throw new Error("Wrong recipient");
    return {
      getPayload: () => ({
        iss: "https://accounts.google.com",
        aud: WEB_CLIENT,
        email_verified: true,
        iat: Math.floor(Date.now() / 1000),
        ...claims,
      }),
    };
  });
  return token;
}

const google = (idToken, extra = {}) => request(app).post("/api/auth/google").send({ idToken, ...extra });
const sessionFor = (userId) => jwt.sign({}, process.env.JWT_SECRET, { subject: userId, expiresIn: "15m" });

async function passwordUser(email, password = "CorrectHorse1!") {
  const user = await prisma.user.create({
    data: {
      emailHash: hashLookup(email),
      emailEncrypted: encrypt(email),
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  userIds.add(user.id);
  return user;
}

beforeAll(() => {
  saved = process.env.GOOGLE_WEB_CLIENT_ID;
  process.env.GOOGLE_WEB_CLIENT_ID = WEB_CLIENT;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (saved === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
  else process.env.GOOGLE_WEB_CLIENT_ID = saved;
  const byEmail = await prisma.user.findMany({ where: { emailHash: { in: emails.map((e) => hashLookup(e)) } } });
  byEmail.forEach((u) => userIds.add(u.id));
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await prisma.$disconnect();
});

describe("POST /api/auth/google", () => {
  test("a new Google user gets an account with no password and a Google link; account_created is reported", async () => {
    const email = uniqueEmail();
    const sub = `sub-${Date.now()}`;
    const res = await google(googleToken({ sub, email, name: "Gina Google" }), { ga4ClientId: "123.456" });

    expect(res.status).toBe(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toEqual(expect.objectContaining({ email, name: "Gina Google", hasPassword: false, googleLinked: true }));

    const row = await prisma.user.findUnique({ where: { emailHash: hashLookup(email) } });
    userIds.add(row.id);
    expect(row.passwordHash).toBeNull();
    expect(row.googleSubHash).toBe(googleSubHash(sub));
    expect(sendServerGA4Event).toHaveBeenCalledWith("123.456", "account_created", { method: "google" });
  });

  test("a returning Google user signs in to the same account (no second row)", async () => {
    const email = uniqueEmail();
    const sub = `sub-ret-${Date.now()}`;
    const first = await google(googleToken({ sub, email }));
    userIds.add(first.body.user.id);
    sendServerGA4Event.mockClear();

    const again = await google(googleToken({ sub, email }));
    expect(again.status).toBe(200);
    expect(again.body.isNewUser).toBe(false);
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { emailHash: hashLookup(email) } })).toBe(1);
    expect(sendServerGA4Event).not.toHaveBeenCalled();
  });

  test("an existing email/password account is NOT linked, signed in, or duplicated", async () => {
    const email = uniqueEmail();
    const existing = await passwordUser(email);

    const res = await google(googleToken({ sub: `sub-x-${Date.now()}`, email }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("account_exists_link_required");
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();

    const after = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(after.googleSubHash).toBeNull();
    expect(after.passwordHash).toBe(existing.passwordHash);
    expect(await prisma.user.count({ where: { emailHash: hashLookup(email) } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId: existing.id } })).toBe(0);
  });

  test("unverified email, wrong issuer, bad/foreign token, and unconfigured server are refused", async () => {
    const email = uniqueEmail();
    expect((await google(googleToken({ sub: "u1", email, email_verified: false }))).body.code).toBe("google_email_unverified");
    expect((await google(googleToken({ sub: "u2", email, iss: "https://evil.example" }))).body.code).toBe("google_token_invalid");
    googleToken({ sub: "u3", email });
    expect((await google("some-other-token-from-another-app-xxxx")).body.code).toBe("google_token_invalid");
    expect((await google(undefined)).status).toBe(401);

    delete process.env.GOOGLE_WEB_CLIENT_ID;
    const off = await google(googleToken({ sub: "u4", email }));
    expect(off.status).toBe(503);
    expect(off.body.code).toBe("google_not_configured");
    expect((await request(app).get("/api/auth/google/config")).body).toEqual({ enabled: false });
    process.env.GOOGLE_WEB_CLIENT_ID = WEB_CLIENT;
    expect((await request(app).get("/api/auth/google/config")).body).toEqual({ enabled: true });

    expect(await prisma.user.count({ where: { emailHash: hashLookup(email) } })).toBe(0);
  });

  test("a database failure while creating the account leaves no user behind", async () => {
    const email = uniqueEmail();
    const spy = jest.spyOn(prisma.user, "create").mockRejectedValueOnce(new Error("db down"));
    const res = await google(googleToken({ sub: `sub-db-${Date.now()}`, email }));
    expect(res.status).toBe(500);
    spy.mockRestore();
    expect(await prisma.user.count({ where: { emailHash: hashLookup(email) } })).toBe(0);
  });
});

describe("password paths for Google-only accounts", () => {
  test("password login on a Google-only account gives the same generic 401", async () => {
    const email = uniqueEmail();
    const created = await google(googleToken({ sub: `sub-pw-${Date.now()}`, email }));
    userIds.add(created.body.user.id);
    const res = await request(app).post("/api/auth/login").send({ email, password: "anything-at-all-123" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password.");
  });

  test("email registration reports account_created with method email", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "LongEnoughPassword1", name: "Eve", ga4ClientId: "999.1" });
    expect(res.status).toBe(201);
    userIds.add(res.body.user.id);
    expect(res.body.user).toEqual(expect.objectContaining({ hasPassword: true, googleLinked: false }));
    expect(sendServerGA4Event).toHaveBeenCalledWith("999.1", "account_created", { method: "email" });
  });
});

describe("linking Google to an existing account (explicit, authenticated)", () => {
  test("session + correct password links; then Google sign-in reaches the same account", async () => {
    const email = uniqueEmail();
    const user = await passwordUser(email, "MyPassword123!");
    const sub = `sub-link-${Date.now()}`;

    const linked = await request(app)
      .post("/api/auth/google/link")
      .set("Authorization", `Bearer ${sessionFor(user.id)}`)
      .send({ idToken: googleToken({ sub, email: "other-address@gmail.com" }), password: "MyPassword123!" });
    expect(linked.status).toBe(200);
    expect(linked.body.user.googleLinked).toBe(true);

    const signIn = await google(googleToken({ sub, email: "other-address@gmail.com" }));
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.id).toBe(user.id);
  });

  test("refused without a session, with a wrong password, or when the Google account is linked elsewhere", async () => {
    const a = await passwordUser(uniqueEmail(), "PasswordA1234!");
    const b = await passwordUser(uniqueEmail(), "PasswordB1234!");
    const sub = `sub-dup-${Date.now()}`;

    const noSession = await request(app).post("/api/auth/google/link").send({ idToken: googleToken({ sub, email: "x@gmail.com" }), password: "PasswordA1234!" });
    expect(noSession.status).toBe(401);

    const wrongPassword = await request(app)
      .post("/api/auth/google/link")
      .set("Authorization", `Bearer ${sessionFor(a.id)}`)
      .send({ idToken: googleToken({ sub, email: "x@gmail.com" }), password: "nope-nope-nope" });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.code).toBe("invalid_password");

    await request(app)
      .post("/api/auth/google/link")
      .set("Authorization", `Bearer ${sessionFor(a.id)}`)
      .send({ idToken: googleToken({ sub, email: "x@gmail.com" }), password: "PasswordA1234!" });
    const elsewhere = await request(app)
      .post("/api/auth/google/link")
      .set("Authorization", `Bearer ${sessionFor(b.id)}`)
      .send({ idToken: googleToken({ sub, email: "x@gmail.com" }), password: "PasswordB1234!" });
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.code).toBe("google_already_linked");
    expect((await prisma.user.findUnique({ where: { id: b.id } })).googleSubHash).toBeNull();
  });

  test("unlinking is allowed with a password, refused for Google-only accounts (no lock-out)", async () => {
    const withPw = await passwordUser(uniqueEmail(), "PasswordC1234!");
    await prisma.user.update({ where: { id: withPw.id }, data: { googleSubHash: googleSubHash(`sub-u-${Date.now()}`) } });
    const ok = await request(app).delete("/api/auth/google/link").set("Authorization", `Bearer ${sessionFor(withPw.id)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.googleLinked).toBe(false);

    const created = await google(googleToken({ sub: `sub-only-${Date.now()}`, email: uniqueEmail() }));
    userIds.add(created.body.user.id);
    const refused = await request(app).delete("/api/auth/google/link").set("Authorization", `Bearer ${created.body.accessToken}`);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("password_required");
  });
});

describe("deleting a Google-only account", () => {
  async function googleOnlyUser() {
    const email = uniqueEmail();
    const sub = `sub-del-${Date.now()}-${Math.random()}`;
    const created = await google(googleToken({ sub, email }));
    userIds.add(created.body.user.id);
    return { email, sub, token: created.body.accessToken, userId: created.body.user.id };
  }
  const challenge = (token) => request(app).post("/api/users/me/delete-challenge").set("Authorization", `Bearer ${token}`);
  const del = (token, body) => request(app).delete("/api/users/me").set("Authorization", `Bearer ${token}`).send(body);
  const sentCode = () => emailService.sendAccountDeletionCode.mock.calls.at(-1)[0].code;

  test("emailed code + fresh Google sign-in with the challenge nonce deletes the account (cascade intact)", async () => {
    const u = await googleOnlyUser();
    await prisma.trustedContact.create({ data: { userId: u.userId, name: encrypt("Sam"), phoneNumber: encrypt("+15551112222") } });
    const ch = await challenge(u.token);
    expect(ch.status).toBe(201);
    expect(emailService.sendAccountDeletionCode).toHaveBeenCalledWith({ to: u.email, code: expect.stringMatching(/^\d{6}$/) });

    const res = await del(u.token, { code: sentCode(), googleIdToken: googleToken({ sub: u.sub, email: u.email, nonce: ch.body.nonce }) });
    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: u.userId } })).toBeNull();
    expect(await prisma.trustedContact.count({ where: { userId: u.userId } })).toBe(0);
  });

  test("refused: no challenge, wrong code, missing/other nonce, stale token, different Google account, or reuse", async () => {
    const u = await googleOnlyUser();
    const fresh = (claims = {}) => googleToken({ sub: u.sub, email: u.email, ...claims });

    expect((await del(u.token, { code: "123456", googleIdToken: fresh({ nonce: "n" }) })).body.code).toBe("no_active_challenge");

    const ch = await challenge(u.token);
    const code = sentCode();
    expect((await del(u.token, { code: "000000", googleIdToken: fresh({ nonce: ch.body.nonce }) })).body.code).toBe("invalid_code");
    expect((await del(u.token, { code, googleIdToken: fresh() })).body.code).toBe("google_reauth_required");
    expect((await del(u.token, { code, googleIdToken: fresh({ nonce: "someone-elses-nonce" }) })).body.code).toBe("google_reauth_required");
    const staleIat = Math.floor(Date.now() / 1000) - 6 * 60;
    expect((await del(u.token, { code, googleIdToken: fresh({ nonce: ch.body.nonce, iat: staleIat }) })).body.code).toBe("google_reauth_required");
    expect((await del(u.token, { code, googleIdToken: googleToken({ sub: "a-different-google-account", email: u.email, nonce: ch.body.nonce }) })).body.code).toBe("google_account_mismatch");
    // Five failed tries lock the challenge — even a correct attempt now fails.
    expect((await del(u.token, { code, googleIdToken: fresh({ nonce: ch.body.nonce }) })).body.code).toBe("too_many_attempts");
    expect(await prisma.user.findUnique({ where: { id: u.userId } })).not.toBeNull();

    // A new challenge works, and can't be replayed after use.
    const ch2 = await challenge(u.token);
    const code2 = sentCode();
    const ok = await del(u.token, { code: code2, googleIdToken: fresh({ nonce: ch2.body.nonce }) });
    expect(ok.status).toBe(204);
  });

  test("a consumed challenge cannot be replayed", async () => {
    const u = await googleOnlyUser();
    const ch = await challenge(u.token);
    const code = sentCode();
    await prisma.accountDeletionChallenge.updateMany({ where: { userId: u.userId }, data: { consumedAt: new Date() } });
    const res = await del(u.token, { code, googleIdToken: googleToken({ sub: u.sub, email: u.email, nonce: ch.body.nonce }) });
    expect(res.body.code).toBe("no_active_challenge");
  });

  test("password accounts keep the password check and can't request a code", async () => {
    const user = await passwordUser(uniqueEmail(), "KeepMyPassword1!");
    const token = sessionFor(user.id);
    expect((await challenge(token)).body.code).toBe("password_account");
    expect((await del(token, { password: "wrong-password-123" })).status).toBe(401);
    expect((await del(token, { password: "KeepMyPassword1!" })).status).toBe(204);
  });
});
