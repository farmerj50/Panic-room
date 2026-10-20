import fs from 'fs';
import path from 'path';

// Emergency recordings must be written outside the app cache, which Android
// purges under storage pressure (it deleted clips mid-recording). That's done
// by patching expo-camera and expo-audio, and the patches only take effect if
// those modules are built from source instead of Expo's prebuilt AARs.
const root = path.join(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const patchFor = (name: string) => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  const file = path.join(root, 'patches', `${name}+${version}.patch`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
};

describe('evidence recordings stay out of the purgeable cache', () => {
  it('builds expo-camera and expo-audio from source so the patches apply', () => {
    expect(pkg.expo.autolinking.android.buildFromSource).toEqual(expect.arrayContaining(['expo-camera', 'expo-audio']));
    expect(pkg.scripts.postinstall).toBe('patch-package');
  });

  it('has a patch for the installed expo-camera that records into persistent files', () => {
    const patch = patchFor('expo-camera');
    expect(patch).not.toBeNull();
    expect(patch).toContain('+        view.record(options, promise, recordingDirectory)');
    expect(patch).toContain('persistentFilesDirectory, "bes-recording"');
  });

  it('has a patch for the installed expo-audio that records into persistent files', () => {
    const patch = patchFor('expo-audio');
    expect(patch).not.toBeNull();
    expect(patch).toContain('File(File(context.filesDir, "bes-recording"), "Audio")');
  });

  it('the patches are applied in node_modules', () => {
    const camera = fs.readFileSync(
      path.join(root, 'node_modules/expo-camera/android/src/main/java/expo/modules/camera/CameraViewModule.kt'),
      'utf8',
    );
    const audio = fs.readFileSync(
      path.join(root, 'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt'),
      'utf8',
    );
    expect(camera).toContain('view.record(options, promise, recordingDirectory)');
    expect(audio).toContain('"bes-recording"');
  });
});
