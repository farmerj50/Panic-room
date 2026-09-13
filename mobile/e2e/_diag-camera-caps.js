const { remote } = require('webdriverio');
const path = require('path');

(async () => {
  const driver = await remote({
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'PanicRoom_Test',
      'appium:udid': 'emulator-5554',
      'appium:app': path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
      'appium:appPackage': 'com.ginslayer.besapp',
      'appium:appActivity': '.MainActivity',
      'appium:autoGrantPermissions': true,
      'appium:skipUnlock': true,
      'appium:newCommandTimeout': 240,
      'appium:appWaitForLaunch': true,
      'appium:appWaitDuration': 60000,
      'appium:androidInstallTimeout': 180000,
    },
  });

  global.driver = driver;
  global.$ = driver.$.bind(driver);
  global.$$ = driver.$$.bind(driver);

  const landingPage = require('./pageobjects/landing.po');
  const authPage = require('./pageobjects/auth.po');
  const tabBar = require('./pageobjects/tabBar.po');
  const emergencyPage = require('./pageobjects/emergency.po');

  await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
  await landingPage.createAccountBtn.click();
  await authPage.register(`e2e-diag-${Date.now()}@panicroom.test`, 'TestPass1234!');
  await tabBar.emergencyBtn.waitForDisplayed({ timeout: 45000 });

  await tabBar.emergencyBtn.click();
  await emergencyPage.countdownScreen.waitForDisplayed({ timeout: 15000 });
  const startCount = parseInt(await emergencyPage.countdownNumber.getText(), 10);
  await emergencyPage.waitForLiveScreen((startCount + 10) * 1000);
  await emergencyPage.waitForRecordingPhase(15000);
  await driver.pause(5000);

  console.log('DONE diag test');
  await driver.deleteSession();
})().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
