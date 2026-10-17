import { Platform } from 'react-native';

import { isBesVisionAvailable } from '../services/besVision';

// Rollout flag. Off unless the build sets EXPO_PUBLIC_AI_MONITOR_ENABLED=1,
// and Android only (the native module doesn't exist elsewhere).
export function isAiMonitorEnabled(): boolean {
  return process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED === '1' && Platform.OS === 'android' && isBesVisionAvailable;
}

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
  // Emergency waits at most this long for the monitor camera to close.
  emergencyHandoffTimeoutMs: 1000,
} as const;
