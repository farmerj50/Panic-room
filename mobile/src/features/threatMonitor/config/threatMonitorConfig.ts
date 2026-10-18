import { Platform } from 'react-native';

import { isBesVisionAvailable } from '../services/besVision';

// Rollout flag. Off unless the build sets EXPO_PUBLIC_AI_MONITOR_ENABLED=1,
// and Android only (the native module doesn't exist elsewhere).
export function isAiMonitorEnabled(): boolean {
  return process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED === '1' && Platform.OS === 'android' && isBesVisionAvailable;
}

// Threat candidates (Phase 2: falls and crowd events) are for AI development
// and test builds only: they need EXPO_PUBLIC_AI_THREATS_ENABLED=1 on top of
// the AI Monitor flag. Production builds set neither. Fight and assault
// detection is not enabled by any flag (see threat/detectors).
export function isThreatDetectionEnabled(): boolean {
  return isAiMonitorEnabled() && process.env.EXPO_PUBLIC_AI_THREATS_ENABLED === '1';
}

// Emulator/e2e builds only (EXPO_PUBLIC_AI_TEST_HOOKS=1, on top of the threat
// flag): buttons that replay a synthetic clip through the real engine and
// event log, or simulate an analysis failure. The emulator camera can't show
// real falls or crowds.
export function isAiTestHooksEnabled(): boolean {
  return isThreatDetectionEnabled() && process.env.EXPO_PUBLIC_AI_TEST_HOOKS === '1';
}

// How detected events are kept and shown (see threat/events/ThreatEventLog).
export const THREAT_EVENT_CONFIG = {
  // An ongoing event with no fresh evidence for this long is shown as ended.
  staleMs: 5_000,
  // The same kind of event within this long of the last one updates it
  // instead of raising a new alert.
  cooldownMs: 60_000,
  // Ended events drop off the list after this long.
  expireMs: 10 * 60_000,
  maxEvents: 20,
  // The engine needs a few seconds of video before "no threat" means anything.
  warmUpMs: 3_000,
} as const;

export const MONITOR_CONFIG = {
  // Validation builds only: simulate a slow model (EXPO_PUBLIC_AI_MONITOR_SLOW_MS).
  debugSlowInferenceMs: Number(process.env.EXPO_PUBLIC_AI_MONITOR_SLOW_MS) || 0,
  // Milestone gate: the camera pipeline (M1) is validated before detection.
  detectionEnabled: true,
  targetFps: 8,
  // Minimum detector confidence. 0.3 measured 70% recall / 0.35 false
  // positives per image on the COCO validation sample (EfficientDet-Lite0);
  // the tracker's 2-frame confirmation filters most one-off false positives.
  scoreThreshold: 0.3,
  // Candidate detector. Lite2 measured 79% recall / 0.41 false positives per
  // image at 0.3 on the COCO sample (Lite0: 70% / 0.35); confirm on phones.
  model: 'lite2' as 'lite0' | 'lite2',
  // Body pose for the threat engine (Phase 2), on every 2nd analyzed frame.
  poseEnabled: true,
  poseEvery: 2,
  // Emergency waits at most this long for the monitor camera to close.
  emergencyHandoffTimeoutMs: 1000,
} as const;
