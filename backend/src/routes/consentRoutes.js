// Public, server-rendered SMS consent pages. Two routers:
//   /sms-consent/:token  — a contact's private, single-use invitation
//   /sms-alerts          — the permanent program page (Twilio verification
//                          reference); never tied to a real invitation
//
// Token hygiene: the token lives only in the URL path. It is never echoed in
// the HTML or any link (forms post back to the same URL), responses are
// no-store / no-referrer / noindex with a CSP that allows no external
// resources, errors render a generic page, and nothing here logs the URL.

const fs = require("fs");
const path = require("path");
const express = require("express");

const { rateLimit } = require("../middleware/rateLimit");
const { escapeHtml, markdownToHtml, renderPageHtml } = require("../utils/pageShell");
const { hashLookup } = require("../services/cryptoService");
const { getInviteForPage, respondToInvite, consentTextFor } = require("../services/smsConsentService");

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function protectPage(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", CSP);
  next();
}

function sendPage(res, status, title, bodyHtml) {
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderPageHtml(title, bodyHtml));
}

const footer = `<p class="muted">Bes · <a href="/sms-alerts">About Bes emergency text alerts</a> · <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></p>`;

const RESULT_PAGES = {
  accepted: ["You're signed up", "<p>You'll get a text from Bes only if this person activates an emergency. Reply <strong>STOP</strong> to any Bes alert to opt out at any time, or <strong>HELP</strong> for help.</p><p class=\"muted\">If you previously replied STOP to Bes texts, reply <strong>START</strong> to resume.</p>"],
  declined: ["No alerts will be sent", "<p>You won't receive Bes emergency texts at this number. They can still list you as a contact, and they can send you a new invitation if you change your mind.</p>"],
  used: ["This link was already used", "<p>This invitation has already been answered. Ask for a new invitation if you want to change your choice.</p>"],
  expired: ["This link has expired", "<p>Invitations expire after 14 days. Ask for a new one.</p>"],
  revoked: ["This link is no longer valid", "<p>A newer invitation was sent or this one was cancelled. Use the most recent link you received.</p>"],
  number_changed: ["This invitation is out of date", "<p>The phone number for this contact has changed since the invitation was sent. Ask for a new invitation.</p>"],
  invalid: ["Link not found", "<p>This invitation link isn't valid. Check that you opened the full link.</p>"],
};

function resultPage(res, result) {
  const [title, body] = RESULT_PAGES[result] || RESULT_PAGES.invalid;
  const status = result === "accepted" || result === "declined" ? 200 : result === "invalid" ? 404 : 410;
  sendPage(res, status, title, `<h1>${title}</h1>${body}${footer}`);
}

function genericError(res) {
  sendPage(res, 500, "Something went wrong", `<h1>Something went wrong</h1><p>Please try the link again in a moment.</p>${footer}`);
}

// ── /sms-consent/:token ───────────────────────────────────────────────────
const consentRouter = express.Router();
consentRouter.use(protectPage);
consentRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }));
consentRouter.use(express.urlencoded({ extended: false, limit: "2kb" }));

consentRouter.get("/:token", async (req, res) => {
  try {
    const page = await getInviteForPage(req.params.token);
    if (page.state !== "valid") return resultPage(res, page.state);

    const name = escapeHtml(page.inviterName);
    sendPage(
      res,
      200,
      "Emergency text alerts",
      `<h1>${name} added you as a trusted contact</h1>
<p>${name} uses <strong>Bes</strong>, a personal safety app, and wants you to get a text alert if they ever activate an emergency.</p>
<div class="card">
  <p><strong>Alerts will be sent to: ${escapeHtml(page.maskedPhone)}</strong></p>
  <p>${escapeHtml(consentTextFor(page.inviterName))}</p>
</div>
<p class="muted">You don't need the Bes app. Declining has no effect on ${name}'s account. Read our <a href="/legal/privacy">Privacy Policy</a> and <a href="/legal/terms">Terms</a>.</p>
<form method="post">
  <div class="actions">
    <button class="primary" type="submit" name="choice" value="accept">Accept SMS Alerts</button>
    <button class="secondary" type="submit" name="choice" value="decline">Decline</button>
  </div>
</form>
${footer}`,
    );
  } catch {
    genericError(res);
  }
});

consentRouter.post("/:token", async (req, res) => {
  try {
    const choice = req.body?.choice;
    if (choice !== "accept" && choice !== "decline") return resultPage(res, "invalid");
    const { result } = await respondToInvite(req.params.token, choice, {
      ipHash: req.ip ? hashLookup(`ip:${req.ip}`) : null,
    });
    resultPage(res, result);
  } catch {
    genericError(res);
  }
});

// ── /sms-alerts (permanent program page) ─────────────────────────────────
const programRouter = express.Router();
const programMd = path.join(__dirname, "..", "legal", "sms-alerts.md");

programRouter.get("/", protectPage, (req, res) => {
  let markdown;
  try {
    markdown = fs.readFileSync(programMd, "utf8");
  } catch {
    return genericError(res);
  }
  // The consent wording comes from the same constant the invitation page
  // shows, so this page can never drift from what contacts actually see.
  const wording = consentTextFor("[the Bes user]");
  res.removeHeader("X-Robots-Tag"); // public program page — fine to index
  sendPage(res, 200, "Emergency Text Alerts", markdownToHtml(markdown.replace("{{CONSENT_TEXT}}", wording)));
});

module.exports = { consentRouter, programRouter };
