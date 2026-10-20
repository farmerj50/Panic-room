// Feature-flag smoke test for one build. Set E2E_AI_FLAGS to the build's
// flags, e.g. "monitor=1,threats=0". Skipped unless set.
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');

const spec = process.env.E2E_AI_FLAGS || '';
const flags = Object.fromEntries(spec.split(',').filter(Boolean).map((kv) => kv.split('=').map((s) => s.trim())));
const monitor = flags.monitor === '1';
const threats = flags.threats === '1';

(spec ? describe : describe.skip)(`AI feature flags (${spec})`, () => {
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-aiflags-${Date.now()}@panicroom.test`, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  it(`${monitor ? 'shows' : 'hides'} the AI Monitor entry on Home`, async () => {
    await tabBar.homeBtn.click();
    // Scroll the whole Home screen, then look for the card.
    await $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollToEnd(10)').isExisting().catch(() => false);
    const card = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("home-ai-monitor-card"))');
    const found = await card.waitForExist({ timeout: 8000 }).then(() => true, () => false);
    expect(found).toBe(monitor);
    await browser.saveScreenshot(`./e2e/screenshots/ai-flags-${spec.replace(/[=,]/g, '')}-home.png`);
  });

  if (monitor) {
    it(`runs the monitor ${threats ? 'with' : 'without'} the threat dashboard`, async () => {
      const card = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("home-ai-monitor-card"))');
      const r = await driver.getElementRect(await card.elementId);
      await driver.execute('mobile: clickGesture', { x: Math.round(r.x + r.width / 2), y: Math.round(Math.min(Math.max(r.y, 250) + 60, r.y + r.height - 20)) });
      await $('~ai-monitor-start-btn').waitForDisplayed({ timeout: 15000 });
      await $('~ai-monitor-start-btn').click();
      await $('~ai-monitor-status-running').waitForExist({ timeout: 20000 });
      await driver.pause(4000);
      const dashboard = await $('android=new UiSelector().resourceId("threat-dashboard")').isExisting();
      expect(dashboard).toBe(threats);
      const tools = await $('android=new UiSelector().resourceId("ai-test-tools")').isExisting();
      if (!threats) expect(tools).toBe(false);
      await browser.saveScreenshot(`./e2e/screenshots/ai-flags-${spec.replace(/[=,]/g, '')}-monitor.png`);
      await $('~ai-monitor-stop-btn').click();
      await $('~ai-monitor-status-idle').waitForExist({ timeout: 5000 });
    });
  }
});
