const { remote } = require('webdriverio');
const path = require('path');
const fs = require('fs');

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
      'appium:app': path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      'appium:appPackage': 'com.panicroom.mobile',
      'appium:appActivity': '.MainActivity',
      'appium:autoGrantPermissions': true,
      'appium:skipUnlock': true,
      'appium:newCommandTimeout': 240,
      'appium:appWaitForLaunch': true,
      'appium:appWaitDuration': 60000,
      'appium:androidInstallTimeout': 180000,
    },
  });

  const registerModeBtn = await driver.$('~auth-mode-register-btn');
  await registerModeBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
  await registerModeBtn.click();

  const emailInput = await driver.$('~auth-email-input');
  const passwordInput = await driver.$('~auth-password-input');
  await emailInput.waitForDisplayed({ timeout: 10000 });
  await emailInput.setValue(`e2e-debug-${Date.now()}@panicroom.test`);
  await passwordInput.setValue('TestPass1234!');

  const submitBtn = await driver.$('~auth-submit-btn');
  await submitBtn.click();
  await driver.pause(800);
  await submitBtn.click();
  await driver.pause(800);
  await submitBtn.click();

  console.log('Submitted registration. Waiting 10s for backend round-trip...');
  await driver.pause(10000);

  const source = await driver.getPageSource();
  fs.writeFileSync(path.join(__dirname, 'debug-source-after-register.xml'), source);
  console.log('Page source written to e2e/debug-source-after-register.xml');

  const screenshot = await driver.takeScreenshot();
  fs.writeFileSync(path.join(__dirname, 'debug-screenshot-after-register.png'), Buffer.from(screenshot, 'base64'));
  console.log('Screenshot written to e2e/debug-screenshot-after-register.png');

  await driver.deleteSession();
})().catch((err) => {
  console.error('Debug script failed:', err);
  process.exit(1);
});
