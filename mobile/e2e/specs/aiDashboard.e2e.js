// AI Threat Monitor dashboard (Phase 2). Needs a build with
// EXPO_PUBLIC_AI_MONITOR_ENABLED=1, EXPO_PUBLIC_AI_THREATS_ENABLED=1 and
// EXPO_PUBLIC_AI_TEST_HOOKS=1, so it's skipped unless E2E_AI_THREATS=1.
// The emulator camera can't show real falls or crowds: event cards come from
// the test-build replay buttons (synthetic clips through the real engine).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

const enabled = process.env.E2E_AI_THREATS === '1';
const SHOTS = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', 'screenshots', 'ai-dashboard');
const PKG = 'com.ginslayer.besapp';
const shot = (name) => browser.saveScreenshot(path.join(SHOTS, `${name}.png`));
const adb = (...args) => execFileSync('adb', ['-s', 'emulator-5554', ...args], { encoding: 'utf8' });
const byDesc = (d) => $(`~${d}`);
const monitorStatus = (s) => byDesc(`ai-monitor-status-${s}`);
const threatStatus = (s) => byDesc(`threat-status-${s}`);

// Scrolls the monitor screen (or Home) until an element with this
// content-description is on screen.
const scrollTo = async (desc) => {
  const el = $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${desc}"))`);
  await el.waitForExist({ timeout: 10000 });
  return el;
};
const scrollToText = (text) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("${text}"))`);
const scrollToTop = () => $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollToBeginning(10)').isExisting().catch(() => false);
const tap = async (desc) => (await scrollTo(desc)).click();

async function openMonitor() {
  await tabBar.homeBtn.click();
  const card = await scrollTo('home-ai-monitor-card');
  const r = await driver.getElementRect(await card.elementId);
  const y = Math.min(Math.max(r.y, 250) + 60, r.y + r.height - 20);
  await driver.execute('mobile: clickGesture', { x: Math.round(r.x + r.width / 2), y: Math.round(y) });
  await byDesc('ai-monitor-start-btn').waitForDisplayed({ timeout: 15000 });
}

async function startRunning() {
  await byDesc('ai-monitor-start-btn').click();
  await monitorStatus('running').waitForExist({ timeout: 20000 });
}

// After the warm-up the dashboard settles on a judgment about the input. On
// the emulator the model often runs below 2 fps, which correctly reads as
// unreliable input; on a phone it's normally "no threat".
async function waitSettled() {
  await browser.waitUntil(
    async () => {
      for (const s of ['no_threat', 'unreliable_input', 'insufficient_evidence', 'detector_unavailable']) {
        if (await threatStatus(s).isExisting().catch(() => false)) return true;
      }
      return false;
    },
    { timeout: 20000, timeoutMsg: 'dashboard did not settle after the warm-up' },
  );
  return $('android=new UiSelector().resourceId("threat-status")').getAttribute('content-desc');
}

async function stopIfRunning() {
  await scrollToTop();
  const stop = byDesc('ai-monitor-stop-btn');
  if (await stop.isExisting().catch(() => false)) await stop.click();
}

async function clearEvents() {
  const clear = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("threat-events-clear"))');
  if (await clear.isExisting().catch(() => false)) await clear.click();
}

(enabled ? describe : describe.skip)('AI Threat Monitor dashboard', () => {
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    const email = `e2e-aidash-${Date.now()}@panicroom.test`;
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  beforeEach(async () => {
    adb('emu', 'sensor', 'set', 'gyroscope', '0:0:0');
    await stopIfRunning();
    for (let i = 0; i < 3; i += 1) {
      if (await tabBar.homeBtn.isExisting().catch(() => false)) break;
      if (await emergencyPage.cancelBtn.isExisting().catch(() => false)) await emergencyPage.cancelBtn.click();
      else if (await emergencyPage.exitBtn.isExisting().catch(() => false)) await emergencyPage.exitBtn.click();
      else await driver.back();
      await driver.pause(1000);
    }
  });

  it('keeps controls and SOS above the dashboard, and shows live metrics and status', async () => {
    await openMonitor();
    await threatStatus('off').waitForExist({ timeout: 5000 });
    // Controls and SOS are visible without scrolling.
    expect(await byDesc('ai-monitor-start-btn').isDisplayed()).toBe(true);
    expect(await byDesc('ai-monitor-sos-btn').isDisplayed()).toBe(true);
    await shot('d1-01-off');

    await startRunning();
    await threatStatus('warming_up').waitForExist({ timeout: 5000 }).catch(() => {});
    // After the warm-up: nothing in view, so "no threat" (fall paused: no people, no pose).
    const settled = await waitSettled();
    expect(await $('android=new UiSelector().resourceId("ai-monitor-people-count")').isExisting()).toBe(true);
    const reliability = await $('android=new UiSelector().resourceId("threat-reliability")').getAttribute('content-desc');
    // "No threat" only on usable input; slow analysis must read as unreliable.
    if (settled === 'threat-status-no_threat') expect(['threat-reliability-good', 'threat-reliability-limited']).toContain(reliability);
    if (reliability === 'threat-reliability-poor') expect(settled).toBe('threat-status-unreliable_input');
    console.log(`[ai-dashboard] settled=${settled} reliability=${reliability}`);
    await shot('d1-02-settled');
  });

  it('scrolls the dashboard to detector availability and back', async () => {
    await openMonitor();
    await startRunning();
    await waitSettled();
    await scrollTo('threat-detector-assault-disabled');
    expect(await byDesc('threat-detector-physical_confrontation-disabled').isExisting()).toBe(true);
    expect(await $('android=new UiSelector().descriptionStartsWith("threat-detector-crowd_panic-")').isExisting()).toBe(true);
    expect(await scrollToText('Needs an action model trained on real clips').isExisting()).toBe(true);
    await $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("ai-monitor-privacy-note"))').waitForExist({ timeout: 10000 });
    await shot('d2-01-scrolled-detectors');
    await scrollToTop();
    expect(await byDesc('ai-monitor-stop-btn').isDisplayed()).toBe(true);
  });

  it('reports unreliable camera input while the phone turns (gyroscope)', async () => {
    await openMonitor();
    await startRunning();
    await waitSettled();
    adb('emu', 'sensor', 'set', 'gyroscope', '0:1.5:0');
    await threatStatus('unreliable_input').waitForExist({ timeout: 10000 });
    // The phone-moving message wins over any frame-rate message.
    await scrollToText('Hold the phone steady').waitForExist({ timeout: 10000 });
    await scrollTo('threat-detector-crowd_surge-paused');
    await shot('d3-01-phone-moving');
    adb('emu', 'sensor', 'set', 'gyroscope', '0:0:0');
    await browser.waitUntil(async () => !(await $('//*[@text="Hold the phone steady"]').isExisting()), { timeout: 15000 });
  });

  it('shows an event card with uncertainty, then marks it stale, then clears it', async () => {
    await openMonitor();
    await clearEvents();
    await tap('ai-test-replay-fall');
    const card = await scrollTo('threat-event-fall-ongoing');
    expect(await card.isExisting()).toBe(true);
    expect(await scrollToText('Possible fall').isExisting()).toBe(true);
    expect(await scrollToText('Not calibrated — this is not a probability').isExisting()).toBe(true);
    expect(await scrollToText('not a confirmed threat').isExisting()).toBe(true);
    expect(await scrollToText('General safety advice').isExisting()).toBe(true);
    await shot('d4-01-event-card');
    // No fresh evidence (it was a replay): ends as stale after ~5 s.
    await scrollTo('threat-event-fall-ended');
    expect(await scrollToText('No fresh evidence since').isExisting()).toBe(true);
    await shot('d4-02-event-stale');
    await clearEvents();
    await scrollTo('threat-events-empty').catch(async () => {
      expect(await $('android=new UiSelector().resourceId("threat-events-empty")').isExisting()).toBe(true);
    });
  });

  it('keeps unrelated events apart (separate sessions) and a crowd event separate from a fall', async () => {
    await openMonitor();
    await clearEvents();
    await tap('ai-test-replay-fall');
    await tap('ai-test-replay-panic');
    await driver.pause(500);
    await tap('ai-test-replay-fall');
    // Walk down the event list collecting each card (only on-screen cards
    // are in the page source). Card ids are unique: threat-event-event-N.
    await scrollToText('Events').waitForExist({ timeout: 10000 });
    const cards = new Map();
    for (let i = 0; i < 6; i += 1) {
      const src = await driver.getPageSource();
      for (const m of src.matchAll(/content-desc="threat-event-([a-z_]+)-(?:ongoing|ended)"[^>]*resource-id="threat-event-(event-\d+)"|resource-id="threat-event-(event-\d+)"[^>]*content-desc="threat-event-([a-z_]+)-(?:ongoing|ended)"/g)) {
        cards.set(m[2] || m[3], m[1] || m[4]);
      }
      await driver.execute('mobile: scrollGesture', { left: 100, top: 900, width: 800, height: 900, direction: 'down', percent: 0.6 });
    }
    const kinds = [...cards.values()];
    console.log(`[ai-dashboard] event cards: ${JSON.stringify([...cards])}`);
    // Two falls from separate sessions stay separate; the crowd event is its own card.
    expect(kinds.filter((k) => k === 'fall')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'crowd_panic')).toHaveLength(1);
    await scrollToText('Events');
    await shot('d5-01-three-events');
    await clearEvents();
  });

  it('says so when threat analysis fails, and keeps counting people', async () => {
    await openMonitor();
    await startRunning();
    await waitSettled();
    await tap('ai-test-fail-analysis');
    await scrollToTop();
    await threatStatus('failed').waitForExist({ timeout: 10000 });
    expect(await monitorStatus('running').isExisting()).toBe(true);
    expect(await $('android=new UiSelector().resourceId("ai-monitor-people-count")').isExisting()).toBe(true);
    await shot('d6-01-analysis-failed');
    // A fresh start recovers.
    await byDesc('ai-monitor-stop-btn').click();
    await startRunning();
    expect(await waitSettled()).not.toBe('threat-status-failed');
  });

  it('never starts Emergency on its own; SOS is a manual tap', async () => {
    await openMonitor();
    await startRunning();
    await tap('ai-test-replay-fall');
    await driver.pause(8000);
    expect(await emergencyPage.countdownScreen.isExisting()).toBe(false);
    await scrollToTop();
    await byDesc('ai-monitor-sos-btn').click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await shot('d7-01-manual-sos-countdown');
    await emergencyPage.cancelBtn.click();
  });

  it('handles a denied camera permission without claiming anything', async () => {
    adb('shell', 'pm', 'revoke', PKG, 'android.permission.CAMERA');
    await driver.pause(1500);
    await driver.activateApp(PKG);
    await tabBar.homeBtn.waitForDisplayed({ timeout: 45000 });
    await openMonitor();
    await threatStatus('off').waitForExist({ timeout: 5000 });
    expect(await scrollToText('AI Monitor needs the camera').isExisting()).toBe(true);
    await scrollToTop();
    await byDesc('ai-monitor-start-btn').click();
    const deny = $('android=new UiSelector().resourceIdMatches(".*permission_deny.*")');
    await deny.waitForDisplayed({ timeout: 10000 });
    await shot('d8-01-permission-prompt');
    await deny.click();
    await driver.pause(1000);
    expect(await monitorStatus('idle').isExisting()).toBe(true);
    await threatStatus('off').waitForExist({ timeout: 5000 });
    await shot('d8-02-permission-denied');
    adb('shell', 'pm', 'grant', PKG, 'android.permission.CAMERA');
  });
});
