const fs = require('fs');
const path = require('path');
const { withAppBuildGradle } = require('expo/config-plugins');

// Emergency recordings must be written outside the app cache — Android
// purges caches under storage pressure, which deleted clips mid-recording.
// That depends on two patch-package patches (patches/expo-camera,
// patches/expo-audio) AND on both modules being built from source
// (package.json expo.autolinking.android.buildFromSource), since Expo's
// prebuilt AARs ignore patched sources.
//
// Either can silently disappear (npm install --ignore-scripts, an Expo
// upgrade that bumps versions, a removed config line). This fails loudly
// instead: at prebuild, and — via a task injected into app/build.gradle —
// before every Android build.
const CHECKS = [
  {
    file: 'node_modules/expo-camera/android/src/main/java/expo/modules/camera/CameraViewModule.kt',
    marker: 'view.record(options, promise, recordingDirectory)',
  },
  {
    file: 'node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioRecorder.kt',
    marker: 'File(File(context.filesDir, "bes-recording"), "Audio")',
  },
];
const MODULES = ['expo-camera', 'expo-audio'];

function verify(projectRoot) {
  const problems = [];
  for (const { file, marker } of CHECKS) {
    const full = path.join(projectRoot, file);
    if (!fs.existsSync(full) || !fs.readFileSync(full, 'utf8').includes(marker)) {
      problems.push(`${file} is not patched (run \`npx patch-package\`; check patches/ matches the installed version)`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const fromSource = pkg?.expo?.autolinking?.android?.buildFromSource ?? [];
  for (const name of MODULES) {
    if (!fromSource.includes(name)) problems.push(`package.json expo.autolinking.android.buildFromSource is missing ${name}`);
  }
  if (problems.length) {
    throw new Error(
      'withEvidenceRecordingGuard: Emergency recordings would be written to the purgeable cache again:\n  - ' +
        problems.join('\n  - '),
    );
  }
}

const MARKER = '// bes:evidence-recording-guard';
const gradleTask = () => `
${MARKER}
// Fails the build if the expo-camera / expo-audio recording patches are missing
// (see plugin/withEvidenceRecordingGuard.js).
def besEvidenceRecordingChecks = [
${CHECKS.map((c) => `    [file: "${c.file}", marker: '${c.marker.replace(/'/g, "\\'")}'],`).join('\n')}
]
tasks.register("besVerifyEvidenceRecordingPatches") {
    doLast {
        def root = rootProject.projectDir.parentFile
        besEvidenceRecordingChecks.each { check ->
            def f = new File(root, check.file)
            if (!f.exists() || !f.text.contains(check.marker)) {
                throw new GradleException("Emergency recording patch missing: \${check.file}. Run npx patch-package.")
            }
        }
        def pkg = new groovy.json.JsonSlurper().parse(new File(root, "package.json"))
        def fromSource = pkg?.expo?.autolinking?.android?.buildFromSource ?: []
        ${JSON.stringify(MODULES)}.each { name ->
            if (!fromSource.contains(name)) {
                throw new GradleException("package.json expo.autolinking.android.buildFromSource is missing \${name}")
            }
        }
    }
}
preBuild.dependsOn("besVerifyEvidenceRecordingPatches")
`;

module.exports = function withEvidenceRecordingGuard(config) {
  return withAppBuildGradle(config, (config) => {
    verify(config.modRequest.projectRoot);
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += gradleTask();
    }
    return config;
  });
};

module.exports.verify = verify;
module.exports.gradleTask = gradleTask;
