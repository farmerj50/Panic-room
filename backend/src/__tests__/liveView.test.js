const request = require("supertest");
const jwt = require("jsonwebtoken");

jest.mock("../services/smsServices", () => {
  const actual = jest.requireActual("../services/smsServices");
  return { ...actual, sendAlertSms: jest.fn(), listSentMessages: jest.fn() };
});
const smsServices = require("../services/smsServices");

const app = require("../app");
const prisma = require("../config/db");
const { encrypt, hashLookup } = require("../services/cryptoService");
const { deleteUserFiles, saveFile } = require("../services/storageService");
const liveView = require("../services/liveViewService");
const errorMiddleware = require("../middleware/errorMiddleware");

const BASE = "https://bes.test";
const PHONE_A = "+15551240001";
const PHONE_B = "+15551240002";
const hashOf = (phone) => hashLookup(phone.replace(/\D/g, ""));
const CLIP = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"); // stands in for an mp4

let userIds = [];
const saved = {};

async function makeUser(name = "Alex Rivera") {
  const email = `live_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: { emailHash: hashLookup(email), emailEncrypted: encrypt(email), nameEncrypted: encrypt(name), passwordHash: "unused" },
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

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function activate(token, body = { latitude: 40.7128, longitude: -74.006 }) {
  const res = await request(app).post("/api/emergency").set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.id;
}

async function addClip(token, userId, emergencyId, sequence) {
  const key = saveFile({ userId, buffer: CLIP, ext: "mp4" });
  const res = await request(app)
    .post(`/api/emergency/${emergencyId}/video-segments`)
    .set(auth(token))
    .send({ fileUrl: key, facing: "back", sequence, startedAt: new Date().toISOString() });
  expect(res.status).toBe(201);
  return key;
}

async function share(token, emergencyId, contactId) {
  return request(app).post(`/api/emergency/${emergencyId}/live-view/${contactId}/share`).set(auth(token));
}

const tokenOf = (url) => new URL(url).hash.slice(1);
const state = (viewerToken, query = "") => request(app).get(`/live/api/state${query}`).set("Authorization", `Bearer ${viewerToken}`);

async function setup() {
  const owner = await makeUser();
  const contact = await makeContact(owner.userId);
  const emergencyId = await activate(owner.token);
  const shared = await share(owner.token, emergencyId, contact.id);
  expect(shared.status).toBe(200);
  return { ...owner, contact, emergencyId, url: shared.body.url, viewerToken: tokenOf(shared.body.url) };
}

beforeAll(() => {
  for (const key of ["PUBLIC_BASE_URL", "LIVE_VIEW_ENABLED", "SMS_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) {
    saved[key] = process.env[key];
  }
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "f".repeat(32);
  process.env.TWILIO_FROM_NUMBER = "+18775550000";
});

beforeEach(() => {
  process.env.LIVE_VIEW_ENABLED = "true";
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const id of userIds) deleteUserFiles(id);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("Live View switched off", () => {
  test("no links are created, /live is 404, but GPS and clips still upload", async () => {
    process.env.LIVE_VIEW_ENABLED = "false";
    const { userId, token } = await makeUser();
    await makeContact(userId);
    const emergencyId = await activate(token);

    expect(await prisma.liveViewLink.count({ where: { emergencyId } })).toBe(0);
    expect((await request(app).get("/live")).status).toBe(404);
    expect((await request(app).get("/live/api/state")).status).toBe(404);

    const point = await request(app)
      .post(`/api/emergency/${emergencyId}/locations`)
      .set(auth(token))
      .send({ latitude: 40.7, longitude: -74, recordedAt: new Date().toISOString() });
    expect(point.status).toBe(201);
    await addClip(token, userId, emergencyId, 1);

    const status = await request(app).get(`/api/emergency/${emergencyId}/live-view`).set(auth(token));
    expect(status.body).toEqual({ enabled: false, links: [] });
  });

  test("activation still succeeds when link issuing throws", async () => {
    jest.spyOn(liveView, "ensureLinks").mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { userId, token } = await makeUser();
    await makeContact(userId);
    const res = await request(app).post("/api/emergency").set(auth(token)).send({ latitude: 1, longitude: 2 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
  });
});

describe("link lifecycle", () => {
  test("activation creates one link per contact; only a hash and an encrypted token are stored", async () => {
    const { userId, token } = await makeUser();
    const a = await makeContact(userId, PHONE_A);
    const b = await makeContact(userId, PHONE_B);
    const emergencyId = await activate(token);
    const links = await prisma.liveViewLink.findMany({ where: { emergencyId } });
    expect(links.map((l) => l.contactId).sort()).toEqual([a.id, b.id].sort());

    const shared = await share(token, emergencyId, a.id);
    const raw = tokenOf(shared.body.url);
    expect(shared.body.url).toBe(`${BASE}/live#${raw}`);
    const row = await prisma.liveViewLink.findFirst({ where: { emergencyId, contactId: a.id } });
    expect(JSON.stringify(row)).not.toContain(raw);
  });

  test("sharing again returns the SAME link and never disconnects the viewer", async () => {
    const ctx = await setup();
    expect((await state(ctx.viewerToken)).status).toBe(200);
    const again = await share(ctx.token, ctx.emergencyId, ctx.contact.id);
    expect(again.body.url).toBe(ctx.url);
    expect((await state(ctx.viewerToken)).status).toBe(200);
  });

  test("an explicit reset issues a new link and the old one stops working", async () => {
    const ctx = await setup();
    const rotated = await request(app)
      .post(`/api/emergency/${ctx.emergencyId}/live-view/${ctx.contact.id}/rotate`)
      .set(auth(ctx.token));
    expect(rotated.status).toBe(200);
    expect(rotated.body.url).not.toBe(ctx.url);
    expect((await state(ctx.viewerToken)).status).toBe(404);
    expect((await state(tokenOf(rotated.body.url))).status).toBe(200);
  });

  test("revoked, expired (24h after end), past the 72h cap, and number-changed links are 410", async () => {
    const revoked = await setup();
    await request(app).delete(`/api/emergency/${revoked.emergencyId}/live-view`).set(auth(revoked.token));
    expect((await state(revoked.viewerToken)).body).toEqual({ state: "revoked" });

    const ended = await setup();
    await prisma.emergencyEvent.update({
      where: { id: ended.emergencyId },
      data: { status: "RESOLVED", endedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const endedRes = await state(ended.viewerToken);
    expect(endedRes.status).toBe(410);
    expect(endedRes.body.state).toBe("expired");

    const capped = await setup();
    await prisma.liveViewLink.updateMany({
      where: { emergencyId: capped.emergencyId },
      data: { hardExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await state(capped.viewerToken)).body.state).toBe("expired");

    const changed = await setup();
    await prisma.trustedContact.update({ where: { id: changed.contact.id }, data: { phoneHash: hashOf(PHONE_B) } });
    expect((await state(changed.viewerToken)).body.state).toBe("number_changed");
  });

  test("changing a contact's number in the app revokes their link", async () => {
    const ctx = await setup();
    const res = await request(app).patch(`/api/contacts/${ctx.contact.id}`).set(auth(ctx.token)).send({ phoneNumber: PHONE_B });
    expect(res.status).toBe(200);
    expect((await state(ctx.viewerToken)).status).toBe(410);
  });

  test("a resolved emergency stays viewable until 24h after it ended", async () => {
    const ctx = await setup();
    await request(app).patch(`/api/emergency/${ctx.emergencyId}`).set(auth(ctx.token)).send({ status: "RESOLVED" });
    const res = await state(ctx.viewerToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ended");
  });

  test("a guessed token is 404, and deleting the contact or account kills the link", async () => {
    expect((await state("A".repeat(43))).status).toBe(404);
    expect((await state("")).status).toBe(404);

    const ctx = await setup();
    await prisma.trustedContact.delete({ where: { id: ctx.contact.id } });
    expect((await state(ctx.viewerToken)).status).toBe(404);

    const acct = await setup();
    await prisma.user.delete({ where: { id: acct.userId } });
    userIds = userIds.filter((id) => id !== acct.userId);
    expect((await state(acct.viewerToken)).status).toBe(404);
  });

  test("another user can't share, reset or revoke someone else's links", async () => {
    const ctx = await setup();
    const stranger = await makeUser("Eve Stranger");
    const base = `/api/emergency/${ctx.emergencyId}/live-view`;
    expect((await request(app).post(`${base}/${ctx.contact.id}/share`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`${base}/${ctx.contact.id}/rotate`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).delete(base).set(auth(stranger.token))).status).toBe(404);
    expect((await state(ctx.viewerToken)).status).toBe(200);
  });

  test("owner status reports opens only to the owner, counting page opens (not polls)", async () => {
    const ctx = await setup();
    await state(ctx.viewerToken, "?open=1");
    await state(ctx.viewerToken);
    await state(ctx.viewerToken);
    const res = await request(app).get(`/api/emergency/${ctx.emergencyId}/live-view`).set(auth(ctx.token));
    expect(res.body.enabled).toBe(true);
    expect(res.body.links).toEqual([
      expect.objectContaining({ contactId: ctx.contact.id, active: true, viewCount: 1, lastViewedAt: expect.any(String) }),
    ]);
  });

  test("revoking still works when Live View is switched off", async () => {
    const ctx = await setup();
    process.env.LIVE_VIEW_ENABLED = "false";
    const res = await request(app).delete(`/api/emergency/${ctx.emergencyId}/live-view/${ctx.contact.id}`).set(auth(ctx.token));
    expect(res.body.revoked).toBe(1);
    process.env.LIVE_VIEW_ENABLED = "true";
    expect((await state(ctx.viewerToken)).status).toBe(410);
  });
});

describe("viewer page and data", () => {
  test("the page is a static shell: protective headers, strict CSP, no token, no third-party code", async () => {
    const res = await request(app).get("/live");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const scripts = [...res.text.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(["/live/assets/viewer.js"]);
    expect(res.text).not.toMatch(/<link[^>]+href="https?:/);
    expect(res.text).not.toMatch(/analytics|googletagmanager|gtag\(/i);

    const js = await request(app).get("/live/assets/viewer.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.text).toContain("history.replaceState");
  });

  test("state shows only this emergency: first name, clips, latest GPS — no identities, keys or tokens", async () => {
    const ctx = await setup();
    const key = await addClip(ctx.token, ctx.userId, ctx.emergencyId, 1);
    await addClip(ctx.token, ctx.userId, ctx.emergencyId, 2);
    const recordedAt = new Date().toISOString();
    await request(app)
      .post(`/api/emergency/${ctx.emergencyId}/locations`)
      .set(auth(ctx.token))
      .send({ latitude: 40.75, longitude: -73.98, recordedAt });

    // A second emergency of the same owner must not leak into this view.
    const otherEmergency = await activate(ctx.token);
    await addClip(ctx.token, ctx.userId, otherEmergency, 1);
    await addClip(ctx.token, ctx.userId, otherEmergency, 2);
    await addClip(ctx.token, ctx.userId, otherEmergency, 3);

    const res = await state(ctx.viewerToken);
    expect(res.status).toBe(200);
    expect(res.body.ownerFirstName).toBe("Alex");
    expect(res.body.status).toBe("active");
    expect(res.body.segments.map((s) => s.sequence)).toEqual([1, 2]);
    expect(res.body.latestLocation).toEqual(expect.objectContaining({ latitude: 40.75, longitude: -73.98, recordedAt }));

    const text = JSON.stringify(res.body);
    for (const secret of ["Rivera", "Sam", PHONE_A, PHONE_A.slice(-4), key, ctx.viewerToken, ctx.userId, ctx.contact.id, otherEmergency]) {
      expect(text).not.toContain(secret);
    }
  });

  test("falls back to the activation location before any live GPS arrives", async () => {
    const ctx = await setup();
    const res = await state(ctx.viewerToken);
    expect(res.body.latestLocation).toEqual(expect.objectContaining({ latitude: 40.7128, longitude: -74.006 }));
    expect(res.body.recentLocations).toEqual([]);
  });
});

describe("media access", () => {
  async function withClip() {
    const ctx = await setup();
    await addClip(ctx.token, ctx.userId, ctx.emergencyId, 1);
    const media = (await state(ctx.viewerToken)).body.segments[0].mediaUrl;
    return { ...ctx, media };
  }

  test("streams the clip, with HTTP Range support for video players", async () => {
    const ctx = await withClip();
    const full = await request(app).get(ctx.media).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(full.status).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.body.equals(CLIP)).toBe(true);

    const part = await request(app).get(ctx.media).set("Range", "bytes=10-19").buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 10-19/${CLIP.length}`);
    expect(part.body.toString()).toBe("abcdefghij");

    const tail = await request(app).get(ctx.media).set("Range", "bytes=-6");
    expect(tail.status).toBe(206);
    expect(tail.headers["content-range"]).toBe(`bytes ${CLIP.length - 6}-${CLIP.length - 1}/${CLIP.length}`);

    expect((await request(app).get(ctx.media).set("Range", "bytes=999-")).status).toBe(416);
  });

  test("a media URL stops working immediately after revoke or reset, within its 10 minutes", async () => {
    const revoked = await withClip();
    await request(app).delete(`/api/emergency/${revoked.emergencyId}/live-view`).set(auth(revoked.token));
    expect((await request(app).get(revoked.media)).status).toBe(404);

    const reset = await withClip();
    await request(app).post(`/api/emergency/${reset.emergencyId}/live-view/${reset.contact.id}/rotate`).set(auth(reset.token));
    expect((await request(app).get(reset.media)).status).toBe(404);
  });

  test("tampered, expired, or cross-emergency media URLs are refused", async () => {
    const ctx = await withClip();
    const url = new URL(ctx.media, BASE);

    const badSig = new URL(url);
    badSig.searchParams.set("sig", "x" + url.searchParams.get("sig").slice(1));
    expect((await request(app).get(badSig.pathname + badSig.search)).status).toBe(404);

    const otherSeq = url.pathname.replace(/v1$/, "v2");
    expect((await request(app).get(otherSeq + url.search)).status).toBe(404);

    const link = await prisma.liveViewLink.findFirst({ where: { emergencyId: ctx.emergencyId } });
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + liveView.MEDIA_URL_TTL_MS + 1000);
    expect((await request(app).get(ctx.media)).status).toBe(404);
    jest.restoreAllMocks();

    // Another emergency's link can't reach this emergency's clip.
    const other = await withClip();
    const foreign = ctx.media.replace(link.id, (await prisma.liveViewLink.findFirst({ where: { emergencyId: other.emergencyId } })).id);
    expect((await request(app).get(foreign)).status).toBe(404);
  });
});

describe("secrets never reach logs", () => {
  test("error logging redacts Live View paths, media signatures, consent tokens and bearer tokens", () => {
    const logged = [];
    jest.spyOn(console, "error").mockImplementation((...args) => logged.push(args.join(" ")));
    const res = { status: () => ({ json: () => {} }) };
    const viewerToken = "Zx9" + "q".repeat(40);
    errorMiddleware(
      new Error(`boom Bearer ${viewerToken} at /sms-consent/secretInviteToken123`),
      { method: "GET", originalUrl: "/live/media/1234-abcd/v1?g=0&exp=99&sig=SIGNATURESECRET" },
      res,
      () => {}
    );
    const output = logged.join("\n");
    expect(output).toContain("/live/media/***");
    for (const secret of [viewerToken, "SIGNATURESECRET", "secretInviteToken123", "1234-abcd"]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe("SMS alerts with Live View", () => {
  test("each consenting contact's text carries only their own link, and dispatch never rotates it", async () => {
    process.env.SMS_ENABLED = "true";
    let sidCounter = 0;
    smsServices.sendAlertSms.mockImplementation(async () => ({ sid: "SM" + String(++sidCounter).padStart(32, "0") }));
    const { userId, token } = await makeUser();
    const a = await makeContact(userId, PHONE_A, { smsConsentStatus: "accepted", smsConsentPhoneHash: hashOf(PHONE_A) });
    const b = await makeContact(userId, PHONE_B, { smsConsentStatus: "accepted", smsConsentPhoneHash: hashOf(PHONE_B) });
    const emergencyId = await activate(token);
    const urlA = (await share(token, emergencyId, a.id)).body.url;
    const urlB = (await share(token, emergencyId, b.id)).body.url;

    const res = await request(app).post(`/api/emergency/${emergencyId}/notify`).set(auth(token)).send({});
    expect(res.body.queuedCount).toBe(2);
    const bodies = Object.fromEntries(smsServices.sendAlertSms.mock.calls.map(([arg]) => [arg.to, arg.body]));
    expect(bodies[PHONE_A]).toContain(`Live view: ${urlA}`);
    expect(bodies[PHONE_A]).not.toContain(urlB);
    expect(bodies[PHONE_B]).toContain(`Live view: ${urlB}`);

    // Links unchanged after dispatch.
    expect((await share(token, emergencyId, a.id)).body.url).toBe(urlA);
    const hashes = await prisma.smsMessage.findMany({ where: { emergencyId }, select: { bodyHash: true } });
    expect(new Set(hashes.map((h) => h.bodyHash)).size).toBe(2);
    process.env.SMS_ENABLED = saved.SMS_ENABLED ?? "";
  });

  test("a contact who hasn't accepted SMS still gets a viewable link, but no text", async () => {
    process.env.SMS_ENABLED = "true";
    smsServices.sendAlertSms.mockResolvedValue({ sid: "SM" + "2".repeat(32) });
    const { userId, token } = await makeUser();
    const pending = await makeContact(userId, PHONE_A);
    const emergencyId = await activate(token);
    await request(app).post(`/api/emergency/${emergencyId}/notify`).set(auth(token)).send({});
    expect(smsServices.sendAlertSms).not.toHaveBeenCalled();
    const shared = await share(token, emergencyId, pending.id);
    expect((await state(tokenOf(shared.body.url))).status).toBe(200);
    process.env.SMS_ENABLED = saved.SMS_ENABLED ?? "";
  });
});
