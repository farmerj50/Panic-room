import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require('../../../plugin/withEvidenceRecordingGuard');

const CAMERA = 'node_modules/expo-camera/android/src/main/java/expo/modules/camera/CameraViewModule.kt';
const AUDIO = 'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt';

function project({ camera = true, audio = true, fromSource = ['expo-camera', 'expo-audio'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bes-guard-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(CAMERA, camera ? 'view.record(options, promise, recordingDirectory)' : 'view.record(options, promise, cacheDirectory)');
  write(AUDIO, audio ? 'File(File(context.filesDir, "bes-recording"), "Audio")' : 'File(context.cacheDir, "Audio")');
  write('package.json', JSON.stringify({ expo: { autolinking: { android: { buildFromSource: fromSource } } } }));
  return root;
}

describe('withEvidenceRecordingGuard', () => {
  it('passes when both patches are applied and both modules build from source', () => {
    expect(() => guard.verify(project())).not.toThrow();
  });

  it('fails the prebuild if a patch is missing', () => {
    expect(() => guard.verify(project({ camera: false }))).toThrow(/expo-camera.*not patched/);
    expect(() => guard.verify(project({ audio: false }))).toThrow(/expo-audio.*not patched/);
  });

  it('fails the prebuild if a module would use its prebuilt (unpatched) AAR', () => {
    expect(() => guard.verify(project({ fromSource: ['expo-camera'] }))).toThrow(/buildFromSource is missing expo-audio/);
  });

  it('adds a Gradle check that runs before every Android build', () => {
    const task = guard.gradleTask();
    expect(task).toContain('preBuild.dependsOn("besVerifyEvidenceRecordingPatches")');
    expect(task).toContain(CAMERA);
    expect(task).toContain(AUDIO);
  });

  it('is registered in app.json', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../app.json'), 'utf8'));
    expect(app.expo.plugins).toContain('./plugin/withEvidenceRecordingGuard');
  });
});
