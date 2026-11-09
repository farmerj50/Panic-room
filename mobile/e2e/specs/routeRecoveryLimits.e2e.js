// Recovery tracking under Android limits: force-stop, permission removal and
// the 72-hour expiry (fast-forwarded in the TEST database). Leaves one
// recovery session running for the separate reboot check (its id is written
// to E2E_REBOOT_FILE). LOCAL test backend only (E2E_LOCAL_BACKEND=1).
const fs = require('fs');

const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const emergencyPage = require('../pageobjects/emergency.po');
const { PKG, BASE, shell, geo, pause, makeApi, stayAt, driveTo, waitFor, testDb, trackingServiceInForeground } = require('../helpers/routeTracking');

const PASSWORD = 'TestPass1234!';
const api = makeApi();
let emergencyId;

const tracking = async () => (await api.call(`/api/emergency/${emergencyId}/tracking`)).body;
const pointCount = async () => (await api.call(`/api/emergency/${emergencyId}/route`)).body.pointCount;
const servicesRunning = () => trackingServiceInForeground();

async function reopenApp() {
  await driver.activateApp(PKG);
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 60000 });
}

// A short SOS (≈40 s), then Exit → recovery tracking.
async function sosIntoRecovery() {
  await tabBar.emergencyBtn.click();
  await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
  await emergencyPage.waitForLiveScreen(20000);
  await emergencyPage.dismissLocationAccuracyDialogIfPresent();
  await emergencyPage.waitForRecordingPhase(30000);
  emergencyId = (await api.call('/api/emergency')).body[0].id;
  await stayAt(0, 40);
  await emergencyPage.exitBtn.click();
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
  await waitFor(async () => (await tracking()).state === 'RECOVERY_TRACKING', { timeout: 60000, message: 'recovery tracking' });
  await $('~phone-recovered-btn').waitForDisplayed({ timeout: 15000 });
}

(process.env.E2E_LOCAL_BACKEND === '1' ? describe : describe.skip)('Recovery tracking under Android limits', () => {
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    const email = `e2e-limits-${Date.now()}@panicroom.test`;
    const reg = await api.call('/api/auth/register', { method: 'POST', auth: false, body: { email, password: PASSWORD, name: 'Casey Limits' } });
    Object.assign(api, { token: reg.body.accessToken, email, password: PASSWORD });
    await api.call('/api/contacts', { method: 'POST', body: { name: 'Riley Contact', phoneNumber: '+15551230988' } });
    shell(`pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
    shell(`pm grant ${PKG} android.permission.ACCESS_BACKGROUND_LOCATION`);
    geo(BASE.lat, BASE.lng);
    await landingPage.signInBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.signInBtn.click();
    await authPage.login(email, PASSWORD);
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });

    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    await (await profilePage.scrollToElement('~recovery-tracking-switch')).click();
    await $('//*[@text="Keep tracking after an emergency?"]').waitForDisplayed({ timeout: 10000 });
    await $('android=new UiSelector().resourceId("android:id/button1")').click();
    await waitFor(async () => (await api.call('/api/emergency/recovery-consent')).body.enabled, { timeout: 15000, message: 'consent' });
    await driver.back();
    await driver.back();
  });

  it('force-stop: Android stops all tracking (expected); reopening the app resumes it', async () => {
    await sosIntoRecovery();
    shell(`am force-stop ${PKG}`);
    expect(servicesRunning()).toBe(false);
    await pause(5000);
    const stoppedAt = await pointCount();
    await driveTo(0, 400, 75);
    expect(await pointCount()).toBe(stoppedAt); // nothing while force-stopped — a platform limit
    await reopenApp();
    await waitFor(() => servicesRunning(), { timeout: 60000, message: 'location service after reopening' });
    await driveTo(400, 700, 60);
    await waitFor(async () => (await pointCount()) > stoppedAt, { timeout: 90000, message: 'points after reopening' });
    expect((await tracking()).state).toBe('RECOVERY_TRACKING');
  });

  it('location permission removed: tracking ends on the phone and the server, with the reason', async () => {
    shell(`pm revoke ${PKG} android.permission.ACCESS_BACKGROUND_LOCATION`); // Android kills the app
    await pause(3000);
    await reopenApp();
    const t = await waitFor(async () => {
      const current = await tracking();
      return current.state === 'CLOSED' ? current : null;
    }, { timeout: 60000, message: 'server to close tracking' });
    expect(t.recovery.endReason).toBe('permission_revoked');
    expect(await $('~phone-recovered-btn').isExisting()).toBe(false);
    shell(`pm grant ${PKG} android.permission.ACCESS_BACKGROUND_LOCATION`);
  });

  it('72-hour expiry: once past it, the server refuses points and the phone stops on its next upload', async () => {
    await reopenApp();
    await sosIntoRecovery();
    const prisma = testDb();
    await prisma.emergencyEvent.update({ where: { id: emergencyId }, data: { recoveryExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.$disconnect();
    expect((await tracking()).recovery.endReason).toBe('expired');
    await driveTo(0, 300, 40);
    await waitFor(async () => !(await $('~phone-recovered-btn').isExisting()), { timeout: 120000, message: 'phone to stop' });
    await waitFor(() => !servicesRunning(), { timeout: 60000, message: 'location service to stop' });
  });

  it('remote stop while the phone is offline: points it queues after the stop never land', async () => {
    await reopenApp();
    await sosIntoRecovery();
    shell('svc wifi disable');
    shell('svc data disable');
    try {
      await driveTo(0, 200, 30); // queued on the phone before the stop
      const stopAt = Date.now();
      const stop = await api.call(`/api/emergency/${emergencyId}/recovery/stop`, { method: 'POST', body: { reason: 'remote_stop' } });
      expect(stop.body.state).toBe('CLOSED');
      await driveTo(200, 500, 45); // queued on the phone after the stop
      shell('svc wifi enable');
      shell('svc data enable');
      await waitFor(async () => !(await $('~phone-recovered-btn').isExisting()), { timeout: 150000, message: 'phone to stop after reconnecting' });
      await waitFor(() => !servicesRunning(), { timeout: 60000, message: 'foreground service to stop' });
      const r = (await api.call(`/api/emergency/${emergencyId}/route`)).body;
      const late = r.points.filter((p) => Date.parse(p.recordedAt) > stopAt);
      expect(late).toHaveLength(0);
      console.log(`Offline remote stop: ${r.pointCount} points kept, none after the stop.`);
    } finally {
      shell('svc wifi enable');
      shell('svc data enable');
    }
  });

  it('turning the setting off during tracking stops it on the phone and the server', async () => {
    await reopenApp();
    await sosIntoRecovery();
    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    const toggle = await profilePage.scrollToElement('~recovery-tracking-switch');
    expect(await toggle.getAttribute('checked')).toBe('true');
    await toggle.click();
    const t = await waitFor(async () => {
      const current = await tracking();
      return current.state === 'CLOSED' ? current : null;
    }, { timeout: 30000, message: 'server to close tracking' });
    expect(t.recovery.endReason).toBe('consent_withdrawn');
    expect((await api.call('/api/emergency/recovery-consent')).body.enabled).toBe(false);
    await waitFor(() => !servicesRunning(), { timeout: 30000, message: 'foreground service to stop' });
    // A new SOS now ends normally, without recovery tracking.
    await driver.back();
    await driver.back();
    await tabBar.emergencyBtn.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.waitForLiveScreen(20000);
    await emergencyPage.waitForRecordingPhase(30000);
    const second = (await api.call('/api/emergency')).body[0].id;
    await stayAt(0, 20);
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
    await pause(8000);
    const after = (await api.call(`/api/emergency/${second}/tracking`)).body;
    expect(after).toEqual({ state: 'CLOSED', recovery: null });
    expect(servicesRunning()).toBe(false);
    // Turn it back on for the reboot session below.
    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    await (await profilePage.scrollToElement('~recovery-tracking-switch')).click();
    await $('//*[@text="Keep tracking after an emergency?"]').waitForDisplayed({ timeout: 10000 });
    await $('android=new UiSelector().resourceId("android:id/button1")').click();
    await waitFor(async () => (await api.call('/api/emergency/recovery-consent')).body.enabled, { timeout: 15000, message: 'consent' });
    await driver.back();
    await driver.back();
  });

  it('leaves one recovery session running for the reboot check', async () => {
    await sosIntoRecovery();
    if (process.env.E2E_REBOOT_FILE) {
      fs.writeFileSync(process.env.E2E_REBOOT_FILE, JSON.stringify({ emergencyId, token: api.token }));
    }
    expect(servicesRunning()).toBe(true);
  });
});
