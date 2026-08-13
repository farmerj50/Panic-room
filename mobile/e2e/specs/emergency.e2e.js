const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

describe('PanicRoom emergency activation flow', () => {
  it('activates emergency mode, starts recording, and cleanly stops on Exit', async () => {
    // ── Land on the public landing page, then start registration ──────────
    // Generous timeout: fresh install + cold JS bundle fetch from Metro can take a while.
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click(); // navigates straight into Auth with mode=register

    await authPage.register(`e2e-test-${Date.now()}@panicroom.test`, 'TestPass1234!');

    // ── Navigate from Home to the Emergency tab ──────────────────────────
    // Generous timeout: registration is a real network round-trip to the backend.
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
    await tabBar.emergencyBtn.click();

    // ── Countdown screen ──────────────────────────────────────────────────
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });

    const startCount = parseInt(await emergencyPage.countdownNumber.getText(), 10);
    console.log(`Countdown started at ${startCount}`);
    expect(startCount).toBeGreaterThan(0);

    // ── Wait for countdown to finish and activation to begin ─────────────
    await emergencyPage.waitForLiveScreen((startCount + 10) * 1000);

    // ── Confirm camera permission flow did not silently fail ─────────────
    // Either the live CameraView mounts, or the fallback explains why not —
    // both are valid states, but the screen must not crash.
    await emergencyPage.cameraPanel.waitForDisplayed({ timeout: 10000 });

    const cameraViewShown = await emergencyPage.cameraView.isExisting();
    const fallbackShown = await emergencyPage.cameraFallback.isExisting();
    expect(cameraViewShown || fallbackShown).toBe(true);

    if (cameraViewShown) {
      console.log('Camera permission granted — live preview mounted.');
    } else {
      console.log(`Camera not active — fallback shown: "${await emergencyPage.cameraFallback.getText()}"`);
    }

    // ── Wait for the phase to reach "recording" (LIVE timer running) ─────
    await emergencyPage.waitForRecordingPhase();

    // ── GPS should have resolved (emulator's default simulated location) ─
    if (await emergencyPage.gpsText.isExisting()) {
      console.log(`GPS resolved: ${await emergencyPage.gpsText.getText()}`);
    } else {
      console.log('GPS text not shown — location may still be resolving or denied.');
    }

    console.log(`Status message: ${await emergencyPage.statusText.getText()}`);

    // ── Press Exit and verify the app returns cleanly to Home ────────────
    // This exercises the camera/audio teardown path (stopEmergencyAssets) —
    // the bug we fixed was streams never releasing on Stop/Exit on web;
    // on native this confirms the same code path doesn't crash or hang.
    // returnHome() navigates to the Home tab, not back to the countdown
    // screen, so the tab bar (and its Emergency button) reappearing is the
    // signal that teardown finished and the app is still responsive.
    await emergencyPage.exitBtn.click();

    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });
    console.log('Returned to Home after Exit — teardown completed without crashing.');

    // Re-entering Emergency should start a fresh countdown — confirms the
    // app is still fully responsive after teardown, not just back on Home.
    await tabBar.emergencyBtn.click();
    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    const countAfterExit = parseInt(await emergencyPage.countdownNumber.getText(), 10);
    expect(countAfterExit).toBeGreaterThan(0);
  });
});
