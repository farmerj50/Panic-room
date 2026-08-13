const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');

describe('PanicRoom login flow', () => {
  it('registers an account, signs out, and signs back in with the same credentials', async () => {
    const email = `e2e-login-${Date.now()}@panicroom.test`;
    const password = 'TestPass1234!';

    // ── Register a fresh account (login has nothing to test against otherwise) ──
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, password);

    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });

    // ── Sign out ───────────────────────────────────────────────────────────
    await tabBar.profileBtn.click();
    await profilePage.logoutBtn.waitForDisplayed({ timeout: 10000 });
    await profilePage.logoutBtn.click();

    // Signing out drops back to the landing/auth stack.
    await landingPage.signInBtn.waitForDisplayed({ timeout: 15000 });

    // ── Sign back in with the same credentials ────────────────────────────
    await landingPage.signInBtn.click();
    await authPage.login(email, password);

    // A successful login lands back on the authenticated tab bar.
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });

    // Leave the app signed out so the next test starts from a known state.
    await tabBar.profileBtn.click();
    await profilePage.logoutBtn.waitForDisplayed({ timeout: 10000 });
    await profilePage.logoutBtn.click();
    await landingPage.signInBtn.waitForDisplayed({ timeout: 15000 });
  });

  it('rejects an incorrect password with a visible error, without crashing', async () => {
    const email = `e2e-login-bad-${Date.now()}@panicroom.test`;

    await landingPage.signInBtn.waitForDisplayed({ timeout: 15000 });
    await landingPage.signInBtn.click();
    await authPage.login(email, 'WrongPassword123!');

    // A failed login also fires a native Alert.alert('Authentication
    // failed', ...) with a default "OK" button — dismiss it before
    // inspecting the underlying screen.
    const alertOkBtn = await $('//*[@text="OK"]');
    if (await alertOkBtn.isExisting()) {
      await alertOkBtn.click();
    }

    // Login must fail loudly (an inline error message), not silently proceed.
    const errorBox = await $('//*[contains(@text, "Invalid") or contains(@text, "invalid")]');
    await errorBox.waitForDisplayed({ timeout: 10000 });

    // Still on the auth screen, not accidentally authenticated.
    const stillOnAuth = await authPage.submitBtn.isDisplayed();
    expect(stillOnAuth).toBe(true);
  });
});
