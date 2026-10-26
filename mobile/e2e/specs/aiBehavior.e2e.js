// AI Monitor movement events (behavioral candidates) — emulator smoke. Needs
// a build with EXPO_PUBLIC_AI_MONITOR_ENABLED=1, EXPO_PUBLIC_AI_CAMERA_FLIP_ENABLED=1
// and EXPO_PUBLIC_AI_BEHAVIOR_EVENTS_ENABLED=1; skipped unless E2E_AI_BEHAVIOR=1.
// The emulator camera shows no people: detection itself is checked on phones.
const fs = require('fs');
const path = require('path');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

const enabled = process.env.E2E_AI_BEHAVIOR === '1';
const SHOTS = process.env.E2E_SHOTS_DIR || path.join(__dirname, '..', 'screenshots', 'ai-behavior');
const shot = (name) => browser.saveScreenshot(path.join(SHOTS, `${name}.png`));
const status = (s) => $(`~ai-monitor-status-${s}`);
const byId = (id) => $(`android=new UiSelector().resourceId("${id}")`);
const scrollTo = (desc) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${desc}"))`);
const scrollToId = (id) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${id}"))`);

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
async function flipAndSettle() {
  await byId('ai-monitor-flip-btn').click();
  await byId('ai-monitor-switching').waitForExist({ timeout: 8000, reverse: true });
  await status('running').waitForExist({ timeout: 5000 });
}
const stateText = async () => (await scrollToId('ai-behavior-state')).getText();

(enabled ? describe : describe.skip)('AI Monitor movement events (smoke)', () => {
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-behavior-${Date.now()}@panicroom.test`, 'TestPass1234!');
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

  it('shows the panel with the banner opt-in off by default', async () => {
    await openMonitor();
    expect(await stateText()).toContain('Starts when monitoring is on');
    const sw = await scrollTo('ai-behavior-alert-switch');
    expect(await sw.getAttribute('checked')).toBe('false');
    await shot('b-01-panel-idle');
  });

  it('runs with the camera, survives flips, and stops cleanly', async () => {
    await openMonitor();
    await startAndWaitRunning();
    await driver.pause(2000);
    expect(await stateText()).toMatch(/Watching how people move|Can.t judge right now/);
    await flipAndSettle();
    await flipAndSettle();
    expect(await byId('ai-monitor-message').isExisting()).toBe(false);
    await shot('b-02-running-after-flips');
    await (await scrollTo('ai-monitor-stop-btn')).click();
    await status('idle').waitForExist({ timeout: 5000 });
    expect(await stateText()).toContain('Starts when monitoring is on');
  });

  it('SOS during monitoring hands the camera to Emergency', async function () {
    this.timeout(300000);
    await openMonitor();
    await startAndWaitRunning();
    await driver.pause(1500);
    await (await scrollTo('ai-monitor-sos-btn')).click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.waitForLiveScreen(20000);
    await emergencyPage.waitForRecordingPhase(20000);
    expect(await emergencyPage.cameraView.isExisting()).toBe(true);
    expect(await emergencyPage.cameraFallback.isExisting()).toBe(false);
    await driver.pause(3000);
    await shot('b-03-emergency-recording');
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
  });

  it('background stops the monitor; it comes back idle', async () => {
    await openMonitor();
    await startAndWaitRunning();
    await driver.background(3);
    await byId('ai-monitor-screen').waitForExist({ timeout: 15000 });
    await status('idle').waitForExist({ timeout: 10000 });
  });
});
