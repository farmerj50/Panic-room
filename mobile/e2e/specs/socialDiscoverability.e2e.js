// Social sharing discoverability (1.0.33), end to end on the local backend.
//
// LOCAL BACKEND ONLY (same requirements as socialSharing.e2e.js); skipped
// unless E2E_LOCAL_BACKEND=1. Uses the QA account and puts it back to a free
// account with no social connections when done.
//   1. Free account: Home card (Premium) → Paywall; inline setup note during
//      an emergency (below the controls); "Remind me after" → one-time sheet.
//   2. Premium: an account connected AFTER the emergency screen first loaded
//      is picked up at the next activation — the 5-second prompt appears with
//      no app restart.
//   3. The fake token is rejected by the real provider → "Reconnect TikTok",
//      and the next emergency shows the reconnect note. Recording continues
//      through all of it.
const fs = require('fs');
const path = require('path');

const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

const RUN = process.env.E2E_LOCAL_BACKEND === '1';
const SHOTS = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots', 'social-discoverability');
const APP = 'com.ginslayer.besapp';
const EMAIL = 'qa.share.test@example.com';
const PASSWORD = 'QaShare!2026x';

const byId = (id) => $(`android=new UiSelector().resourceId("${id}")`);
const scrollTo = (id) =>
  $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${id}"))`);

let shotIndex = 0;
async function shot(name) {
  shotIndex += 1;
  fs.mkdirSync(SHOTS, { recursive: true });
  await browser.saveScreenshot(path.join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`));
}

async function signInIfNeeded() {
  await driver.waitUntil(
    async () => (await landingPage.signInBtn.isDisplayed().catch(() => false)) || (await tabBar.emergencyBtn.isDisplayed().catch(() => false)),
    { timeout: 60000, interval: 1000 },
  );
  if (await landingPage.signInBtn.isDisplayed().catch(() => false)) {
    await landingPage.signInBtn.click();
    await authPage.login(EMAIL, PASSWORD);
    await onboardingPage.dismissTourOfferIfPresent(8000);
  }
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
}

async function relaunch() {
  await driver.terminateApp(APP);
  await driver.activateApp(APP);
  await signInIfNeeded();
}

async function startEmergency() {
  await tabBar.emergencyBtn.click();
  await emergencyPage.waitForLiveScreen(30000);
  await emergencyPage.waitForRecordingPhase(30000);
}

async function exitEmergency({ waitForTab = true } = {}) {
  // The note is at the bottom; Exit is at the top — bring it back on screen.
  await scrollTo('emergency-exit-btn').waitForDisplayed({ timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 3 && (await emergencyPage.exitBtn.isExisting()); i += 1) {
    await emergencyPage.exitBtn.click().catch(() => {});
    await driver.pause(2500);
  }
  if (waitForTab) await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
}

(RUN ? describe : describe.skip)('Social sharing discoverability (local backend)', () => {
  const db = RUN ? require('../helpers/socialSharingDb') : null;

  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    await db.makeFree(EMAIL);
    await db.clearSocialConnections(EMAIL);
  });

  after(async () => {
    if (!db) return;
    await db.makeFree(EMAIL).catch(() => {});
    await db.clearSocialConnections(EMAIL).catch(() => {});
    await db.disconnect();
  });

  it('free account: Home card is marked Premium and opens the Paywall', async () => {
    await signInIfNeeded();
    const card = scrollTo('home-social-sharing-card');
    await card.waitForDisplayed({ timeout: 15000 });
    await shot('home-card-free-premium');
    await byId('home-social-sharing-connect').click();
    await $('~paywall-screen').waitForDisplayed({ timeout: 15000 });
    await shot('card-opened-paywall');
    await driver.back();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });
  });

  it('free account: inline Premium note below the controls; recording continues; "Remind me after" → one-time sheet', async () => {
    await startEmergency();
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
    const note = scrollTo('emergency-social-setup-note');
    await note.waitForDisplayed({ timeout: 20000 });
    await shot('emergency-setup-note-free');

    // The note sits below every control.
    const noteY = (await note.getLocation()).y;
    const stopY = (await $('~emergency-stop-btn').getLocation()).y;
    expect(noteY).toBeGreaterThan(stopY);

    await byId('emergency-social-setup-remind').click();
    await driver.waitUntil(async () => (await $$('android=new UiSelector().resourceId("emergency-social-setup-note")').length) === 0, {
      timeout: 10000,
    });
    // Home opens the reminder sheet straight away (it covers the tab bar).
    await exitEmergency({ waitForTab: false });
    const sheet = $('//*[@text="Set up emergency sharing?"]');
    await sheet.waitForDisplayed({ timeout: 15000 });
    await shot('after-emergency-reminder-sheet');
    await $('android=new UiSelector().resourceId("android:id/button2")').click(); // NOT NOW
    await driver.pause(1500);
    expect(await $('//*[@text="Set up emergency sharing?"]').isExisting()).toBe(false);
  });

  it('Premium: an account connected after the emergency screen first loaded is picked up — prompt appears, no restart', async () => {
    await db.makePremium(EMAIL);
    await relaunch(); // the app reads Premium status at sign-in/launch

    // Load the emergency screen once with nothing connected (cancel countdown).
    await tabBar.emergencyBtn.click();
    await emergencyPage.cancelBtn.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.cancelBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });

    // Connect "later" — the old build kept the stale empty list here.
    await db.seedFakeSocialConnections(EMAIL);
    await startEmergency();
    await byId('social-share-prompt').waitForDisplayed({ timeout: 15000 });
    await shot('prompt-after-late-connection');
  });

  it('a rejected token gives a reconnect message; the next emergency shows the reconnect note; recording never stops', async () => {
    await byId('social-share-prompt-share').click();
    // With two accounts the picker comes first; choose TikTok.
    if (await byId('social-share-pick').isExisting().catch(() => false)) {
      await byId('social-share-pick-tiktok').click().catch(() => {});
      await byId('social-share-pick-continue').click().catch(() => {});
    }
    const publish = byId('social-share-publish');
    await publish.waitForDisplayed({ timeout: 30000 });
    await driver.waitUntil(async () => (await publish.isEnabled()) === true, { timeout: 60000, interval: 1000 });
    await publish.click();
    await byId('social-share-result').waitForDisplayed({ timeout: 90000 });
    const title = await $('//*[contains(@text, "Reconnect") or contains(@text, "Could not share")]').getText();
    console.log('share result:', title);
    await shot('share-result-reconnect');
    await byId('social-share-done').click();
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
    await exitEmergency();

    // TikTok is now marked as needing reconnection. Instagram is still usable
    // (so the popup would be offered instead) — mark it too, to see the note.
    await db.setConnectionStatus(EMAIL, 'instagram', 'reauth_required');
    await startEmergency();
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
    const note = scrollTo('emergency-social-setup-note');
    await note.waitForDisplayed({ timeout: 20000 });
    await shot('next-emergency-reconnect-note');
    await exitEmergency();
  });
});
