const fs = require('fs');
const path = require('path');

const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');

// Account deletion is reachable in one tap from Settings (Google Play
// requires the in-app path to be easy to find). Always uses its own
// disposable, freshly registered account — never a shared test account.

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

async function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await browser.saveScreenshot(path.join(SHOTS, `delete-${name}.png`));
}

// Small fixed-distance drags (same approach as profile.po.js) until the
// element is on screen — the subscriber version of the screen is taller.
async function scrollTo(selector, maxSwipes = 6) {
  for (let i = 0; i < maxSwipes; i++) {
    if (await $(selector).isDisplayed().catch(() => false)) return;
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: 540, y: 1800 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: 300, x: 540, y: 1000 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await driver.releaseActions();
    await driver.pause(300);
  }
}

describe('PanicRoom account deletion', () => {
  it('deletes a fresh account from Profile → Settings → Delete Account, and it can no longer sign in', async () => {
    const email = `e2e-delete-${Date.now()}@panicroom.test`;
    const password = 'TestPass1234!';

    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, password);
    await onboardingPage.skipAll();
    await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });

    // ── Profile → Settings → Delete Account ────────────────────────────────
    await tabBar.profileBtn.click();
    await profilePage.scrollToElementAndClick('~profile-settings-btn');
    await $('~settings-delete').waitForDisplayed({ timeout: 10000 });
    await $('~settings-delete').click();

    await $('~delete-account-password-input').waitForDisplayed({ timeout: 10000 });
    await shot('screen-free-user');

    // Disabled until a password is entered.
    expect(await $('~delete-account-confirm-btn').getAttribute('enabled')).toBe('false');
    await $('~delete-account-password-input').setValue(password);
    try { await driver.hideKeyboard(); } catch {}
    expect(await $('~delete-account-confirm-btn').getAttribute('enabled')).toBe('true');
    await shot('screen-password-entered');

    // ── Confirm, then the final "Are you absolutely sure?" alert ───────────
    await $('~delete-account-confirm-btn').click();
    const finalConfirm = await $('//*[@text="DELETE MY ACCOUNT" or @text="Delete My Account"]');
    await finalConfirm.waitForDisplayed({ timeout: 10000 });
    await shot('final-confirmation');
    await finalConfirm.click();

    // Deletion signs the app out, back to the landing screen.
    await landingPage.signInBtn.waitForDisplayed({ timeout: 30000 });
    await shot('signed-out-after-delete');

    // ── The deleted credentials no longer work ────────────────────────────
    await landingPage.signInBtn.click();
    await authPage.login(email, password);
    const alertOkBtn = await $('//*[@text="OK"]');
    if (await alertOkBtn.isExisting()) await alertOkBtn.click();
    const errorBox = await $('//*[contains(@text, "Invalid") or contains(@text, "invalid")]');
    await errorBox.waitForDisplayed({ timeout: 10000 });
    expect(await tabBar.emergencyBtn.isExisting()).toBe(false);
  });

  // LOCAL BACKEND ONLY (E2E_LOCAL_BACKEND=1): seeds the subscriber flag and
  // fake-token social connections straight into the local database.
  (process.env.E2E_LOCAL_BACKEND === '1' ? it : it.skip)(
    'Bes Pro subscribers must acknowledge billing continues; connected accounts get the TikTok/Instagram note',
    async () => {
      const db = require('../helpers/socialSharingDb');
      const appId = 'com.ginslayer.besapp';
      const email = `e2e-delete-pro-${Date.now()}@panicroom.test`;
      const password = 'TestPass1234!';
      try {
        // Previous test ends on the sign-in screen; start from a clean install state.
        await driver.execute('mobile: clearApp', { appId });
        await driver.activateApp(appId);
        await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
        await landingPage.createAccountBtn.click();
        await authPage.register(email, password);
        await onboardingPage.skipAll();
        await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });

        await db.makePremium(email);
        await db.seedFakeSocialConnections(email);
        // Relaunch so SubscriptionContext re-reads billing status.
        await driver.terminateApp(appId);
        await driver.activateApp(appId);
        await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });

        await tabBar.profileBtn.click();
        await profilePage.scrollToElementAndClick('~profile-settings-btn');
        await $('~settings-delete').waitForDisplayed({ timeout: 10000 });
        await $('~settings-delete').click();

        await $('~delete-account-cancel-subscription-btn').waitForDisplayed({ timeout: 15000 });
        await $('android=new UiSelector().resourceId("delete-account-social-note")').waitForDisplayed({ timeout: 10000 });
        await shot('screen-pro-and-connected');

        // Password alone isn't enough for a subscriber.
        await scrollTo('~delete-account-password-input');
        await $('~delete-account-password-input').setValue(password);
        try { await driver.hideKeyboard(); } catch {}
        expect(await $('~delete-account-confirm-btn').getAttribute('enabled')).toBe('false');

        await scrollTo('~delete-account-subscription-ack');
        await $('~delete-account-subscription-ack').click();
        await scrollTo('~delete-account-confirm-btn');
        expect(await $('~delete-account-confirm-btn').getAttribute('enabled')).toBe('true');
        await shot('screen-pro-acknowledged');

        await $('~delete-account-confirm-btn').click();
        const finalConfirm = await $('//*[@text="DELETE MY ACCOUNT" or @text="Delete My Account"]');
        await finalConfirm.waitForDisplayed({ timeout: 10000 });
        await finalConfirm.click();
        await landingPage.signInBtn.waitForDisplayed({ timeout: 30000 });

        expect(await db.userExists(email)).toBe(false);
      } finally {
        await db.disconnect();
      }
    },
  );
});
