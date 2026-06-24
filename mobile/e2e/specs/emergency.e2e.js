describe('PanicRoom emergency activation flow', () => {
  it('activates emergency mode, starts recording, and cleanly stops on Exit', async () => {
    // ── Land on the public landing page, then start registration ──────────
    // Generous timeout: fresh install + cold JS bundle fetch from Metro can take a while.
    const createAccountBtn = await $('~landing-create-account-btn');
    await createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await createAccountBtn.click(); // navigates straight into Auth with mode=register

    const emailInput = await $('~auth-email-input');
    const passwordInput = await $('~auth-password-input');
    await emailInput.waitForDisplayed({ timeout: 10000 });
    await emailInput.setValue(`e2e-test-${Date.now()}@panicroom.test`);
    await passwordInput.setValue('TestPass1234!');

    // The form card grows with each register step (stepper + panel content),
    // pushing the submit button below the fold — scroll it into view before
    // each tap rather than relying on a single cached, possibly off-screen ref.
    const scrollDown = async () => {
      await driver.execute('mobile: swipeGesture', {
        left: 100, top: 600, width: 800, height: 1600,
        direction: 'up', percent: 0.9,
      });
      await driver.pause(300);
    };

    await (await $('~auth-submit-btn')).click(); // account -> contact
    await driver.pause(500);
    await scrollDown();
    await (await $('~auth-submit-btn')).click(); // contact -> permissions (no contact filled, skipped by validation)
    await driver.pause(500);
    await scrollDown();
    await (await $('~auth-submit-btn')).click(); // permissions -> createAccount()

    // ── Navigate from Home to the Emergency tab ──────────────────────────
    // Generous timeout: registration is a real network round-trip to the backend.
    const emergencyTab = await $('~tab-emergency-btn');
    await emergencyTab.waitForDisplayed({ timeout: 45000 });
    await emergencyTab.click();

    // ── Countdown screen ──────────────────────────────────────────────────
    const countdownScreen = await $('~emergency-countdown-screen');
    await countdownScreen.waitForDisplayed({ timeout: 15000 });

    const countdownNumber = await $('~emergency-countdown-number');
    const startCount = parseInt(await countdownNumber.getText(), 10);
    console.log(`Countdown started at ${startCount}`);
    expect(startCount).toBeGreaterThan(0);

    // ── Wait for countdown to finish and activation to begin ─────────────
    // The screen flips from "countdown" to the live layout once count hits 0.
    // A system "Location Accuracy" dialog (a Google Play Services nudge,
    // separate from the standard runtime permission grant) can pop up the
    // moment location is requested, covering the whole screen and hiding
    // emergency-live-screen underneath — so dismiss it on every poll tick.
    const liveScreen = await $('~emergency-live-screen');
    await driver.waitUntil(
      async () => {
        // Tap "Turn on" (not "No thanks") — declining leaves location
        // settings unsatisfied, which makes the real GPS lookup fail later.
        const turnOnBtn = await $('//*[@text="Turn on"]');
        if (await turnOnBtn.isExisting()) {
          console.log('Accepting system "Location Accuracy" dialog (Turn on).');
          await turnOnBtn.click();
          await driver.pause(500);
        }
        return liveScreen.isDisplayed();
      },
      { timeout: (startCount + 10) * 1000, interval: 500, timeoutMsg: 'Live screen never appeared' },
    );

    // ── Confirm camera permission flow did not silently fail ─────────────
    // Either the live CameraView mounts, or the fallback explains why not —
    // both are valid states, but the screen must not crash.
    const cameraPanel = await $('~emergency-camera-panel');
    await cameraPanel.waitForDisplayed({ timeout: 10000 });

    const cameraView = await $('~emergency-camera-view');
    const cameraFallback = await $('~emergency-camera-fallback');
    const cameraViewShown = await cameraView.isExisting();
    const fallbackShown = await cameraFallback.isExisting();
    expect(cameraViewShown || fallbackShown).toBe(true);

    if (cameraViewShown) {
      console.log('Camera permission granted — live preview mounted.');
    } else {
      const fallbackText = await cameraFallback.getText();
      console.log(`Camera not active — fallback shown: "${fallbackText}"`);
    }

    // ── Wait for the phase to reach "recording" (LIVE timer running) ─────
    const recLabel = await $('~emergency-rec-label');
    await driver.waitUntil(
      async () => (await recLabel.getText()).startsWith('LIVE'),
      { timeout: 15000, timeoutMsg: 'Emergency never reached the recording phase' },
    );

    // ── GPS should have resolved (emulator's default simulated location) ─
    const gpsText = await $('~emergency-gps-text');
    if (await gpsText.isExisting()) {
      console.log(`GPS resolved: ${await gpsText.getText()}`);
    } else {
      console.log('GPS text not shown — location may still be resolving or denied.');
    }

    const statusText = await $('~emergency-status-text');
    console.log(`Status message: ${await statusText.getText()}`);

    // ── Press Exit and verify the app returns cleanly to Home ────────────
    // This exercises the camera/audio teardown path (stopEmergencyAssets) —
    // the bug we fixed was streams never releasing on Stop/Exit on web;
    // on native this confirms the same code path doesn't crash or hang.
    // returnHome() navigates to the Home tab, not back to the countdown
    // screen, so the tab bar (and its Emergency button) reappearing is the
    // signal that teardown finished and the app is still responsive.
    const exitBtn = await $('~emergency-exit-btn');
    await exitBtn.click();

    await emergencyTab.waitForDisplayed({ timeout: 15000 });
    console.log('Returned to Home after Exit — teardown completed without crashing.');

    // Re-entering Emergency should start a fresh countdown — confirms the
    // app is still fully responsive after teardown, not just back on Home.
    await emergencyTab.click();
    await countdownScreen.waitForDisplayed({ timeout: 15000 });
    const countAfterExit = parseInt(await countdownNumber.getText(), 10);
    expect(countAfterExit).toBeGreaterThan(0);
  });
});
