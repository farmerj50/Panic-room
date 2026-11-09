// Release builds are minified with R8. Without this keep rule, Expo's record
// conversion breaks and Location.startLocationUpdatesAsync rejects every call
// (NullPointerException) — Background Location Monitoring and recovery
// tracking then never start. Found on the emulator, 2026-11-09.
import fs from 'fs';
import path from 'path';

test('app.json keeps Expo record classes from R8', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../app.json'), 'utf8'));
  const buildProperties = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
  expect(buildProperties[1].android.enableMinifyInReleaseBuilds).toBe(true);
  expect(buildProperties[1].android.extraProguardRules).toContain('-keep class expo.modules.kotlin.records.** { *; }');
});

// expo-task-manager loads its headless JS loader by the class name in the
// manifest meta-data. R8 removed the class, so a background location job that
// arrived while the app wasn't running crashed it ("Bes keeps stopping",
// ClassNotFoundException → NullPointerException in TaskService). Found on the
// emulator after revoking location permission, 2026-11-09.
test('app.json keeps the headless app loader that background tasks load by name', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../app.json'), 'utf8'));
  const buildProperties = appJson.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
  expect(buildProperties[1].android.extraProguardRules).toContain('-keep class expo.modules.adapters.react.apploader.** { *; }');
});
