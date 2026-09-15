const { withAppBuildGradle } = require('expo/config-plugins');

// Switches the release build's default ProGuard template from the
// non-optimized proguard-android.txt (Expo's prebuild default) to
// Google's recommended proguard-android-optimize.txt — expo-build-
// properties has no option for this, so it's patched directly.
//
// Defensive on purpose: if a future Expo SDK bump changes the generated
// build.gradle text, a silent no-op here would mean this fix quietly
// stops applying with zero signal. Fail the prebuild loudly instead.
const FROM = 'getDefaultProguardFile("proguard-android.txt")';
const TO = 'getDefaultProguardFile("proguard-android-optimize.txt")';

module.exports = function withProguardOptimize(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(FROM)) {
      throw new Error(
        `withProguardOptimize: expected to find ${JSON.stringify(FROM)} in ` +
          'android/app/build.gradle but it was not there — the generated ' +
          'template likely changed. Update this plugin instead of letting ' +
          'it silently skip the proguard-android-optimize.txt switch.',
      );
    }
    config.modResults.contents = config.modResults.contents.replace(FROM, TO);
    return config;
  });
};
