const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const paywallPage = require('../pageobjects/paywall.po');

describe('Bes Premium paywall', () => {
  it('a free user reaches the paywall from Profile, sees Subscribe, and the app survives tapping it', async () => {
    const email = `e2e-premium-${Date.now()}@panicroom.test`;
    const password = 'TestPass1234!';

    // ── Register a fresh (free-tier) account ──────────────────────────────
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, password);

    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });

    // ── Profile shows an upgrade row for a free user ──────────────────────
    // (accessibilityLabel is the stable testID string, not the visible
    // copy — the row's own content-desc is "profile-premium-btn"; the real
    // "Upgrade to Bes Premium" label lives in a child TextView, so assert
    // via that descendant rather than getText() on the row container.)
    await tabBar.profileBtn.click();
    await profilePage.premiumBtn.waitForDisplayed({ timeout: 15000 });

    const upgradeLabel = await $('//android.widget.TextView[@text="Upgrade to Bes Premium"]');
    const upgradeLabelVisible = await upgradeLabel.isDisplayed();
    expect(upgradeLabelVisible).toBe(true);

    // ── Tapping it opens the Paywall screen ───────────────────────────────
    await profilePage.premiumBtn.click();
    await paywallPage.screen.waitForDisplayed({ timeout: 15000 });
    await paywallPage.subscribeBtn.waitForDisplayed({ timeout: 10000 });

    const subscribeVisible = await paywallPage.subscribeBtn.isDisplayed();
    expect(subscribeVisible).toBe(true);

    // ── Tapping Subscribe must not crash the app, even with no RevenueCat
    // offering configured in this build (no purchase can complete here —
    // this only proves the screen degrades safely rather than crashing). ──
    await paywallPage.subscribeBtn.click();

    const alertOkBtn = await $('//*[@text="OK"]');
    if (await alertOkBtn.isExisting()) {
      await alertOkBtn.click();
    }

    // Still on the paywall screen, app still responsive.
    const stillOnPaywall = await paywallPage.screen.isDisplayed();
    expect(stillOnPaywall).toBe(true);
  });
});
