import type { ThreatDetector } from '../types';

// Detectors run by the threat engine on every analyzed frame.
// M7 adds pose-based confrontation / assault / fall detectors, M8 crowd behavior.
export const THREAT_DETECTORS: readonly ThreatDetector[] = [];
