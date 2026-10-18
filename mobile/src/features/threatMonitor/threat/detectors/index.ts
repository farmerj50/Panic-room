import type { ThreatDetector, ThreatType } from '../types';
import { confrontationDetector } from './confrontationDetector';
import { CROWD_DETECTORS } from './crowdDetectors';
import { fallDetector } from './fallDetector';

// Detectors run by the threat engine on every analyzed frame.
//
// The rule-based confrontation/assault detector is NOT enabled: on synthetic
// evaluation it confuses close dancing, high-fives and runners passing with
// strikes (see threat/validation). Violence recognition needs an action model
// trained on licensed/consented clips; until then those types are reported
// as unavailable rather than guessed.
export const THREAT_DETECTORS: readonly ThreatDetector[] = [fallDetector, ...CROWD_DETECTORS];

export const EXPERIMENTAL_DETECTORS: readonly ThreatDetector[] = [confrontationDetector];

export const NOT_YET_SUPPORTED: Partial<Record<ThreatType, string>> = {
  physical_confrontation: 'Needs an action model trained on real clips',
  assault: 'Needs an action model trained on real clips',
};
