const { withAndroidManifest } = require('expo/config-plugins');

const SERVICE_NAME = 'expo.modules.backgroundcamera.BackgroundCameraService';
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
];

function ensurePermission(androidManifest, name) {
  const permissions = androidManifest.manifest['uses-permission'] ?? [];
  const exists = permissions.some((p) => p.$?.['android:name'] === name);
  if (!exists) {
    permissions.push({ $: { 'android:name': name } });
  }
  androidManifest.manifest['uses-permission'] = permissions;
}

function ensureService(androidManifest) {
  const application = androidManifest.manifest.application[0];
  const services = application.service ?? [];
  const exists = services.some((s) => s.$?.['android:name'] === SERVICE_NAME);
  if (!exists) {
    services.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:foregroundServiceType': 'camera|microphone',
        'android:exported': 'false',
      },
    });
  }
  application.service = services;
}

module.exports = function withBackgroundCamera(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    PERMISSIONS.forEach((name) => ensurePermission(androidManifest, name));
    ensureService(androidManifest);
    return config;
  });
};
