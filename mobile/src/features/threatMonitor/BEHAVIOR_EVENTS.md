# AI Monitor — movement events between people (flagged, unvalidated)

Branch `feature/ai-behavior-events` (from `main` @ 99814aa). Not production-ready: every threshold is a first guess, and nothing has been measured on real footage yet.

## What it does
The feature finds two-person movement *candidates* in the existing on-device stream. It uses the same camera, tracker, poses and session as today. It never classifies a crime. It never starts Emergency, contacts anyone, calls authorities or sends system notifications.

| Kind | Shown as | Needs (sustained) |
|---|---|---|
| `PURSUIT_LIKE_MOVEMENT` | "Fast movement after another person" | Both people moving at least 0.6 body heights per second the same way (heading cosine at least 0.8), with the follower closing at least 0.25/s, for 1.5 s. |
| `UNUSUAL_PHYSICAL_INTERACTION` | "Close, sudden interaction" | A rapid approach (closing at least 0.8/s; approacher at least 1.4 body heights per second) ending within reach for at least 0.4 s, plus arm movement toward the other person (pose). With no pose it stays "Unsure". |
| `POSSIBLE_STRUGGLE` | "Possible struggle" | Within reach for at least 1.5 s, plus 2 or more strike-like movements, or one shove that pushed the other person back, over 6 s (pose). With no pose, abrupt close-range movement stays "Unsure". |

Statuses:
- **Building:** evidence present, not yet sustained.
- **Unsure:** something is there, but the input or a missing pose doesn't allow confirming it.
- **Seen for a few seconds (active):** confirmed. This is the **only** status that can raise a banner.
- **Ended:** no evidence for 1.5 s.

The same pair and kind returning within 20 s is the same event (`recurrences`), with no new banner. There are at least 15 s between any two banners, and the banner is opt-in (off by default).

## Input quality: degrade, don't switch off
| Condition | Effect |
|---|---|
| Phone moving (`!motionReliable` or rotation above 0.1 rad/s) | Confidence ×0.7, plus the reason "Phone moving: speeds are approximate". Geometry between people still counts. |
| Phone moving severely (rotation of 0.6 rad/s or more) | Abstains: "Can't judge right now: phone moving too much". |
| Low detection confidence (below 0.45) | ×0.7, named. |
| Someone at the frame edge | ×0.75, named. |
| Pair missing in more than 30 % of frames | ×0.7, "People partly hidden". |
| Track younger than 1 s, or a tracking ID switch (a jump of more than 0.8 body heights between frames) | Not judged yet; earlier history is dropped. |
| Body pose unavailable | Recorded as uncertainty and never read as "nothing happening". Pose-dependent kinds stay "Unsure". |
| More than 6 people | Abstains ("Too many people to follow pairs"). |

## Architecture
- `services/PersonInteractionService.ts`: pair observations from the last 4 s of frames. It covers:
  - separation in body heights;
  - closing rate, from a least-squares fit;
  - the strongest recent approach and who made it;
  - speeds, heading and follower;
  - time within reach;
  - abrupt changes;
  - arm actions via the existing `strikesBy`/`shovesBy` from `threat/detectors/confrontationDetector.ts`;
  - quality factors and reasons.
- `services/BehaviorEventEngine.ts`:
  - bounded frame window (40 frames / 4 s);
  - per-pair arm-action memory (6 s);
  - evidence per kind;
  - the status lifecycle, cooldown merge and banner gating.
  
  `BEHAVIOR_CONFIG` holds the thresholds.
- `hooks/useThreatMonitor.ts`:
  - runs the engine after the tracker, on current-camera-generation frames only;
  - resets with the scene (flip, stop, background, Emergency);
  - a failure stops this analysis only.
- UI:
  - `components/BehaviorEventsPanel.tsx`: the panel, with the event list, reasons and limits, and the banner opt-in;
  - `DetectionOverlay`: "↔ #N" chips linking the two people;
  - a banner on the camera view.

Unchanged: the production threat engine and `THREAT_DETECTORS`, where the confrontation detector stays disabled; the frozen thresholds (`3972f816`); proximity, flip, crowd and fall detection; Emergency; and native code.

## Flags
`EXPO_PUBLIC_AI_BEHAVIOR_EVENTS_ENABLED=1`, plus the AI Monitor flag. It's off by default and no build profile sets it. Rollback: build without it.

## Test results
- **Unit** (`behaviorEvents.test.ts`, 31 tests):
  - pursuit, plus the non-pursuit cases: same pace, crossing, meeting, running alone or together;
  - a sprint to another person, which stays "Unsure" without pose;
  - 12 look-alike categories, which raise no event;
  - fights and shoves;
  - phone moving, where confidence degrades and detection doesn't vanish;
  - severe motion, where it abstains;
  - low confidence, occlusion, a young track and an ID switch;
  - the lifecycle, the cooldown merge and reset.
- **Screen** (`behaviorEventsScreen.test.tsx`, 6 tests):
  - the flag hides everything;
  - the opt-in is off by default;
  - an event with reasons and overlay links;
  - one banner per continuing event, with no navigation to Emergency;
  - a flip clears events and old-camera frames are ignored;
  - an Emergency claim stops and clears it.
- **Full Jest:** 50 suites, 533 passed, 2 skipped. `tsc` is clean, and the frozen fingerprint is unchanged.
- **Emulator smoke** (x86_64 test APK, all AI flags plus behavior, local backend):
  - `aiBehavior.e2e.js` passed 4/4: the panel defaults, running plus 2 flips plus a clean stop, SOS handing off to Emergency (recording), and background leaving it idle.
  - `aiProximity.e2e.js` passed 5/5, including 20 flips and camera permission being revoked.

  The emulator camera shows no people, so detection itself is checked only on real phones.

Synthetic detection, 20 seeds each, "active" event raised. These numbers show the logic works, not how accurate it is in the real world.

| Scenario | Raised |
|---|---|
| Mutual fight | 12/20 |
| One-sided attack | 13/20 |
| Shove attack | 16/20 |
| Attack, victim falls | 13/20 |
| Hug, dance close, high-five, handshake, standing chat, walk past, run past, point-and-talk, stretch, wave | 0/20 each |
| Play-fight, pad training | 0/20 each |

## Real-phone checklist
1. Two people walking together, then one jogs to catch up. Expect "Fast movement after another person" after about 1.5 s. Also try walking at the same pace, where nothing should be raised.
2. People crossing paths, and two people walking up to greet each other: no event.
3. One person runs up to another and stops. Expect "Unsure" (or "Building"), no banner unless there's arm movement toward the other person.
4. Hug, handshake, high-five, dancing and play-fighting at different distances: note any event.
5. A staged, safe push (with pads) and shadow-boxing near another person (with consent): note detection and latency.
6. Hand-held phone while walking, and phone panning: confidence should drop and states show "Phone moving". Note how often events are lost.
7. Partial occlusion (someone walks behind a pillar) and edge of frame: reasons named, no flapping.
8. Front camera after a flip; repeat 1 and 3.
9. Banner opt-in: one banner per event, at least 15 s apart. Nothing is sent or called.
10. 10 minutes running: battery, heat and frame rate compared with 1.0.37.

## Known limitations and false-positive risks
- **2D image-space only.** Depth is approximated, and people far apart in depth can look close.
- **Look-alikes for pursuit:** jogging partners catching up, a parent catching a child, kids playing tag, sports.
- **Look-alikes for interaction or struggle:** contact sports, play-fighting with real contact, dancing, crowded doorways.
- **Low frame rates (6–10 fps) hide fast strikes.** The synthetic fight detection rate is 60–80%, so misses are expected.
- **MoveNet loses keypoints when bodies overlap**, so a real struggle may only show "Unsure".
- **A moving phone shifts everyone's apparent speed.** Pursuit then relies on the closing gap, and confidence is lowered.
- **ID switches are only detected as jumps**, so a slow swap between two close people could mix histories for up to 4 s.
- **Thresholds are not calibrated.** There's no real-world precision or recall yet.
