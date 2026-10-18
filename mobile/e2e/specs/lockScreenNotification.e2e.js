// Lock-screen SOS notification without AI Monitor. Skipped unless
// E2E_NOTIFICATIONS=1. On branches without the lock-screen P0 fix
// (fix/lock-screen-sos, release/emergency-p0) the notification is never
// posted — this spec documents that behavior; it does not change it.
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const emergencyPage = require('../pageobjects/emergency.po');

(process.env.E2E_NOTIFICATIONS === '1' ? describe : describe.skip)('Lock-screen SOS notification', () => {
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-lockscreen-${Date.now()}@panicroom.test`, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  after(async () => {
    await driver.execute('mobile: shell', { command: 'cmd', args: ['statusbar', 'collapse'] }).catch(() => {});
  });

  it('posts the SOS notification and its action opens Emergency', async () => {
    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    const row = await profilePage.scrollToElement('//*[@text="Lock Screen SOS Button"]');
    await row.waitForDisplayed({ timeout: 15000 });
    const toggle = $('//*[@text="Lock Screen SOS Button"]/ancestor::*[.//android.widget.Switch][1]//android.widget.Switch');
    if ((await toggle.getAttribute('checked')) !== 'true') await toggle.click();
    for (const sel of ['android=new UiSelector().resourceId("android:id/button1")', '//*[@text="Allow"]', 'android=new UiSelector().resourceId("android:id/button1")']) {
      const btn = $(sel);
      if (await btn.waitForDisplayed({ timeout: 5000 }).catch(() => false)) await btn.click();
    }
    await driver.pause(1500);
    await driver.back();
    await driver.back();
    await driver.openNotifications();
    const sos = $('//android.widget.Button[contains(@text,"ACTIVATE SOS")]');
    await sos.waitForDisplayed({ timeout: 10000 });
    await sos.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.cancelBtn.click();
  });
});
