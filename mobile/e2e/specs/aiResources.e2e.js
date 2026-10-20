// AI Monitor resource cleanup: repeated start/stop with threat analysis on,
// measuring app memory (PSS) and thread count. Needs an AI build; skipped
// unless E2E_AI_RESOURCES=1.
const { execFileSync } = require('child_process');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');

const enabled = process.env.E2E_AI_RESOURCES === '1';
const CYCLES = Number(process.env.E2E_AI_CYCLES || 30);
const PKG = 'com.ginslayer.besapp';
const adb = (...args) => execFileSync('adb', ['-s', 'emulator-5554', ...args], { encoding: 'utf8' });

function sample() {
  const pid = adb('shell', 'pidof', PKG).trim();
  const mem = adb('shell', 'dumpsys', 'meminfo', PKG);
  const pss = Number((mem.match(/TOTAL PSS:\s+(\d+)/) || mem.match(/TOTAL\s+(\d+)/) || [])[1]);
  const threads = Number((adb('shell', 'cat', `/proc/${pid}/status`).match(/Threads:\s+(\d+)/) || [])[1]);
  return { pssMb: Math.round(pss / 1024), threads };
}

(enabled ? describe : describe.skip)('AI Monitor resources', () => {
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-airesources-${Date.now()}@panicroom.test`, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  it(`returns to baseline after ${CYCLES} start/stop cycles`, async function () {
    await tabBar.homeBtn.click();
    const card = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("home-ai-monitor-card"))');
    const r = await driver.getElementRect(await card.elementId);
    await driver.execute('mobile: clickGesture', { x: Math.round(r.x + r.width / 2), y: Math.round(Math.min(Math.max(r.y, 250) + 60, r.y + r.height - 20)) });
    const start = $('~ai-monitor-start-btn');
    const stop = $('~ai-monitor-stop-btn');
    await start.waitForDisplayed({ timeout: 15000 });

    const cycle = async () => {
      await start.click();
      await $('~ai-monitor-status-running').waitForExist({ timeout: 20000 });
      await driver.pause(2500); // models loaded, frames analyzed, engine running
      await stop.click();
      await $('~ai-monitor-status-idle').waitForExist({ timeout: 5000 });
    };

    const before = sample();
    for (let i = 0; i < 3; i += 1) await cycle(); // warm-up: models and caches load once
    await driver.pause(3000);
    const warm = sample();
    for (let i = 0; i < CYCLES; i += 1) await cycle();
    await driver.pause(5000); // background cleanup finishes
    const after = sample();
    console.log(`[ai-resources] before=${JSON.stringify(before)} warm=${JSON.stringify(warm)} after${CYCLES}=${JSON.stringify(after)}`);
    // Flat after the warm-up: no per-cycle growth.
    expect(after.threads - warm.threads).toBeLessThanOrEqual(3);
    expect(after.pssMb - warm.pssMb).toBeLessThanOrEqual(40);
  });
});
