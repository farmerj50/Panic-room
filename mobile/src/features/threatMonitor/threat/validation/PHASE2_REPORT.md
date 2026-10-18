# Bes AI Phase 2 — M10 completion and release-readiness report

Branch `feature/ai-phase2` (local only, not pushed or merged). 2026-10-18.
M10 commits: `7bbb7d0` (offline), `b68ab43` (emulator specs and hooks), plus the final commit adding this report.

All accuracy figures below come from **synthetic** data. They show that the logic behaves as designed. They are
**not** real-world accuracy and must not be presented as such.

## M10 results

### 1. Frozen offline evaluation (requirements 1–3)

- **Splits:** train seeds 1–99 (all tuning), validation 100–199, evaluation 200–299.
- **Frozen thresholds:** every threshold the results depend on is fingerprinted as `ec789a7e`
  (`threat/validation/frozen.ts`). A unit test fails if any threshold changes.
- **One evaluation run:** the evaluation split was run once, after the M10 gating changes had been checked on
  validation. No threshold was changed after it.
- **Scale:** 32 scenarios × 20 seeds = 640 clips per split.
- **Full reports:** `results/evaluation.md` and `results/validation.md`.

**Multilabel event results, evaluation split.** A type that genuinely happens in the same clip is counted as
*overlapping*, not as a false alarm. For example, the victim of an assault does fall, and people scattering do
break into a run.

| Category | Recall | Precision | False-positive clips / negatives | False-positive rate | False alarms (per hour of negative footage) | Overlapping | Latency, median / p90 / max (s) |
|---|---|---|---|---|---|---|---|
| Fall | 0.78 (31/40) | 1.00 | 0 / 580 | 0.00 | 0 (0.0) | 14 | 2.4 / 2.8 / 3.1 |
| Crowd panic | 0.82 (33/40) | 0.57 | 25 / 560 | 0.04 | 25 (17.4) | 28 | 2.8 / 3.0 / 3.2 |
| Sudden dispersal | 0.50 (20/40) | 1.00 | 0 / 580 | 0.00 | 0 (0.0) | 0 | 2.6 / 3.0 / 3.1 |
| Crowd surge | 0.68 (27/40) | 0.93 | 2 / 600 | 0.00 | 2 (1.3) | 0 | 2.5 / 3.5 / 3.6 |

**Strict category results, evaluation split.** Any type other than the clip's own label counts as a false positive.

| Category | Recall | Precision | False-positive clips / negatives | False-positive rate | False alarms (per hour) |
|---|---|---|---|---|---|
| Fall | 0.78 | 0.69 | 14 / 600 | 0.02 | 14 (8.6) |
| Crowd panic | 0.82 | 0.38 | 53 / 600 | 0.09 | 53 (33.8) |
| Sudden dispersal | 0.50 | 1.00 | 0 / 600 | 0.00 | 0 (0.0) |
| Crowd surge | 0.68 | 0.93 | 2 / 600 | 0.00 | 2 (1.3) |

- **Fight and assault:** disabled, 0 raised.
- **Latency:** 2.4–2.8 s median, from when the event starts to when a candidate appears. It is dominated by the
  engine requiring 1.2 s of sustained evidence, plus about 1 s for movement to be measured.

**Where the errors come from:**

- **Crowd panic, multilabel false positives (25):**
  - race starts: 16 (motion alone can't tell a race start from people fleeing the same way);
  - surge clips where the pushed crowd briefly measures as running: about 8 (not counted as overlap);
  - sport: 1.
- **Crowd surge (2):** both are crossings starting on green.
- **Strict-only false positives:**
  - falls in assault-victim clips: 14;
  - panic in dispersal and scatter clips: 28.
- **Misses:** dispersal from a point 12/20, dispersal from a cluster 8/20, surge lurch 8/20, fall forward 6/20.

### 2. Event lifecycle and input gating (requirements 6–7)

**Event merging:**
- Events merge only within one monitoring session, because track IDs restart each session.
- Person-level events (falls) merge only for the same tracked person.
- Crowd events are scene-level and merge within the 60 s cooldown.
- Covered by unit tests and on the emulator: two falls in separate sessions plus one crowd panic gave 3 cards.

**Lifecycle,** covered by unit, UI and emulator tests:
- events go stale after 5 s with no new evidence;
- they expire after 10 min;
- all open events end when monitoring stops, the camera fails, or the threat analysis fails.

**New judgments are blocked:**
- **Poor input:** at poor reliability no detector runs, and every type shows "Camera input is too poor to judge".
- **No fresh evidence:** a candidate can only appear or escalate on a frame that brought new evidence.
- **Falls:** require a steady phone, because rolling the phone tilts people in the image.

**Unit tests for the blocking:** phone moving, about 1.5 fps, no pose, and input turning unusable mid-event all
produce no new candidates.

**Seen on the emulator:**
- the model slowed to 1.8 fps (877 ms per frame) and the dashboard showed "Camera input is unreliable";
- a simulated gyroscope turn showed "Hold the phone steady".

### 3. Emulator integration (requirements 4, 5, 10)

Release builds, x86_64, local backend with the call stub; production was never contacted.

| Suite | Result | Notes |
|---|---|---|
| AI Monitor (existing Phase 1 suite, new layout) | 7 / 8 | Lock-screen SOS fails: branch difference, see below |
| AI dashboard (new) | 8 / 8 | Controls and SOS above the dashboard; live metrics and status; scrolling; gyroscope → unreliable input; event card with uncertainty → stale → cleared; separate sessions not merged; analysis failure with people counting continuing; no automatic Emergency + manual SOS; denied camera permission |
| Resource cleanup (new), 30 start/stop cycles with the engine running | Pass | Memory 162 → 183 MB after warm-up → 194 MB after 30 cycles (about 0.4 MB per cycle); threads 58 → 84 → 79 |
| Emergency handoff (in the AI Monitor suite) | Pass | Monitor SOS ×3 and Home long-press ×3: Emergency recorded with a working camera each time |

**Layout change found during M10:** event cards pushed the controls and SOS below the dashboard, so they now sit
above it.

### 4. Feature flags (requirements 8, 11)

Each build was installed fresh, and the installed app was checked by comparing a checksum of its JavaScript
bundle with the intended build. Two tooling traps caught on the way:
- Gradle reuses a stale bundle when only an `EXPO_PUBLIC_*` flag changes;
- Appium skips reinstalling an APK with the same version.

| AI Monitor | Threats | Home card | Monitor | Dashboard | Unit-test flag matrix |
|---|---|---|---|---|---|
| off | off | hidden | camera never opens | — | pass |
| off | on | hidden | camera never opens | — | pass |
| on | off | shown | people monitor | absent; engine never runs | pass |
| on | on | shown | people monitor | shown | pass |

**What stays off:**
- Fight and assault detection is not enabled by any flag.
- Test hooks need `EXPO_PUBLIC_AI_TEST_HOOKS=1` on top of the threat flag.
- No build profile sets any AI flag.

### 5. Regression with both AI flags off (requirements 9, 12)

| Area | Result |
|---|---|
| Login | 2 / 2 |
| Emergency activation, recording and exit; GPS resolved | 1 / 1 |
| Evidence | 1 / 1 |
| Trusted contacts | 2 / 2 |
| Backgrounding | 1 / 1 |
| Subscription paywall | 1 / 1 |
| Account deletion | 2 / 2 |
| Social sharing | 6 / 6 |
| Social discoverability | 4 / 4 |
| Contextual onboarding | 4 / 4 |
| Lock-screen SOS notification | 0 / 1 — branch difference, see below |

**Total: 24 / 25.** The auto-share prompt failures seen earlier didn't recur on a fresh emulator.

**Code unchanged by Phase 2:**
- No Phase 2 commit touches EmergencyScreen, EmergencyContext, recording, evidence storage, GPS, contacts,
  subscriptions, social sharing or lock-screen SOS.
- Every file in `mobile/src/services` is identical to `main`.
- The only Emergency-side changes on the branch are the approved Phase 1 ones: the camera claim and mount retry
  in EmergencyScreen, and the screen registration in navigation.

### 6. Baseline branch difference

`feature/ai-phase2` was cut from `main` before the P0 fixes. The lock-screen SOS notification is therefore never
posted on this branch, exactly as on `main`:

- no Bes notification appears in `dumpsys notification`;
- `lockScreenService.ts` is identical to `main`.

The fix exists only on `release/emergency-p0` (ea221eb), and the evidence-recording fix likewise. Neither was
modified or ported here. Merging `release/emergency-p0` into this branch, or rebasing onto it, is a prerequisite
for any AI release.

### 7. Shared-code changes in M10

| Area | Change |
|---|---|
| Engine (`ThreatAssessmentEngine`) | No detectors at poor reliability (`POOR_INPUT_REASON`); candidates only appear or escalate on frames with fresh evidence |
| Fall detector | Also requires `reliableMotion` |
| Event log | `ingest(…, sessionId)`; events carry `sessionId` and `trackIds`; scoped merging |
| Monitor screen | Guarded by the AI Monitor flag; controls and SOS above the dashboard; test-hook buttons in hook builds only |
| Config | `isAiTestHooksEnabled()` |
| Evaluation | Per-scenario `alsoPresent`, clip start times, multilabel vs strict results, latency, false alarms per hour, threshold fingerprint, report writer |
| New e2e specs | `aiDashboard`, `aiResources`, `aiFlags`, `lockScreenNotification` |

Unit tests: 404 pass, 1 skipped (the opt-in full evaluation run).

## Phase 2 completion

| Milestone | Status |
|---|---|
| M6 — threat assessment engine | Done |
| M7 — body pose, fall detection | Done (fight and assault detection built but disabled: confuses dancing, high-fives and runners) |
| M8 — crowd panic, dispersal, surge | Done (development milestone) |
| M9 — dashboard | Done |
| M10 — offline validation, emulator integration, regression | Done; physical devices deferred as agreed |

**Phase 2 is complete as a development phase.** It is not production-validated.

## Before production activation

The AI features must stay off in production until all of these are met:

1. **Real-world validation data.** Consented or commercially licensed clips, covering lighting, distance, camera
   angle, crowd density, skin tone and clothing, including everyday look-alikes. Recall, precision and false
   alarms per hour must be measured on held-out clips, never synthetic only, and reviewed against agreed targets.
2. **Calibration.** Replace the uncalibrated evidence strength with a calibration table fitted on real clips. Until
   then the UI keeps saying "Not calibrated", with no numbers.
3. **Physical devices.**
   - Frame rate, inference time, battery and heat on low-, mid- and high-end Android phones. The emulator often
     ran below 2 fps.
   - A 30-minute stability run.
   - Box alignment in portrait and landscape.
   - Emergency handoff timing on real hardware.
4. **Merge the P0 fixes first.** Bring `release/emergency-p0` (evidence preservation, lock-screen SOS) into this
   branch, re-run the full regression, and confirm the lock-screen and evidence tests pass with AI flags on and off.
5. **Known confusions resolved or accepted:**
   - race starts read as crowd panic;
   - crossings starting on green read as a surge;
   - dispersal recall is 0.50.

   Each needs either real-data evidence that it's rare, or a product decision.
6. **Fight and assault detection stays disabled** until an action model trained on consented clips meets targets.
   Do not ship the rule-based detector.
7. **Privacy and Play.**
   - Re-verify that nothing is uploaded, with a network log and a file-system check on a release build.
   - Confirm the Data Safety answers.
   - Confirm the MoveNet licence on the model card.
   - Keep the event log in memory only, or get approval and disclosure before persisting it.
8. **Remove or strip test hooks.** No production profile may set `EXPO_PUBLIC_AI_TEST_HOOKS`. Consider excluding
   the synthetic scenario code from production bundles.
9. **Product and safety review.**
   - Wording ("Possible …", "not a confirmed threat").
   - Recommendations.
   - That SOS stays manual.
   - Behaviour when the phone is in a pocket or moving.
   - Accessibility of the dashboard.
10. **Staged rollout.** Opt-in beta behind the flags, with analytics limited to start/stop and no detection data;
    explicit approval before enabling any flag in a production build.
