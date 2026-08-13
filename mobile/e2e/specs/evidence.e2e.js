const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const evidencePage = require('../pageobjects/evidence.po');
const emergencyPage = require('../pageobjects/emergency.po');

describe('PanicRoom evidence screen', () => {
  it('shows an empty state for a fresh account, then a card after a real emergency', async () => {
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-evidence-${Date.now()}@panicroom.test`, 'TestPass1234!');

    await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });
    await tabBar.profileBtn.click();
    await profilePage.evidenceBtn.waitForDisplayed({ timeout: 10000 });
    await profilePage.evidenceBtn.click();

    await evidencePage.screen.waitForDisplayed({ timeout: 10000 });
    expect(await evidencePage.emptyState.isExisting()).toBe(true);

    // ── Trigger a real (abbreviated) emergency so an event exists ────────
    await tabBar.homeBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 10000 });
    await tabBar.emergencyBtn.click();

    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    const startCount = parseInt(await emergencyPage.countdownNumber.getText(), 10);
    await emergencyPage.waitForLiveScreen((startCount + 10) * 1000);

    // The EmergencyEvent itself is created (and awaited) before recording
    // even starts, so it exists regardless of whether the best-effort
    // audio/video upload has finished by the time we check Evidence.
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });

    // ── Evidence should now show at least one event ──────────────────────
    await tabBar.profileBtn.click();
    await profilePage.evidenceBtn.waitForDisplayed({ timeout: 10000 });
    await profilePage.evidenceBtn.click();
    await evidencePage.screen.waitForDisplayed({ timeout: 10000 });

    await driver.waitUntil(
      async () => (await evidencePage.cards).length > 0,
      { timeout: 15000, interval: 500, timeoutMsg: 'No evidence card appeared after the emergency' },
    );
  });
});
