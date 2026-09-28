const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

// expo-camera's `barcodeScannerEnabled: false` option (set in app.json)
// only switches play-services-code-scanner/mlkit-barcode-scanning from
// `implementation` to `compileOnly` in expo-camera's build.gradle — that
// keeps the unused ML Kit code out of the final DEX (a real size win) but
// does NOT stop the Android manifest merger from pulling in that library's
// own GmsBarcodeScanningDelegateActivity, which hardcodes
// android:screenOrientation="portrait" and is what Play Console's
// "remove orientation restrictions" recommendation actually flags. Barcode
// scanning isn't used anywhere in this app (CameraView is video-only, see
// EmergencyScreen.tsx) — explicitly remove the merged manifest node via
// the standard tools:node="remove" override.
const BARCODE_ACTIVITY = 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

module.exports = function withRemoveBarcodeScannerActivity(config) {
  return withAndroidManifest(config, (config) => {
    AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        'withRemoveBarcodeScannerActivity: AndroidManifest.xml has no <application> ' +
          'element to attach the manifest-merger removal override to.',
      );
    }
    application.activity = application.activity ?? [];
    application.activity.push({
      $: {
        'android:name': BARCODE_ACTIVITY,
        'tools:node': 'remove',
      },
    });
    return config;
  });
};
