const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const emergencyPage = require('../pageobjects/emergency.po');

const APP_ID = 'com.ginslayer.besapp';

function uniqueEmail(tag) {
  return `e2e-variant-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@panicroom.test`;
}

// Clears app data (equivalent to `pm clear`) and relaunches — the clean way
// to force a fresh AsyncStorage `bes_onboarding_variant` coin-flip on the
// next registration, without needing to know that key's on-disk format.
async function resetAppForFreshVariant() {
  await driver.execute('mobile: clearApp', { appId: APP_ID });
  await driver.execute('mobile: activateApp', { appId: APP_ID });
  await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
}

// Registers a fresh account and reports which variant this install landed
// in, by observing which screen actually appears — the onboarding Welcome
// screen (needsOnboarding true) or the authenticated tab bar directly
// (needsOnboarding false, contextual variant skips straight to Home).
async function registerAndDetectVariant(tag) {
  const email = uniqueEmail(tag);
  const password = 'TestPass1234!';

  await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
  await landingPage.createAccountBtn.click();
  await authPage.register(email, password);

  const variant = await driver.waitUntil(
    async () => {
      if (await onboardingPage.welcomeCta.isDisplayed().catch(() => false)) return 'onboarding';
      if (await tabBar.emergencyBtn.isDisplayed().catch(() => false)) return 'contextual';
      return false;
    },
    { timeout: 30000, interval: 500, timeoutMsg: 'Neither the onboarding Welcome screen nor Home appeared after registration' },
  );

  return { email, password, variant };
}

async function readGrantedPermissions() {
  const out = await driver.execute('mobile: shell', {
    command: 'dumpsys',
    args: ['package', APP_ID],
  });
  const text = typeof out === 'string' ? out : out.stdout || '';
  const has = (perm) => new RegExp(`${perm}: granted=true`).test(text);
  return {
    camera: has('android.permission.CAMERA'),
    microphone: has('android.permission.RECORD_AUDIO'),
    location: has('android.permission.ACCESS_FINE_LOCATION') || has('android.permission.ACCESS_COARSE_LOCATION'),
  };
}

describe('Contextual-onboarding A/B experiment', () => {
  it('onboarding variant: registration still shows the full permission sequence before Home, unchanged', async () => {
    let variant;
    let attempts = 0;
    // Bucketing is a 50/50 coin-flip assigned once per install and reused
    // for every account on that install — retry with a fresh install
    // (clearApp) until we land in the variant this test needs.
    while (variant !== 'onboarding' && attempts < 8) {
      if (attempts > 0) await resetAppForFreshVariant();
      ({ variant } = await registerAndDetectVariant(`onb-${attempts}`));
      attempts += 1;
    }
    expect(variant).toBe('onboarding');

    // Full skip-through must still work exactly as before this experiment.
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });
    await tabBar.homeBtn.waitForDisplayed({ timeout: 5000 });
  });

  it('contextual variant: registration lands directly on Home with no onboarding screens', async () => {
    await resetAppForFreshVariant();
    let variant;
    let attempts = 0;
    while (variant !== 'contextual' && attempts < 8) {
      if (attempts > 0) await resetAppForFreshVariant();
      ({ variant } = await registerAndDetectVariant(`ctx-${attempts}`));
      attempts += 1;
    }
    expect(variant).toBe('contextual');

    // Already on the authenticated tab bar — no onboarding screen was ever
    // shown (registerAndDetectVariant's waitUntil already proved this by
    // detecting the tab bar directly rather than clicking through Welcome).
    await tabBar.homeBtn.waitForDisplayed({ timeout: 5000 });
    const stillNoOnboarding = await onboardingPage.welcomeCta.isExisting();
    expect(stillNoOnboarding).toBe(false);
  });

  it('contextual variant: first Emergency activation shows the permission disclosure mid-countdown, not before', async () => {
    // pm clear (inside resetAppForFreshVariant) wipes app data but NOT
    // previously-granted OS runtime permissions — those are tracked
    // independently and survive a data clear. A prior test run (or a
    // prior attempt in this same run) may have already granted
    // camera/mic, which would make this test's premise false through no
    // fault of the app. Revoke explicitly so this test starts from a
    // guaranteed-clean permission slate.
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.CAMERA'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.RECORD_AUDIO'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.ACCESS_FINE_LOCATION'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.ACCESS_COARSE_LOCATION'] });

    await resetAppForFreshVariant();
    let variant;
    let attempts = 0;
    while (variant !== 'contextual' && attempts < 8) {
      if (attempts > 0) await resetAppForFreshVariant();
      ({ variant } = await registerAndDetectVariant(`emg-${attempts}`));
      attempts += 1;
    }
    expect(variant).toBe('contextual');

    const before = await readGrantedPermissions();
    expect(before.camera).toBe(false);
    expect(before.microphone).toBe(false);

    // Tapping the Emergency tab must navigate immediately — no blocking
    // dialog before the countdown screen appears.
    await tabBar.emergencyBtn.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 5000 });

    // Somewhere during the countdown (ensurePermissions runs inside
    // activateEmergency, at count<=0), the in-app disclosure and/or the OS
    // permission dialog should appear. Accept whichever surfaces first —
    // our own Alert-based disclosure ("Continue"/"Not now", rendered
    // ALL-CAPS by the Android AlertDialog button theme — hence the
    // case-insensitive translate() below) or the raw OS grant dialog — and
    // grant it, proving the ask happened contextually.
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const byTextCI = (text) => $(`//*[translate(@text, '${UPPER}', '${LOWER}')="${text.toLowerCase()}"]`);

    const disclosureContinueBtn = await byTextCI('Continue');
    const osAllowBtn = await $('//*[@text="While using the app"]');
    const anyPermissionUi = await driver.waitUntil(
      async () => (await disclosureContinueBtn.isExisting()) || (await osAllowBtn.isExisting()),
      { timeout: 20000, interval: 500, timeoutMsg: 'No permission disclosure or OS prompt ever appeared during the countdown' },
    );
    expect(anyPermissionUi).toBe(true);

    // Drain whatever sequence of disclosure/OS dialogs appears (camera then
    // mic, each with its own in-app disclosure followed by an OS prompt).
    for (let i = 0; i < 6; i++) {
      if (await disclosureContinueBtn.isExisting().catch(() => false)) {
        await disclosureContinueBtn.click();
      } else if (await osAllowBtn.isExisting().catch(() => false)) {
        await osAllowBtn.click();
      } else {
        const osAllowAlt = await byTextCI('Allow');
        if (await osAllowAlt.isExisting().catch(() => false)) {
          await osAllowAlt.click();
        } else {
          break;
        }
      }
      await driver.pause(500);
    }

    await emergencyPage.waitForLiveScreen(30000);
    await emergencyPage.stopBtn.waitForDisplayed({ timeout: 10000 });
    await emergencyPage.stopBtn.click();

    const after = await readGrantedPermissions();
    expect(after.camera || after.microphone).toBe(true);
  });

  it("contextual variant: Profile's Safety Plan percentage reflects live OS permission state, not a fixed step", async () => {
    // The previous test intentionally ends with camera and/or mic granted —
    // revoke everything first so this test starts from a genuine 0% baseline
    // rather than inheriting that state (permission grants survive pm clear).
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.CAMERA'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.RECORD_AUDIO'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.ACCESS_FINE_LOCATION'] });
    await driver.execute('mobile: shell', { command: 'pm', args: ['revoke', APP_ID, 'android.permission.ACCESS_COARSE_LOCATION'] });

    await resetAppForFreshVariant();
    let variant;
    let attempts = 0;
    while (variant !== 'contextual' && attempts < 8) {
      if (attempts > 0) await resetAppForFreshVariant();
      ({ variant } = await registerAndDetectVariant(`pct-${attempts}`));
      attempts += 1;
    }
    expect(variant).toBe('contextual');

    // No permissions granted yet on this fresh install — percentage should
    // be 0%, not the old formula's fixed 10% floor. The Safety Plan card
    // sits near the top of Profile, on-screen without scrolling.
    await tabBar.profileBtn.click();
    const pctSelector = '//*[contains(@text, "% Complete")]';
    const pctText = await $(pctSelector);
    await pctText.waitForDisplayed({ timeout: 10000 });
    const text0 = await pctText.getText();
    expect(text0).toBe('0% Complete');

    // Grant location via the OS settings app directly (fastest deterministic
    // way to change OS permission state without another full emergency
    // activation), then confirm Profile picks it up live on next focus.
    await driver.execute('mobile: shell', {
      command: 'pm',
      args: ['grant', APP_ID, 'android.permission.ACCESS_FINE_LOCATION'],
    });
    await driver.execute('mobile: shell', {
      command: 'pm',
      args: ['grant', APP_ID, 'android.permission.ACCESS_COARSE_LOCATION'],
    });

    await tabBar.homeBtn.click();
    await tabBar.profileBtn.click();
    const pctEl = await $(pctSelector);
    await pctEl.waitForDisplayed({ timeout: 10000 });
    const text1 = await pctEl.getText();
    // 1 of 3 permissions => round(1/3*40) = 13%.
    expect(text1).toBe('13% Complete');
  });
});
