const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const emergencyPage = require('../pageobjects/emergency.po');

describe('PanicRoom app backgrounded during an active emergency', () => {
  it('survives being backgrounded and resumed without crashing or losing the live screen', async () => {
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-bg-${Date.now()}@panicroom.test`, 'TestPass1234!');

    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });
    await tabBar.emergencyBtn.click();

    await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
    const startCount = parseInt(await emergencyPage.countdownNumber.getText(), 10);
    await emergencyPage.waitForLiveScreen((startCount + 10) * 1000);
    await emergencyPage.waitForRecordingPhase();

    // Send the app to background for 5s, then foreground it again. This is
    // the same trigger the useAppStateEmergencyGuard hook listens for (unit
    // tested separately) — here we only assert the app itself survives the
    // transition, since full background-recording continuity is out of
    // scope for v1 (would need a native foreground-service module).
    await driver.background(5);

    // Still on the live emergency screen after resuming, not crashed/reset.
    await emergencyPage.liveScreen.waitForDisplayed({ timeout: 15000 });
    await emergencyPage.waitForRecordingPhase();

    // App is still fully responsive — Exit still works cleanly.
    await emergencyPage.exitBtn.click();
    await tabBar.emergencyBtn.waitForDisplayed({ timeout: 15000 });
  });
});
