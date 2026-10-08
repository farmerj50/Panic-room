// Emergency Social Sharing — auto prompt + Publishing flow, end to end.
//
// LOCAL BACKEND ONLY: needs an APK built with
// EXPO_PUBLIC_API_URL=http://10.0.2.2:5055 (the app's network security config
// already allows cleartext to 10.0.2.2) and the local backend running on
// :5055. Skipped unless E2E_LOCAL_BACKEND=1, so the default suite never
// seeds anything or depends on a local server.
//
// The account is a fresh @panicroom.test registration with zero trusted
// contacts (asserted below), so activating an emergency texts nobody. Its
// TikTok/Instagram connections use FAKE tokens, so the providers reject
// every post — the flow is exercised fully, but nothing is published.
const fs = require('fs');
const path = require('path');

const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

const RUN = process.env.E2E_LOCAL_BACKEND === '1';
const SHOTS = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots', 'social-sharing');

// The overlay sets testID only (no accessibilityLabel, to keep its buttons'
// spoken labels human-readable), which Android exposes as resource-id.
const byId = (id) => $(`android=new UiSelector().resourceId("${id}")`);

// "Wait until gone" via fresh element counts. Polling isDisplayed() on an
// element that has just unmounted makes UiAutomator2 hang 7-12s per call
// (stale-element lookup), which blew past even 20s budgets while the UI had
// long since updated. findElements on a fresh query returns immediately.
async function waitGone(id, timeout = 15000) {
  const selector = `android=new UiSelector().resourceId("${id}")`;
  await driver.waitUntil(async () => (await $$(selector).length) === 0, {
    timeout,
    interval: 500,
    timeoutMsg: `${id} was still on screen after ${timeout}ms`,
  });
}

// The review step must show the clip it will post — a real, non-zero box
// (a collapsed 0-width preview slipped past unit tests once).
async function expectVisiblePreview() {
  const preview = byId('social-share-preview');
  await preview.waitForDisplayed({ timeout: 10000 });
  const { width, height } = await preview.getSize();
  console.log(`preview size: ${width}x${height}`);
  expect(width).toBeGreaterThan(50);
  expect(height).toBeGreaterThan(50);
}

let shotIndex = 0;
async function shot(name) {
  shotIndex += 1;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await browser.saveScreenshot(file);
  console.log(`screenshot: ${file}`);
}

(RUN ? describe : describe.skip)('Emergency social sharing (local backend)', () => {
  const db = RUN ? require('../helpers/socialSharingDb') : null;
  const email = `e2e-share-${Date.now()}@panicroom.test`;

  // UiAutomator2 waits for the app to go idle before every query, and a
  // live camera preview never does — observed: a single isDisplayed() call
  // hung ~12s as the prompt unmounted, blowing a 10s wait. Don't wait for idle.
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
  });

  after(async () => {
    if (db) await db.disconnect();
  });

  it('registers a fresh account and gives it fake-token TikTok + Instagram connections', async () => {
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });

    expect(await db.trustedContactCount(email)).toBe(0); // safety: no SMS can go out
    await db.seedFakeSocialConnections(email);
    await shot('home-before-emergency');
  });

  it('auto prompt appears once recording, counts down, and only hides on timeout', async () => {
    await tabBar.emergencyBtn.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await shot('countdown');
    await emergencyPage.waitForLiveScreen(30000);
    await emergencyPage.waitForRecordingPhase(30000);

    await byId('social-share-prompt').waitForDisplayed({ timeout: 15000 });
    await shot('auto-prompt-countdown');
    const firstText = await byId('social-share-countdown').getText();
    await driver.pause(1500);
    const laterText = await byId('social-share-countdown').getText();
    console.log(`prompt countdown: "${firstText}" -> "${laterText}"`);
    expect(laterText).not.toEqual(firstText);

    // Timeout = dismiss. Must not post, must not open review.
    await waitGone('social-share-prompt', 20000);
    expect(await byId('social-share-publishing').isExisting()).toBe(false);
    expect(await byId('social-share-progress').isExisting()).toBe(false);
    await shot('auto-prompt-timed-out-hidden');

    // One-shot: it does not come back for this emergency.
    await driver.pause(7000);
    expect(await byId('social-share-prompt').isExisting()).toBe(false);
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
  });

  it('manual Share → TikTok: cuts a segment only because none exists, defaults to SELF_ONLY, Public disabled', async () => {
    const before = await db.latestEmergencySegments(email);
    console.log(`segments before first share: [${before}]`);

    await $('~emergency-share-btn').click();
    await byId('social-share-pick').waitForDisplayed({ timeout: 10000 });
    await shot('provider-picker');
    await byId('social-share-pick-tiktok').click();
    await byId('social-share-pick-continue').click();

    await byId('social-share-publishing').waitForDisplayed({ timeout: 10000 });
    await shot('tiktok-review-preparing-video');

    // Wait until a segment is resolved (Share enabled) or "no video" shows.
    await driver.waitUntil(
      async () =>
        (await byId('social-share-retry-video').isExisting()) ||
        (await byId('social-share-publish').getAttribute('enabled')) === 'true',
      { timeout: 60000, interval: 1000, timeoutMsg: 'review never resolved a video' },
    );
    const after = await db.latestEmergencySegments(email);
    console.log(`segments after TikTok review resolved: [${after}]`);
    if (before.length === 0) expect(after.length).toBe(1); // exactly one cut, only because none existed

    await expectVisiblePreview();
    await byId('social-share-privacy-SELF_ONLY').waitForDisplayed({ timeout: 15000 });
    expect(await byId('social-share-privacy-SELF_ONLY').getAttribute('selected')).toBe('true');
    expect(await byId('social-share-privacy-PUBLIC_TO_EVERYONE').getAttribute('enabled')).toBe('false');
    await shot('tiktok-review-ready-self-only');

    await byId('social-share-caption').setValue('E2E test caption - not a real post');
    try { await driver.hideKeyboard(); } catch {}
    await shot('tiktok-review-with-caption');

    await byId('social-share-publish').click();
    // Progress may be brief; capture it if we can.
    if (await byId('social-share-progress').isExisting()) await shot('tiktok-progress');
    await byId('social-share-result').waitForDisplayed({ timeout: 60000 });
    await shot('tiktok-result-fake-token-rejected');

    await byId('social-share-done').click();
    await waitGone('social-share-overlay', 10000);
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
  });

  it('manual Share → Instagram reuses the uploaded segment — no new cut — and is always Public', async () => {
    const before = await db.latestEmergencySegments(email);
    console.log(`segments before Instagram share: [${before}]`);
    expect(before.length).toBeGreaterThan(0);

    await $('~emergency-share-btn').click();
    await byId('social-share-pick').waitForDisplayed({ timeout: 10000 });
    await byId('social-share-pick-instagram').click();
    await byId('social-share-pick-continue').click();
    await byId('social-share-publishing').waitForDisplayed({ timeout: 10000 });
    await driver.waitUntil(
      async () => (await byId('social-share-publish').getAttribute('enabled')) === 'true',
      { timeout: 20000, interval: 500, timeoutMsg: 'Instagram review never resolved a video' },
    );
    await expectVisiblePreview();
    await shot('instagram-review-public-only');

    const after = await db.latestEmergencySegments(email);
    console.log(`segments after Instagram review resolved: [${after}]`);
    expect(after).toEqual(before); // reused — the camera was not interrupted

    await byId('social-share-publish').click();
    await byId('social-share-result').waitForDisplayed({ timeout: 90000 });
    await shot('instagram-result-fake-token-rejected');
    await byId('social-share-done').click();
    await waitGone('social-share-overlay', 10000);
  });

  it('Cancel on the review step posts nothing and returns to the live screen', async () => {
    await $('~emergency-share-btn').click();
    await byId('social-share-pick').waitForDisplayed({ timeout: 10000 });
    await byId('social-share-pick-tiktok').click();
    await byId('social-share-pick-continue').click();
    await byId('social-share-publishing').waitForDisplayed({ timeout: 10000 });
    await byId('social-share-cancel').click();
    await waitGone('social-share-overlay', 10000);
    await shot('review-cancelled-back-to-live');
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
  });

  it('a new emergency gets a fresh prompt, and Skip dismisses it', async () => {
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
    await tabBar.emergencyBtn.click();
    await emergencyPage.waitForLiveScreen(30000);
    await emergencyPage.waitForRecordingPhase(30000);

    await byId('social-share-prompt').waitForDisplayed({ timeout: 15000 });
    await byId('social-share-prompt-skip').click();
    await waitGone('social-share-overlay', 5000);
    await shot('second-emergency-prompt-skipped');
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);

    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
    await shot('exited-cleanly-home');
  });
});
