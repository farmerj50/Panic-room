// Public Emergency Live View pages for trusted contacts (no Bes account).
//
//   GET  /live                       static shell — never contains a token
//   GET  /live/assets/viewer.js      first-party viewer script
//   GET  /live/api/state             viewer JSON; token in Authorization header
//   GET  /live/media/:linkId/:ref    one clip/audio, via a short-lived signed URL
//
// The link a contact receives is /live#<token>: the fragment never reaches a
// server, so tokens can't appear in proxy logs or Referer headers. viewer.js
// moves it to sessionStorage and strips it from the address bar. Responses
// are no-store / no-referrer / noindex with a CSP that allows no third-party
// code (the only external content is the Google Maps embed frame, which
// receives coordinates only). Nothing here logs a URL.

const fs = require("fs");
const path = require("path");
const express = require("express");

const { rateLimit } = require("../middleware/rateLimit");
const { renderPageHtml } = require("../utils/pageShell");
const { streamFile } = require("../services/storageService");
const liveView = require("../services/liveViewService");

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "media-src 'self'",
  "img-src 'self'",
  "frame-src https://maps.google.com https://www.google.com",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const VIEWER_JS = fs.readFileSync(path.join(__dirname, "..", "public", "live-viewer.js"), "utf8");

const VIEWER_HEAD = `<style>
  body { max-width: 760px; }
  .status { display: inline-block; font-weight: 700; border-radius: 999px; padding: 4px 12px; font-size: 0.9rem; }
  .status.active { background: #fde2e6; color: #b3132b; }
  .status.ended { background: #e8e8e8; color: #333; }
  video { width: 100%; max-height: 70vh; background: #000; border-radius: 12px; }
  iframe { width: 100%; height: 320px; border: 0; border-radius: 12px; }
  .clips { display: flex; flex-wrap: wrap; gap: 8px; }
  .clips button { padding: 6px 12px; font-weight: 600; background: #fff; border: 1px solid #bbb; }
  .clips button.current { background: #ef445b; color: #fff; border-color: #ef445b; }
  .hidden { display: none; }
</style>
<script src="/live/assets/viewer.js" defer></script>`;

const SHELL_BODY = `
<h1 id="title">Bes emergency</h1>
<p><span id="status" class="status active hidden"></span> <span id="started" class="muted"></span></p>
<div id="message" class="card">Loading…</div>
<noscript><div class="card">This page needs JavaScript to show the live video and location.</div></noscript>
<section id="video-section" class="hidden">
  <h2>Latest recording</h2>
  <video id="player" controls playsinline muted preload="metadata"></video>
  <p id="clip-label" class="muted"></p>
  <div id="clips" class="clips"></div>
</section>
<section id="audio-section" class="hidden">
  <h2>Audio recording</h2>
  <audio id="audio" controls preload="none"></audio>
</section>
<section id="location-section" class="hidden">
  <h2>Last known location</h2>
  <p id="location-text"></p>
  <iframe id="map" title="Map of last known location" loading="lazy" referrerpolicy="no-referrer"></iframe>
  <p><a id="maps-link" target="_blank" rel="noopener noreferrer">Open in Maps</a></p>
</section>
<p class="muted">If you believe this person is in danger, call your local emergency number. This private link was sent to you by a Bes user and stops working when it expires or is turned off.</p>
<p class="muted">Bes · <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></p>`;

function protect(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Security-Policy", CSP);
  next();
}

function requireEnabled(req, res, next) {
  if (!liveView.isLiveViewEnabled()) return res.status(404).type("text/plain").send("Not found");
  next();
}

const byIp = (scope) => (req) => `live:${scope}:${req.ip}`;

const router = express.Router();
router.use(protect, requireEnabled);

router.get("/", rateLimit({ windowMs: 15 * 60 * 1000, max: 120, keyGenerator: byIp("page") }), (req, res) => {
  res.status(200).type("html").send(renderPageHtml("Emergency live view", SHELL_BODY, { head: VIEWER_HEAD }));
});

router.get("/assets/viewer.js", (req, res) => {
  res.status(200).type("application/javascript").send(VIEWER_JS);
});

router.get(
  "/api/state",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300, keyGenerator: byIp("state") }),
  async (req, res) => {
    try {
      const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""))?.[1];
      const { link, state } = await liveView.findByToken(token);
      if (state === "invalid") return res.status(404).json({ state: "invalid" });
      if (state !== "valid") return res.status(410).json({ state });
      res.json({ state, ...(await liveView.viewerState(link, { countOpen: req.query.open === "1" })) });
    } catch {
      res.status(500).json({ state: "error" });
    }
  }
);

router.get(
  "/media/:linkId/:ref",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, keyGenerator: byIp("media") }),
  async (req, res) => {
    try {
      const key = await liveView.resolveMedia({
        linkId: req.params.linkId,
        ref: req.params.ref,
        g: req.query.g,
        exp: req.query.exp,
        sig: req.query.sig,
      });
      if (!key || !streamFile(key, req, res)) return res.status(404).type("text/plain").send("Not found");
    } catch {
      if (!res.headersSent) res.status(404).type("text/plain").send("Not found");
    }
  }
);

module.exports = router;
