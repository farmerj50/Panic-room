// AI Monitor (beta). Needs a build with EXPO_PUBLIC_AI_MONITOR_ENABLED=1, so
// it's skipped unless E2E_AI_MONITOR=1.
const fs = require('fs');
const path = require('path');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const emergencyPage = require('../pageobjects/emergency.po');

const enabled = process.env.E2E_AI_MONITOR === '1';
const SHOTS = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', 'screenshots', 'ai-monitor');
const shot = (name) => browser.saveScreenshot(path.join(SHOTS, `${name}.png`));
const status = (s) => $(`~ai-monitor-status-${s}`);

const scrollTo = (desc) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${desc}"))`);

async function openMonitor() {
  await tabBar.homeBtn.click();
  const card = await scrollTo('home-ai-monitor-card');
  // The card can end up partly under the status bar; tap its visible part.
  const r = await driver.getElementRect(await card.elementId);
  const y = Math.min(Math.max(r.y, 250) + 60, r.y + r.height - 20);
  await driver.execute('mobile: clickGesture', { x: Math.round(r.x + r.width / 2), y: Math.round(y) });
  await $('~ai-monitor-start-btn').waitForDisplayed({ timeout: 15000 });
}

// Emergency reaches recording with a working camera, then exits to Home.
async function expectEmergencyRecordsThenExit(label) {
  await emergencyPage.waitForLiveScreen(20000);
  await emergencyPage.waitForRecordingPhase(20000);
  expect(await emergencyPage.cameraView.isExisting()).toBe(true);
  expect(await emergencyPage.cameraFallback.isExisting()).toBe(false);
  await driver.pause(3000); // let the first segment actually record
  if (label) await shot(label);
  await emergencyPage.exitBtn.click();
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
}

async function startAndWaitRunning() {
  await $('~ai-monitor-start-btn').click();
  await status('running').waitForExist({ timeout: 20000 });
}

(enabled ? describe : describe.skip)('AI Monitor', () => {
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    const email = `e2e-ai-${Date.now()}@panicroom.test`;
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  // Each test starts from Home with the monitor off, even if a previous one failed midway.
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

  it('M1: opens from Home with the camera off, then starts, pauses and stops', async () => {
    await openMonitor();
    await status('idle').waitForExist({ timeout: 5000 });
    await shot('m1-01-monitor-off');

    await startAndWaitRunning();
    await driver.pause(2500);
    await shot('m1-02-preview-running');

    await $('~ai-monitor-pause-btn').click();
    await status('paused').waitForExist({ timeout: 5000 });
    await $('~ai-monitor-resume-btn').click();
    await status('running').waitForExist({ timeout: 5000 });

    await $('~ai-monitor-stop-btn').click();
    await status('idle').waitForExist({ timeout: 5000 });
    await shot('m1-03-stopped');
  });

  it('M1: survives repeated start/stop cycles', async () => {
    await openMonitor();
    for (let i = 0; i < 5; i += 1) {
      await startAndWaitRunning();
      await $('~ai-monitor-stop-btn').click();
      await status('idle').waitForExist({ timeout: 5000 });
    }
    await startAndWaitRunning();
    await $('~ai-monitor-stop-btn').click();
  });

  it('M1: stops when the app goes to the background', async () => {
    await openMonitor();
    await startAndWaitRunning();
    await driver.background(3);
    await $('android=new UiSelector().resourceId("ai-monitor-screen")').waitForExist({ timeout: 15000 });
    await status('idle').waitForExist({ timeout: 10000 });
  });

  it('M2-M4: shows the overlay, people count and metrics while monitoring', async () => {
    await openMonitor();
    await startAndWaitRunning();
    await driver.pause(4000);
    await $('android=new UiSelector().resourceId("ai-monitor-metrics")').waitForExist({ timeout: 5000 });
    await shot('m2-01-monitoring-metrics');
    await $('~ai-monitor-stop-btn').click();
    await status('idle').waitForExist({ timeout: 5000 });
  });

  it('M1: leaving the screen releases the camera for Emergency', async () => {
    await openMonitor();
    await startAndWaitRunning();
    await $('~ai-monitor-sos-btn').click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await shot('m1-04-sos-countdown');
    await emergencyPage.cancelBtn.click();
  });

  const RUNS = Number(process.env.E2E_HANDOFF_RUNS || 3);

  it(`M5: monitor SOS button hands the camera to Emergency (${RUNS} runs)`, async function () {
    this.timeout(1200000);
    for (let i = 0; i < RUNS; i += 1) {
      await openMonitor();
      await startAndWaitRunning();
      await driver.pause(1500);
      await $('~ai-monitor-sos-btn').click();
      await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
      await expectEmergencyRecordsThenExit(i === 0 ? 'm5-01-emergency-after-sos' : null);
    }
  });

  it(`M5: Home long-press Emergency right after using the monitor (${RUNS} runs)`, async function () {
    this.timeout(1200000);
    for (let i = 0; i < RUNS; i += 1) {
      await openMonitor();
      await startAndWaitRunning();
      await driver.pause(1500);
      await $('android=new UiSelector().resourceId("ai-monitor-back-btn")').click();
      await tabBar.homeBtn.click();
      const logo = $('android=new UiSelector().resourceId("home-logo-btn")');
      await $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollToBeginning(5)');
      await driver.execute('mobile: longClickGesture', { elementId: await logo.elementId, duration: 1200 });
      await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
      await expectEmergencyRecordsThenExit(null);
    }
  });

  it(`M5: lock-screen SOS notification while the monitor is running (${RUNS} runs)`, async function () {
    this.timeout(1200000);
    // Turn on the persistent SOS notification: Profile → Settings → Emergency Settings.
    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    const row = await profilePage.scrollToElement('//*[@text="Lock Screen SOS Button"]');
    await row.waitForDisplayed({ timeout: 15000 });
    const toggle = $('//*[@text="Lock Screen SOS Button"]/ancestor::*[.//android.widget.Switch][1]//android.widget.Switch');
    if ((await toggle.getAttribute('checked')) !== 'true') await toggle.click();
    // Bes's disclosure ("CONTINUE"), Android's notification permission ("Allow"), then Bes's confirmation ("OK").
    for (const sel of ['android=new UiSelector().resourceId("android:id/button1")', '//*[@text="Allow"]', 'android=new UiSelector().resourceId("android:id/button1")']) {
      const btn = $(sel);
      if (await btn.waitForDisplayed({ timeout: 5000 }).catch(() => false)) await btn.click();
    }
    await driver.pause(1500);
    await driver.back();
    await driver.back();

    for (let i = 0; i < RUNS; i += 1) {
      await openMonitor();
      await startAndWaitRunning();
      await driver.pause(1500);
      await driver.openNotifications();
      const sos = $('//*[contains(@text, "ACTIVATE SOS")]');
      await sos.waitForDisplayed({ timeout: 10000 });
      await sos.click();
      await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
      await expectEmergencyRecordsThenExit(i === 0 ? 'm5-02-emergency-after-notification' : null);
    }
  });
});
