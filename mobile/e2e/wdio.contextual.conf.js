const path = require('path');

// Dedicated config for verifying the contextual-onboarding A/B experiment
// (mobile/src/services/experiments.ts). Differs from wdio.conf.js in two
// load-bearing ways:
//   - Points at the DEBUG apk (fetches JS live from the already-running
//     Metro dev server against the local backend), not the release apk —
//     the release apk was never rebuilt with today's experiment code and
//     points at production anyway.
//   - autoGrantPermissions is FALSE. The whole point of this experiment is
//     that camera/mic/location are requested contextually rather than
//     pre-granted; wdio.conf.js's autoGrantPermissions:true would make
//     every contextual ask a no-op (status already 'granted' before the
//     app ever asks), defeating the test.
exports.config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',

  specs: ['./specs/contextual-onboarding.e2e.js'],
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
      'appium:appPackage': 'com.ginslayer.besapp',
      'appium:appActivity': '.MainActivity',
      'appium:autoGrantPermissions': false,
      'appium:skipUnlock': true,
      'appium:newCommandTimeout': 240,
      'appium:appWaitForLaunch': true,
      'appium:appWaitDuration': 60000,
      'appium:androidInstallTimeout': 180000,
      // Needed for `mobile: clearApp` (used between attempts to force a
      // fresh AsyncStorage / variant coin-flip) and `mobile: shell` (used
      // to read dumpsys permission state for assertions).
      'appium:relaxedSecurity': true,
    },
  ],

  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 15000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 300000,
  },

  afterTest: async function (test, context, { passed }) {
    if (passed) return;
    const fs = require('fs');
    try {
      const source = await browser.getPageSource();
      fs.writeFileSync(path.join(__dirname, 'contextual-failure-source.xml'), source);
      const screenshot = await browser.takeScreenshot();
      fs.writeFileSync(path.join(__dirname, 'contextual-failure-screenshot.png'), Buffer.from(screenshot, 'base64'));
    } catch (e) {
      console.error('Failed to capture failure artifacts:', e);
    }
  },
};
