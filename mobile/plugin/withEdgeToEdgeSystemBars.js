const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

// Expo's own SystemBars prebuild plugin unconditionally injects the
// deprecated android:statusBarColor / android:navigationBarColor theme
// items — no app.json key disables this in SDK 56. Strip them post-hoc.
// Defensive on purpose: if a future Expo SDK bump stops injecting these
// items, fail the prebuild loudly rather than silently no-op.
const DEPRECATED_ITEMS = ['android:statusBarColor', 'android:navigationBarColor'];

module.exports = function withEdgeToEdgeSystemBars(config) {
  return withAndroidStyles(config, (config) => {
    const parent = AndroidConfig.Styles.getAppThemeGroup();
    for (const name of DEPRECATED_ITEMS) {
      const existing = AndroidConfig.Styles.getStylesItem({ xml: config.modResults, parent, name });
      if (!existing) {
        throw new Error(
          `withEdgeToEdgeSystemBars: expected Expo's default SystemBars plugin ` +
            `to have added ${JSON.stringify(name)} to AppTheme in styles.xml, but ` +
            `it was not there — Expo's default Android config-plugin behavior ` +
            `likely changed. Re-check whether this workaround is still needed.`,
        );
      }
      config.modResults = AndroidConfig.Styles.removeStylesItem({ xml: config.modResults, parent, name });
    }
    return config;
  });
};
