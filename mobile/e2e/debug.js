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
      'appium:newCommandTimeout': 240,
      'appium:appWaitForLaunch': true,
      'appium:appWaitDuration': 60000,
      'appium:androidInstallTimeout': 180000,
    },
  });

  console.log('Session created. Waiting 8s for JS bundle to load...');
  await driver.pause(8000);

  const source = await driver.getPageSource();
  fs.writeFileSync(path.join(__dirname, 'debug-source.xml'), source);
  console.log('Page source written to e2e/debug-source.xml');

  const screenshot = await driver.takeScreenshot();
  fs.writeFileSync(path.join(__dirname, 'debug-screenshot.png'), Buffer.from(screenshot, 'base64'));
  console.log('Screenshot written to e2e/debug-screenshot.png');

  await driver.deleteSession();
})().catch((err) => {
  console.error('Debug script failed:', err);
  process.exit(1);
});
