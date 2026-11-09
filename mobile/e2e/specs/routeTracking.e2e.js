// Route history, stops, full-name call announcement, Live View route and
// phone recovery tracking — against the LOCAL test backend only (E2E_LOCAL_BACKEND=1,
// API at E2E_API_URL, default http://localhost:5055, started with the Twilio stub).
//
// GPS is simulated with `adb emu geo fix`; stops need real time (3+ minutes),
// so this spec is long (~20 min). Run with --mochaOpts.timeout 1800000.
//
// E2E_TWILIO_LOG: path of the Twilio stub's log, to check the spoken text.
const fs = require('fs');

const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const onboardingPage = require('../pageobjects/onboarding.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const emergencyPage = require('../pageobjects/emergency.po');

const { PKG, M, BASE, shell, geo, makeApi, stayAt, driveTo, waitFor, trackingServiceInForeground } = require('../helpers/routeTracking');

const NAME = 'Jordan Avery Quinn';
const PASSWORD = 'TestPass1234!';
const client = makeApi();
const api = (path, opts) => client.call(path, opts);

let email;
let emergencyId;

const route = async () => (await api(`/api/emergency/${emergencyId}/route`)).body;

(process.env.E2E_LOCAL_BACKEND === '1' ? describe : describe.skip)('Route history and recovery tracking', () => {
  before(async () => {
    await driver.updateSettings({ waitForIdleTimeout: 0 });
    email = `e2e-route-${Date.now()}@panicroom.test`;
    const reg = await api('/api/auth/register', { method: 'POST', auth: false, body: { email, password: PASSWORD, name: NAME } });
    expect(reg.status).toBe(201);
    Object.assign(client, { token: reg.body.accessToken, email, password: PASSWORD });
    const contact = await api('/api/contacts', { method: 'POST', body: { name: 'Riley Contact', phoneNumber: '+15551230987' } });
    expect(contact.status).toBe(201);
    // "Allow all the time" can't be tapped through Appium (it's a system
    // settings page on Android 11+); grant it the way a person would have.
    shell(`pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
    shell(`pm grant ${PKG} android.permission.ACCESS_BACKGROUND_LOCATION`);
    geo(BASE.lat, BASE.lng);

    await landingPage.signInBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.signInBtn.click();
    await authPage.login(email, PASSWORD);
    await onboardingPage.skipAll();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
  });

  after(() => {
    for (const cmd of ['svc wifi enable', 'svc data enable', 'dumpsys battery reset', 'settings put global low_power 0']) {
      try {
        shell(cmd);
      } catch {}
    }
  });

  it('opt-in: explanation and consent, then recorded on the server', async () => {
    expect((await api('/api/emergency/recovery-consent')).body.enabled).toBe(false);
    await tabBar.profileBtn.click();
    await (await profilePage.scrollToElement('//*[@text="Settings"]')).click();
    await (await profilePage.scrollToElement('//*[@text="Emergency Settings"]')).click();
    const toggle = await profilePage.scrollToElement('~recovery-tracking-switch');
    expect(await toggle.getAttribute('checked')).toBe('false');
    await toggle.click();
    const title = $('//*[@text="Keep tracking after an emergency?"]');
    await title.waitForDisplayed({ timeout: 10000 });
    await $('android=new UiSelector().resourceId("android:id/button1")').click(); // Continue
    await driver.waitUntil(async () => (await $('~recovery-tracking-switch').getAttribute('checked')) === 'true', {
      timeout: 15000,
      timeoutMsg: 'recovery tracking switch did not turn on',
    });
    expect((await api('/api/emergency/recovery-consent')).body.enabled).toBe(true);
    await driver.back();
    await driver.back();
  });

  it('SOS: the call names the person; the route records two stops', async () => {
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });
    const twilioLog = process.env.E2E_TWILIO_LOG;
    const logBefore = twilioLog && fs.existsSync(twilioLog) ? fs.readFileSync(twilioLog, 'utf8').length : 0;
    await tabBar.emergencyBtn.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.waitForLiveScreen(20000);
    await emergencyPage.dismissLocationAccuracyDialogIfPresent();
    await emergencyPage.waitForRecordingPhase(30000);

    const list = (await api('/api/emergency')).body;
    emergencyId = list[0].id;
    expect(list[0].tracking.state).toBe('SOS_ACTIVE');

    if (twilioLog) {
      const said = await waitFor(
        () => {
          const added = fs.existsSync(twilioLog) ? fs.readFileSync(twilioLog, 'utf8').slice(logBefore) : '';
          const call = added.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.kind === 'call');
          return call && call.say;
        },
        { timeout: 60000, message: 'the trusted-contact call' },
      );
      console.log(`Announcement: ${said}`);
      expect(said).toContain(`Bes emergency activated by ${NAME}. Location:`);
    }

    // Stop 1 (3.5 min) → drive 600 m → stop 2 (3.5 min) → drive on.
    await stayAt(0, 210);
    await driveTo(0, 600, 60);
    await stayAt(600, 210);
    await driveTo(600, 900, 30);

    const r = await waitFor(async () => {
      const current = await route();
      return current.stops.length >= 2 ? current : null;
    }, { timeout: 90_000, message: 'two stops' });
    console.log(`Stops: ${JSON.stringify(r.stops.map((s) => ({ arrivedAt: s.arrivedAt, min: Math.round(s.durationSeconds / 60) })))}`);
    expect(r.stops[0].durationSeconds).toBeGreaterThanOrEqual(180);
    expect(r.stops[1].durationSeconds).toBeGreaterThanOrEqual(180);
    expect(Math.abs(r.stops[1].latitude - (BASE.lat + 600 * M))).toBeLessThan(50 * M);
    expect(r.freshness.status).toBe('live');
  });

  it('ending the SOS moves into recovery tracking; points keep arriving with the screen locked', async () => {
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 20000 });
    const tracking = await waitFor(async () => {
      const t = (await api(`/api/emergency/${emergencyId}/tracking`)).body;
      return t.state === 'RECOVERY_TRACKING' ? t : null;
    }, { timeout: 60_000, message: 'RECOVERY_TRACKING' });
    expect(new Date(tracking.recovery.expiresAt) - new Date(tracking.recovery.startedAt)).toBe(72 * 3600 * 1000);
    await $('~phone-recovered-btn').waitForDisplayed({ timeout: 15000 });
    expect(trackingServiceInForeground()).toBe(true);
    // The persistent notification, as the person sees it in the shade.
    await driver.openNotifications();
    // The shade is a separate system window: element search doesn't reach
    // it reliably, the page source does.
    await waitFor(async () => (await driver.getPageSource()).includes('Bes recovery tracking is on'), {
      timeout: 15000,
      interval: 1500,
      message: 'the recovery notification in the shade',
    });
    shell('cmd statusbar collapse');

    // Background + lock the screen, keep moving.
    await driver.execute('mobile: shell', { command: 'input', args: ['keyevent', 'KEYCODE_HOME'] });
    shell('input keyevent KEYCODE_POWER');
    const before = (await route()).pointCount;
    const lockedFrom = Date.now();
    await driveTo(900, 1500, 120);
    const after = await waitFor(async () => {
      const current = await route();
      const fresh = current.latest && new Date(current.latest.recordedAt).getTime() > lockedFrom;
      return current.pointCount >= before + 2 && fresh ? current : null;
    }, { timeout: 90_000, message: 'points while locked' });
    console.log(`While locked: ${after.pointCount - before} new points; latest ${after.latest.recordedAt}`);
    shell('input keyevent KEYCODE_WAKEUP');
    shell('wm dismiss-keyguard');
  });

  it('battery level and battery saver: points still arrive and report the battery', async () => {
    shell('dumpsys battery unplug');
    shell('dumpsys battery set level 23');
    shell('settings put global low_power 1');
    const since = Date.now();
    await stayAt(1500, 120);
    const r = await waitFor(async () => {
      const current = await route();
      return current.batteryLevel === 23 && new Date(current.latest.recordedAt).getTime() > since ? current : null;
    }, { timeout: 120_000, message: 'battery 23% on a new point' });
    expect(r.batteryLevel).toBe(23);
    shell('settings put global low_power 0');
    shell('dumpsys battery reset');
  });

  it('no network: points are buffered with their own times and uploaded, in order, when it returns', async () => {
    shell('svc wifi disable');
    shell('svc data disable');
    const offlineFrom = Date.now();
    const before = (await route()).pointCount;
    await driveTo(1500, 2100, 90);
    const offlineTo = Date.now();
    expect((await route()).pointCount).toBe(before); // nothing reached the server
    shell('svc wifi enable');
    shell('svc data enable');
    const r = await waitFor(async () => {
      const current = await route();
      const buffered = current.points.filter((p) => {
        const t = new Date(p.recordedAt).getTime();
        return t >= offlineFrom && t <= offlineTo;
      });
      return buffered.length >= 2 ? { current, buffered } : null;
    }, { timeout: 180_000, message: 'buffered points after reconnecting' });
    console.log(`Buffered while offline: ${r.buffered.length}`);
    const times = r.current.points.map((p) => new Date(p.recordedAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('Live View shows the route, stops, accuracy, battery and that tracking continues', async () => {
    const contacts = (await api('/api/contacts')).body;
    const share = await api(`/api/emergency/${emergencyId}/live-view/${contacts[0].id}/share`, { method: 'POST' });
    if (share.status === 404 || !share.body?.url) {
      console.log(`Live View not enabled on this backend (status ${share.status}) — skipped.`);
      return;
    }
    expect(share.body.shareMessage).toContain(`${NAME} activated a Bes emergency`);
    const viewerToken = share.body.url.split('#')[1];
    const state = await (await fetch(`${process.env.E2E_API_URL || 'http://localhost:5055'}/live/api/state`, { headers: { Authorization: `Bearer ${viewerToken}` } })).json();
    expect(state.ownerName).toBe(NAME);
    expect(state.tracking.state).toBe('RECOVERY_TRACKING');
    expect(state.route.points.length).toBeGreaterThan(10);
    expect(state.route.stops.length).toBeGreaterThanOrEqual(2);
    expect(state.latestLocation.accuracy).toBeDefined();
    expect(['live', 'delayed']).toContain(state.route.freshness.status);
  });

  it('stopped from another device: final on the server, the phone stops and Evidence shows the route', async () => {
    const stop = await api(`/api/emergency/${emergencyId}/recovery/stop`, { method: 'POST', body: { reason: 'remote_stop' } });
    expect(stop.body.state).toBe('CLOSED');
    const stoppedAt = Date.parse(stop.body.recovery.endedAt);
    await driveTo(2100, 2400, 30);
    // The phone learns on its next upload (~30 s) and stops: banner gone, notification gone.
    await waitFor(async () => !(await $('~phone-recovered-btn').isExisting()), { timeout: 120_000, message: 'banner to go' });
    await waitFor(() => !trackingServiceInForeground(), {
      timeout: 60_000,
      message: 'recovery foreground service to stop',
    });
    await driver.openNotifications();
    await driver.pause(1500);
    const shade = await driver.getPageSource();
    expect(shade).toContain('Clear all'); // the shade really is open
    expect(shade).not.toContain('Bes recovery tracking is on');
    shell('cmd statusbar collapse');
    await driver.activateApp(PKG);
    await driveTo(2400, 2600, 30);
    // Points recorded before the stop may still land (in flight / offline
    // backfill); nothing recorded after it may.
    const after = (await route()).points.filter((p) => Date.parse(p.recordedAt) > stoppedAt);
    expect(after).toHaveLength(0);

    await tabBar.profileBtn.click();
    await profilePage.scrollToElementAndClick('~profile-evidence-btn');
    await $('~evidence-route-btn').waitForDisplayed({ timeout: 15000 });
    await $('~evidence-route-btn').click();
    await $('~route-section').waitForDisplayed({ timeout: 20000 });
    await $('~route-map').waitForDisplayed({ timeout: 10000 });
    const status = await $('~route-tracking-status').getText();
    expect(status).toMatch(/Recovery tracking ended .*stopped from another device/);
    await driver.saveScreenshot('./e2e/screenshots/route-tracking-map.png').catch(() => {});
    expect(await (await profilePage.scrollToElement('~route-stop-1')).isExisting()).toBe(true);
    expect(await (await profilePage.scrollToElement('~route-stop-2')).isExisting()).toBe(true);
    await driver.saveScreenshot('./e2e/screenshots/route-tracking-evidence.png').catch(() => {});
  });
});
