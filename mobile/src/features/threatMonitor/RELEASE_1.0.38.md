# Bes 1.0.38 (versionCode 52) — release report

Full production release of the AI Monitor capabilities to all users. Branch
`release/1.0.38` (local, not pushed). It was built from `e88a107`.

## Artifact
| | |
|---|---|
| AAB | `C:\Users\gabby\Desktop\Bes AAB\bes-1.0.38-vc52.aab` (103,166,581 bytes) |
| SHA-256 | `839d1319a4d8ca18387f8534e91989f193b97af833a4387af6a20e63106ecb78` |
| JS bundle SHA-256 | `4ae7efa0aa90d78587f574a78b4842c9b28962f560531fb10044571cadbce557` |
| Package / version | `com.ginslayer.besapp`, versionCode 52, versionName 1.0.38 |
| Signing (upload key) | CN=John, OU=BES. SHA-1 `16:D5:39:38:DA:F6:6D:51:FD:C1:7D:E8:82:D8:71:1B:04:64:35:91`, the same key as vc41–vc51 |
| Permissions | Identical to vc51. No new permissions and no new foreground service. |
| Native | 50 64-bit libraries, all 16 KB aligned. ABIs: arm64-v8a, armeabi-v7a, x86, x86_64. |
| Models | `efficientdet_lite0`, `efficientdet_lite2`, `movenet_multipose_lightning` (on-device, unchanged) |
| vc51 | Untouched: `bes-1.0.37-vc51-internal.aab`, SHA-256 `2b0fc123…4161871` |

Build: clean worktree, `expo prebuild --clean`, then `gradlew bundleRelease`.

## Features and flags in this build
The flags are compiled in at build time. The proof is a JS rebundle in the same worktree:
- with the production flags, the hash is `4ae7efa0…`, identical to the AAB;
- with the movement-events flag removed, the hash is `62cf6f66…`, which differs.

| Feature | Flag | In vc52 |
|---|---|---|
| Person detection and tracking | `EXPO_PUBLIC_AI_MONITOR_ENABLED=1` | on |
| Fall / crowd candidates | `EXPO_PUBLIC_AI_THREATS_ENABLED=1` | on |
| Front/rear camera switch | `EXPO_PUBLIC_AI_CAMERA_FLIP_ENABLED=1` | on |
| Per-person proximity: getting closer, moving away, still, unsure | `EXPO_PUBLIC_AI_PROXIMITY_ENABLED=1` | on |
| Pursuit-like movement, close sudden interaction, possible struggle | `EXPO_PUBLIC_AI_BEHAVIOR_EVENTS_ENABLED=1` | on |
| Opt-in in-app alerts (proximity, movement events) | user setting | **off by default** |
| Test hooks, slow-model simulation | `EXPO_PUBLIC_AI_TEST_HOOKS`, `EXPO_PUBLIC_AI_MONITOR_SLOW_MS` | unset (off) |

Access:
- **No account, subscription or developer restrictions.** AI Monitor is on Android for every signed-in user, free.
- **The "Beta" label stays** as an honesty marker. It isn't an access gate.
- **The fight/assault threat detector stays disabled.** Movement events are a separate observation layer with neutral wording.

## Safety properties (unchanged and verified)
- AI observations never start Emergency, never contact trusted contacts and never call anyone. This is covered by the screen tests: no navigation, and a banner only.
- An SOS from the AI Monitor hands the camera to Emergency recording. Covered on the emulator by `aiMonitor` and `aiBehavior`.
- Wording is neutral, for example "Possible struggle" and "Fast movement after another person". "Unsure" and "Can't judge right now: …" are shown when the input is poor.
- Emergency, recording, evidence, location and contact code is byte-identical to vc51: `git diff e445e81..e88a107` touches only `features/threatMonitor`, `app.json`, e2e tests and the privacy policy.

## Disclosures
- **Privacy policy** (`backend/src/legal/privacy-policy.md`, dated October 27, 2026):
  - the AI Monitor section now covers the analysis of how close people are and how they move;
  - it lists every AI usage event actually sent: started/stopped, duration, analysis rate, camera switched, and opt-in alert shown with its general type;
  - the old text said "only started/stopped…", which 1.0.37 had already made inaccurate.

  It's served by the backend, so it goes live with the Railway deploy from `main`.
- **Camera permission text** already names AI Monitor. No change.
- **Play Data safety:** no new data types. Analytics events fall under the existing "App activity → App interactions". Confirm that entry is declared in Play Console before rollout.

## Tests
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Jest (full) | 50 suites, 533 passed, 2 skipped |
| Emulator regression: x86_64 APK with the production flag set, local backend | 15 specs, 52 tests, all passing after the reruns below |

| Spec | Tests | Notes |
|---|---|---|
| login | 2/2 | |
| contacts | 2/2 | Failed in the first run: the test clicked Save below the fold. Test fixed (scroll first), then passed. |
| backgrounding | 1/1 | |
| premium (subscriptions/paywall) | 1/1 | |
| accountDeletion | 2/2 | |
| lockScreenNotification (lock-screen SOS) | 1/1 | |
| emergency | 1/1 | |
| evidence | 1/1 | |
| contextual-onboarding | 4/4 | |
| offlineEmergency | 4/6 | See below. |
| socialSharing | 6/6 | |
| socialDiscoverability | 4/4 | UiAutomator hung in the batch run; it passed when rerun alone. |
| aiMonitor (includes SOS handoff, home long-press, lock screen) | 8/8 | |
| aiProximity (20 flips, permission revoke) | 5/5 | |
| aiBehavior (panel defaults, flips, SOS handoff, background) | 4/4 | |

**offlineEmergency details:**
- The first run failed: the emulator's network didn't come back after the offline toggle, and the rest cascaded.
- On rerun, the upload after reconnect, contacts alerted on reconnect, flaky signal with no duplicates, and kill/recovery all passed.
- The two **low-storage** tests can't reach the "video paused" tier (under 100 MB) on this freshly wiped emulator. The app's StatFs reading stays about 140 MB above what `dd` can fill. The app correctly showed the "reduced quality" tier for the 219 MB it measured.
- The pause tier is covered by Jest (`storageMonitor`, Emergency recording tests), and that code is unchanged since vc51.

**Not run:**
- `aiDashboard` and `aiFlags`: they need a test-hooks build or flag-matrix builds, and that code is unchanged since vc50.
- `aiResources`: a long soak.

The emulator can't show real people, so detection accuracy is measured in the field ([FIELD_EVALUATION.md](FIELD_EVALUATION.md)).

## Known limitations
See [BEHAVIOR_EVENTS.md](BEHAVIOR_EVENTS.md) and [PROXIMITY_1.0.37.md](PROXIMITY_1.0.37.md). In short:
- thresholds aren't calibrated on real footage;
- the analysis is 2D only;
- low frame rates hide fast strikes;
- overlapping bodies lose pose;
- sports, dancing and play-fighting are possible false positives.

## Release steps (each needs your explicit go-ahead)
1. Push `release/1.0.38` and merge it to `main` (a PR, as with 1.0.37). Railway then redeploys the backend (privacy policy only; no migrations), and the website rebuilds; it has no AI Monitor.
2. Check https://panic-room-production.up.railway.app/legal/privacy shows "October 27, 2026".
3. Play Console → Production → upload `bes-1.0.38-vc52.aab` → rollout 100%.
4. Run the field evaluation with your testers.
