// AI Monitor camera flip + proximity (1.0.37) — emulator smoke. Needs a build
// with EXPO_PUBLIC_AI_MONITOR_ENABLED=1, EXPO_PUBLIC_AI_CAMERA_FLIP_ENABLED=1
// and EXPO_PUBLIC_AI_PROXIMITY_ENABLED=1, so it's skipped unless E2E_AI_PROXIMITY=1.
// Real approach/away behavior needs a physical phone (see the report checklist).
const fs = require('fs');
const path = require('path');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

const enabled = process.env.E2E_AI_PROXIMITY === '1';
const PKG = 'com.ginslayer.besapp';
const FLIPS = Number(process.env.E2E_FLIPS || 20);
const SHOTS = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', 'screenshots', 'ai-proximity');
const shot = (name) => browser.saveScreenshot(path.join(SHOTS, `${name}.png`));
const status = (s) => $(`~ai-monitor-status-${s}`);
const byId = (id) => $(`android=new UiSelector().resourceId("${id}")`);
const shell = (command, args) => driver.execute('mobile: shell', { command, args });

const scrollTo = (desc) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${desc}"))`);

async function openMonitor() {
  await tabBar.homeBtn.click();
  const card = await scrollTo('home-ai-monitor-card');
  const r = await driver.getElementRect(await card.elementId);
  const y = Math.min(Math.max(r.y, 250) + 60, r.y + r.height - 20);
  await driver.execute('mobile: clickGesture', { x: Math.round(r.x + r.width / 2), y: Math.round(y) });
  await $('~ai-monitor-start-btn').waitForDisplayed({ timeout: 15000 });
}

async function startAndWaitRunning() {
  await $('~ai-monitor-start-btn').click();
  await status('running').waitForExist({ timeout: 20000 });
}

async function facing() {
  if (await $('~ai-monitor-flip-btn-front').isExisting()) return 'front';
  if (await $('~ai-monitor-flip-btn-back').isExisting()) return 'back';
  return null;
}

// One flip: the camera restarts and the session keeps running on its own.
async function flipAndSettle() {
  const before = await facing();
  await byId('ai-monitor-flip-btn').click();
  const after = before === 'back' ? 'front' : 'back';
  await $(`~ai-monitor-flip-btn-${after}`).waitForExist({ timeout: 5000 });
  await byId('ai-monitor-switching').waitForExist({ timeout: 8000, reverse: true });
  await status('running').waitForExist({ timeout: 5000 });
  if (await byId('ai-monitor-message').isExisting()) throw new Error(`monitor message after flip: ${await byId('ai-monitor-message').getText()}`);
}

(enabled ? describe : describe.skip)('AI Monitor flip + proximity (smoke)', () => {
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-prox-${Date.now()}@panicroom.test`, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  beforeEach(async () => {
    const stop = $('~ai-monitor-stop-btn');
    if (await stop.isExisting().catch(() => false)) await stop.click();
    for (let i = 0; i < 3; i += 1) {
      if (await tabBar.homeBtn.isExisting().catch(() => false)) break;
      if (await emergencyPage.cancelBtn.isExisting().catch(() => false)) await emergencyPage.cancelBtn.click();
      else if (await emergencyPage.exitBtn.isExisting().catch(() => false)) await emergencyPage.exitBtn.click();
      else await driver.back();
      await driver.pause(1000);
    }
  });

  it('shows the flip button and the proximity settings (alerts off by default)', async () => {
    await openMonitor();
    expect(await facing()).toBe('back');
    const sw = await scrollTo('ai-proximity-alert-switch');
    expect(await sw.getAttribute('checked')).toBe('false');
    await shot('p-01-idle-controls');
  });

  it(`${FLIPS} consecutive flips while monitoring: no error, no stop`, async function () {
    this.timeout(600000);
    await openMonitor();
    await startAndWaitRunning();
    for (let i = 0; i < FLIPS; i += 1) {
      await flipAndSettle();
      if (i === 0) {
        await driver.pause(2000);
        await shot('p-02-front-camera-running');
      }
    }
    // Still the same session: Stop is there and Start never reappeared.
    expect(await $('~ai-monitor-stop-btn').isExisting()).toBe(true);
    expect(await $('~ai-monitor-start-btn').isExisting()).toBe(false);
    await driver.pause(2000);
    await shot('p-03-after-flips');
    await $('~ai-monitor-stop-btn').click();
    await status('idle').waitForExist({ timeout: 5000 });
  });

  it('SOS during monitoring (after a flip) hands the camera to Emergency', async function () {
    this.timeout(300000);
    await openMonitor();
    await startAndWaitRunning();
    await flipAndSettle();
    await driver.pause(1500);
    await $('~ai-monitor-sos-btn').click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.waitForLiveScreen(20000);
    await emergencyPage.waitForRecordingPhase(20000);
    expect(await emergencyPage.cameraView.isExisting()).toBe(true);
    expect(await emergencyPage.cameraFallback.isExisting()).toBe(false);
    await driver.pause(3000);
    await shot('p-04-emergency-recording');
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
  });

  it('background stops the monitor; foreground comes back idle with the chosen camera', async () => {
    await openMonitor();
    const chosen = await facing();
    await startAndWaitRunning();
    await driver.background(3);
    await byId('ai-monitor-screen').waitForExist({ timeout: 15000 });
    await status('idle').waitForExist({ timeout: 10000 });
    expect(await facing()).toBe(chosen);
    await startAndWaitRunning();
    await flipAndSettle();
    await $('~ai-monitor-stop-btn').click();
    await status('idle').waitForExist({ timeout: 5000 });
  });

  it('camera permission revoked: no crash loop, monitor stays off and asks again', async function () {
    this.timeout(300000);
    await openMonitor();
    await startAndWaitRunning();
    // Android ends the app's process when a runtime permission is revoked.
    await shell('pm', ['revoke', PKG, 'android.permission.CAMERA']);
    await driver.pause(3000);
    await driver.activateApp(PKG);
    await tabBar.homeBtn.waitForDisplayed({ timeout: 45000 });
    await openMonitor();
    await status('idle').waitForExist({ timeout: 5000 });
    await byId('ai-monitor-camera-box').waitForExist({ timeout: 5000 });
    await shot('p-05-permission-revoked');
    await shell('pm', ['grant', PKG, 'android.permission.CAMERA']);
  });
});
