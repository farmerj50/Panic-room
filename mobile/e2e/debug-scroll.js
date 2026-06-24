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
  await emailInput.setValue(`e2e-scroll-${Date.now()}@panicroom.test`);
  await passwordInput.setValue('TestPass1234!');

  // first click should still be visible without scrolling
  let submitBtn = await driver.$('~auth-submit-btn');
  console.log('Step1 submit exists:', await submitBtn.isExisting());
  await submitBtn.click();
  await driver.pause(800);

  // now on "contact" step - swipe up to scroll down and reveal the submit button
  await driver.execute('mobile: swipeGesture', {
    left: 100, top: 600, width: 800, height: 1600,
    direction: 'up', percent: 0.9,
  });
  await driver.pause(500);

  const source = await driver.getPageSource();
  fs.writeFileSync(path.join(__dirname, 'debug-source-scrolled.xml'), source);
  console.log('Wrote scrolled source');

  submitBtn = await driver.$('~auth-submit-btn');
  console.log('After scroll, submit exists:', await submitBtn.isExisting());

  const screenshot = await driver.takeScreenshot();
  fs.writeFileSync(path.join(__dirname, 'debug-screenshot-scrolled.png'), Buffer.from(screenshot, 'base64'));

  await driver.deleteSession();
})().catch((err) => {
  console.error('Debug script failed:', err);
  process.exit(1);
});
