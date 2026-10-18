import type { MonitorFrame } from '../models/types';

// Phase 2 threat assessment contracts. Everything here is an on-device,
// explainable *candidate* for the user to judge — never a verdict, never an
// identification of a person, and never a trigger for any automatic action.

export type ThreatType =
  | 'physical_confrontation'
  | 'assault'
  | 'fall'
  | 'crowd_panic'
  | 'sudden_dispersal'
  | 'crowd_surge';

export type Severity = 'low' | 'moderate' | 'high';

export type ThreatStatus = 'emerging' | 'active' | 'resolved';

// What the evidence for a type depends on. Violence-related types require
// pose evidence: they are never raised from box movement alone.
export type EvidenceRequirement = 'pose' | 'reliableMotion' | 'multiplePeople';

// One human-readable reason a candidate exists ("2 people within arm's reach").
export type ThreatIndicator = {
  id: string;
  label: string;
  value?: number;
  // How much this indicator contributed (0..1), for the "why" view.
  weight: number;
};

export type SourceReliability = {
  level: 'good' | 'limited' | 'poor';
  analyzedFps: number;
  motionReliableShare: number; // share of recent frames where the phone was still
  meanDetectionScore: number;
  poseCoverage: number; // share of recent person detections with pose (0 until pose ships)
  reasons: string[];
};

// What a detector reports for one frame: how strongly the evidence for a
// type is present right now, for a subject (a pair of tracks, a person, or
// the whole scene).
export type DetectorObservation = {
  type: ThreatType;
  subjectKey: string;
  trackIds: number[];
  strength: number; // 0..1
  indicators: ThreatIndicator[];
};

export type DetectorContext = {
  window: readonly MonitorFrame[];
  reliability: SourceReliability;
};

export interface ThreatDetector {
  readonly id: string;
  readonly types: readonly ThreatType[];
  readonly requires: readonly EvidenceRequirement[];
  evaluate(ctx: DetectorContext): DetectorObservation[];
}

export type ThreatCandidate = {
  id: string; // stable for the life of the candidate
  type: ThreatType;
  status: ThreatStatus;
  severity: Severity;
  confidence: number; // 0..1
  calibrated: boolean; // false until an offline calibration table is applied
  firstSeenAt: number;
  lastSeenAt: number;
  trackIds: number[];
  indicators: ThreatIndicator[];
  sourceReliability: SourceReliability;
  recommendedActions: string[];
};

export type ThreatAssessment = {
  timestamp: number;
  candidates: ThreatCandidate[]; // emerging + active, newest first
  recentlyResolved: ThreatCandidate[];
  sourceReliability: SourceReliability;
  // Types whose detectors were skipped and why (e.g. pose not available).
  unavailable: Array<{ type: ThreatType; reason: string }>;
  // Types with some evidence building up that isn't enough to show yet.
  building: ThreatType[];
};
