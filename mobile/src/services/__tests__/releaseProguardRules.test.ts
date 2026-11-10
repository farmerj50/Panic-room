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

// expo-task-manager drops its JS task manager when the headless loader is
// invalidated, even when the app UI has taken over the same React host. Later
// background location events then wait forever for a host start that never
// comes, and recovery tracking stalls silently. Found on the emulator,
// 2026-11-09; fixed by patches/expo-task-manager+56.0.19.patch.
test('expo-task-manager keeps its task manager after the UI takes over a headless start', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../node_modules/expo-task-manager/package.json'), 'utf8'));
  expect(pkg.version).toBe('56.0.19'); // re-check the patch when this package is upgraded
  // The prebuilt .aar ignores source patches, so the module must build from source.
  const appPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
  expect(appPkg.expo.autolinking.android.buildFromSource).toContain('expo-task-manager');
  const patched = fs.readFileSync(
    path.join(__dirname, '../../../node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskService.java'),
    'utf8',
  );
  expect(patched).toContain('isReactHostOwnedByActivity()');
  expect(patched).toContain('sTaskManagers.put(appScopeKey, headlessRef)');
});
