// Offline-first Emergency (local backend only). Before the fix, an emergency
// activated without signal was never created on the server: no Share button,
// no uploads after reconnecting, and its clip showed as "stopped when the app
// closed unexpectedly". Skipped unless E2E_LOCAL_BACKEND=1.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');
const profilePage = require('../pageobjects/profile.po');
const contactsPage = require('../pageobjects/contacts.po');
const evidencePage = require('../pageobjects/evidence.po');

const RUN = process.env.E2E_LOCAL_BACKEND === '1';
const PKG = 'com.ginslayer.besapp';
const SHOTS = process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, '..', 'screenshots', 'offline-emergency');
const shell = (...a) => execFileSync('adb', ['-s', 'emulator-5554', 'shell', ...a], { encoding: 'utf8' });
const online = (on) => {
  shell('svc', 'wifi', on ? 'enable' : 'disable');
  shell('svc', 'data', on ? 'enable' : 'disable');
};
const byId = (id) => $(`android=new UiSelector().resourceId("${id}")`);
const shot = (name) => browser.saveScreenshot(path.join(SHOTS, `${name}.png`));
const FILL = '/sdcard/Download/bes-fill';
const freeMb = () => Math.round(Number(shell('df -k /data | tail -1').trim().split(/\s+/)[3]) / 1024);

// The app retries when it comes back to the foreground (and on a timer).
async function nudgeForeground() {
  await driver.background(1);
  await driver.pause(1500);
}

async function waitFor(fn, timeout = 120000, message = 'condition') {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${message}`);
    await driver.pause(3000);
  }
}

async function startEmergencyOffline() {
  online(false);
  await driver.pause(2000);
  await tabBar.emergencyBtn.click();
  await emergencyPage.waitForLiveScreen(30000);
  await emergencyPage.waitForRecordingPhase(30000);
}

async function exitEmergency() {
  const exit = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("emergency-exit-btn"))');
  await exit.waitForExist({ timeout: 10000 }).catch(() => {});
  await emergencyPage.exitBtn.click();
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
}

(RUN ? describe : describe.skip)('Offline-first Emergency (local backend)', () => {
  const db = RUN ? require('../helpers/socialSharingDb') : null;
  const email = `e2e-offline-${Date.now()}@panicroom.test`;

  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    online(true);
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(email, 'TestPass1234!');
    await onboardingPage.skipAll();
    await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });
    // A trusted contact, so the screen has to say whether they were alerted.
    await tabBar.profileBtn.click();
    await profilePage.scrollToElementAndClick('~profile-contacts-btn');
    await contactsPage.screen.waitForDisplayed({ timeout: 10000 });
    await contactsPage.addContact('Offline Test Contact', '+15551234567');
    await contactsPage.dismissSmsInviteOfferIfPresent().catch(() => {});
    await driver.back();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
  });

  after(async () => {
    online(true);
    shell(`rm -f ${FILL}*`);
    if (db) await db.disconnect();
  });

  it('activated without signal: records, says so honestly, keeps Share, then uploads once online (one emergency)', async () => {
    const before = await db.emergencyCount(email);
    await startEmergencyOffline();
    await byId('emergency-sync-status').waitForExist({ timeout: 15000 });
    expect(await $('~emergency-sync-local').isExisting()).toBe(true);
    expect(await byId('emergency-notification-text').getText()).toContain('have not been alerted yet');
    expect(await $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("emergency-share-btn"))').isExisting()).toBe(true);
    await driver.pause(25000); // ~30 s recorded with no signal
    await shot('01-offline-recording');
    expect(await db.emergencyCount(email)).toBe(before); // nothing reached the server yet
    await exitEmergency();

    online(true);
    await nudgeForeground();
    const e = await waitFor(async () => {
      const latest = await db.latestEmergency(email);
      return latest && latest.sequences.length > 0 && latest.hasAudio ? latest : null;
    }, 150000, 'offline evidence to upload');
    expect(await db.emergencyCount(email)).toBe(before + 1);
    expect(e.status).toBe('RESOLVED');
    expect(e.locations).toBeGreaterThan(0);
    expect(new Set(e.sequences).size).toBe(e.sequences.length);
    console.log(`[offline] uploaded: ${JSON.stringify(e)}`);

    await tabBar.profileBtn.click();
    await profilePage.scrollToElementAndClick('~profile-evidence-btn');
    await evidencePage.screen.waitForDisplayed({ timeout: 10000 });
    await waitFor(async () => (await evidencePage.cards).length > 0, 30000, 'evidence card');
    expect(await byId('pending-evidence-incomplete').isExisting()).toBe(false);
    await shot('02-evidence-after-reconnect');
    await driver.back();
  });

  it('signal returns mid-emergency: contacts are alerted then, and the status says it is uploading', async () => {
    await startEmergencyOffline();
    await $('~emergency-sync-local').waitForExist({ timeout: 15000 });
    await driver.pause(5000);
    online(true);
    await $('~emergency-sync-synced').waitForExist({ timeout: 120000 });
    await waitFor(async () => !(await byId('emergency-notification-text').getText()).includes('have not been alerted yet'), 60000, 'contact alert result');
    console.log(`[offline] after reconnect: "${await byId('emergency-notification-text').getText()}"`);
    await shot('03-synced-mid-emergency');
    await exitEmergency();
  });

  it('flaky signal while it syncs never duplicates the emergency or its clips', async () => {
    const before = await db.emergencyCount(email);
    await startEmergencyOffline();
    for (let i = 0; i < 4; i += 1) {
      online(true);
      await driver.pause(1500);
      online(false);
      await driver.pause(2500);
    }
    await exitEmergency();
    online(true);
    await nudgeForeground();
    const e = await waitFor(async () => {
      const latest = await db.latestEmergency(email);
      return (await db.emergencyCount(email)) === before + 1 && latest.sequences.length > 0 ? latest : null;
    }, 150000, 'the flaky-signal emergency to upload');
    await driver.pause(10000); // any duplicate retry would land by now
    expect(await db.emergencyCount(email)).toBe(before + 1);
    expect(new Set(e.sequences).size).toBe(e.sequences.length);
  });

  it('app killed during an offline emergency: recovered at the next launch, exactly one emergency', async () => {
    const before = await db.emergencyCount(email);
    await startEmergencyOffline();
    await driver.pause(15000);
    shell('am', 'force-stop', PKG);
    online(true);
    await driver.activateApp(PKG);
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
    const e = await waitFor(async () => ((await db.emergencyCount(email)) === before + 1 ? db.latestEmergency(email) : null), 120000, 'the interrupted emergency on the server');
    expect(e.locations).toBeGreaterThan(0);
    await driver.pause(10000);
    expect(await db.emergencyCount(email)).toBe(before + 1);
    console.log(`[offline] interrupted: ${JSON.stringify(e)}`);
  });

  it('low storage with signal (regression): video pauses with a message, recording continues', async () => {
    online(true);
    const need = freeMb() - 80;
    if (need > 0) shell(`dd if=/dev/zero of=${FILL}-${Date.now()} bs=1048576 count=${need} 2>/dev/null; true`);
    await tabBar.emergencyBtn.click();
    await emergencyPage.waitForLiveScreen(30000);
    await emergencyPage.waitForRecordingPhase(30000);
    const storage = await $('~emergency-storage-text').getText();
    expect(storage.toLowerCase()).toContain('paused');
    expect(await byId('emergency-sync-status').isExisting()).toBe(false); // on the server: nothing to say
    expect((await emergencyPage.recLabel.getText()).startsWith('LIVE')).toBe(true);
    await exitEmergency();
    shell(`rm -f ${FILL}*`);
  });

  it('low storage without signal: video pauses with a message, audio is kept and uploaded later', async () => {
    const before = await db.emergencyCount(email);
    const need = freeMb() - 80;
    if (need > 0) shell(`dd if=/dev/zero of=${FILL}-${Date.now()} bs=1048576 count=${need} 2>/dev/null; true`);
    await startEmergencyOffline();
    await $('~emergency-sync-local').waitForExist({ timeout: 15000 });
    const storage = await $('~emergency-storage-text').getText();
    console.log(`[offline] low storage notice: "${storage}"`);
    expect(storage.toLowerCase()).toContain('paused');
    await driver.pause(10000);
    await shot('04-offline-low-storage');
    await exitEmergency();
    shell(`rm -f ${FILL}*`);
    online(true);
    await nudgeForeground();
    const e = await waitFor(async () => {
      const latest = await db.latestEmergency(email);
      return (await db.emergencyCount(email)) === before + 1 && latest.hasAudio ? latest : null;
    }, 150000, 'audio from the low-storage emergency');
    expect(e.status).toBe('RESOLVED');
  });
});
