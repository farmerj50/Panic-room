# AI Monitor — camera flip + per-person proximity (1.0.37, flagged)

Branch `feature/ai-proximity` (from `release/1.0.36-ai`). Not production-ready until the physical-device checks below pass.

## Flags (both off by default; both also need `EXPO_PUBLIC_AI_MONITOR_ENABLED=1`)
- `EXPO_PUBLIC_AI_CAMERA_FLIP_ENABLED=1` — Flip button (`ai-monitor-flip-btn`), remembered under `bes_ai_monitor_facing`.
- `EXPO_PUBLIC_AI_PROXIMITY_ENABLED=1` — per-person chips, settings card, opt-in in-app alert (`bes_ai_proximity_settings`).

Rollback: build without the flag. No native, backend or Emergency changes; nothing to migrate.

## What it does
- Flip restarts the native camera inside the same monitoring session (status stays running, no Stop/Start).
  A camera-generation guard drops late frames and late `starting` events from the old camera; tracker, pose carry,
  threat engine, proximity history, alerts and warm-up all reset.
- Proximity: least-squares growth rate of ln(box height) over ~2 s. Getting closer ≥ +12 %/s (Low: +20 %/s),
  moving away ≤ −12 %/s, still within ±4 %/s, otherwise unsure. Needs ≥ 1.5 s history, confidence ≥ 0.5, a steady
  phone (`motionReliable`, rotation ≤ `PROXIMITY_CONFIG.maxRotationRadPerSec`, default 0.1 rad/s), no box edge within
  2 % of the frame, good fit. A state shows after two agreeing evaluations.
- Alert (off by default): banner "Someone is getting closer in camera view (#N)", optional vibration; 30 s per
  person, 10 s overall. Never contacts anyone or starts Emergency.

## Tests
- Unit: `proximity.test.ts` (16), `aiProximityScreen.test.tsx` (9: flags hide UI, flip lifecycle, generation guard
  both ways, flip ignored while starting / one at a time, Emergency during flip, chips, opt-in alert, no alert from
  old-session frames after a flip, remembered camera), tracker age/occlusion (2).
- Full Jest: 48 suites, 496 passed, 2 skipped. `tsc` clean.
- Emulator smoke (`e2e/specs/aiProximity.e2e.js`, `E2E_AI_PROXIMITY=1`): 5/5 — controls/defaults, 20 consecutive
  flips, SOS handoff after a flip (Emergency recorded), background/foreground, camera permission revoked.

## Physical-device checklist (not testable on the emulator)
1. Back and front: one person walks toward the phone → "Getting closer" within ~2 s; walks away → "Moving away".
2. Two people crossing: each keeps its own state; IDs don't swap.
3. The user walks toward a still person (expected: reads as getting closer — documented limit).
4. Walking with the phone while someone approaches from behind (front camera): note how often the state is
   suppressed as "Unsure" because of phone motion; decide whether to tune `maxRotationRadPerSec`.
5. Camera shake, partial occlusion, person at the frame edge → "Unsure", no alert.
6. Alert on: one banner per approach, cooldowns respected; vibration only when enabled.
7. 20 flips on a real phone; SOS right after a flip records with the back camera.
8. 10 minutes running: battery, heat, frame latency compared with 1.0.36.

## Not done / blocked
- No physical-device data yet (items above). Thresholds are first guesses.
- No build, merge or push done.
