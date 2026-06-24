const path = require('path');

exports.config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',

  specs: ['./specs/**/*.e2e.js'],
  maxInstances: 1,

  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'PanicRoom_Test',
      'appium:udid': 'emulator-5554',
      'appium:app': path.join(
        __dirname,
        '..',
        'android',
        'app',
        'build',
        'outputs',
        'apk',
        'debug',
        'app-debug.apk',
      ),
      'appium:appPackage': 'com.panicroom.mobile',
      'appium:appActivity': '.MainActivity',
      // Grants every permission declared in the manifest at install time so
      // runtime permission dialogs (camera/mic/location) never block the test.
      'appium:autoGrantPermissions': true,
      // The emulator has no lock screen, so Appium's unlock-by-swipe gesture
      // pulls open the notification shade instead, covering the app for the
      // whole session. Skip it entirely.
      'appium:skipUnlock': true,
      'appium:newCommandTimeout': 240,
      'appium:appWaitForLaunch': true,
      'appium:appWaitDuration': 60000,
      'appium:androidInstallTimeout': 180000,
    },
  ],

  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 15000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,

  // Appium is started and managed separately (standalone, long-lived process)
  // rather than through @wdio/appium-service, which has been unreliable here
  // (intermittent "did not start within expected time" on this machine).

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 180000,
  },

  afterTest: async function (test, context, { passed }) {
    if (passed) return;
    const fs = require('fs');
    try {
      const source = await browser.getPageSource();
      fs.writeFileSync(path.join(__dirname, 'failure-source.xml'), source);
      const screenshot = await browser.takeScreenshot();
      fs.writeFileSync(path.join(__dirname, 'failure-screenshot.png'), Buffer.from(screenshot, 'base64'));
    } catch (e) {
      console.error('Failed to capture failure artifacts:', e);
    }
  },
};
