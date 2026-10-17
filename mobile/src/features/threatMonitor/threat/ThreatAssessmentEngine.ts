import type { MonitorFrame } from '../models/types';
import { recommendedActions } from './recommendations';
import { RELIABILITY_FACTOR, computeSourceReliability } from './reliability';
import type {
  DetectorObservation,
  Severity,
  SourceReliability,
  ThreatAssessment,
  ThreatCandidate,
  ThreatDetector,
  ThreatIndicator,
  ThreatType,
} from './types';

export const ENGINE_CONFIG = {
  windowMs: 6000, // frames kept for detectors
  // Evidence accumulates with each supporting frame and decays without one.
  riseRate: 0.35, // fraction of the gap to the observed strength closed per supporting frame
  decayPerSecond: 0.5,
  emergeAt: 0.35,
  activateAt: 0.6,
  // A candidate needs supporting evidence across at least this long...
  minEvidenceMs: 1200,
  // ...and this many separate frames before it is shown at all.
  minSupportingFrames: 4,
  resolveBelow: 0.15,
  keepResolvedMs: 30_000,
  severity: { moderate: 0.5, high: 0.75 },
  // Pose-dependent detectors need this share of person detections to carry pose.
  minPoseCoverage: 0.5,
};

type Track = {
  type: ThreatType;
  subjectKey: string;
  id: string;
  evidence: number;
  peakStrength: number;
  firstSeenAt: number;
  lastSupportAt: number;
  supportingFrames: number;
  trackIds: number[];
  indicators: ThreatIndicator[];
  shown: boolean;
  status: ThreatCandidate['status'];
  resolvedAt?: number;
};

let nextCandidateId = 1;

// Turns the per-frame MonitorFrame stream into explainable, multi-frame
// threat candidates. Detectors only measure; this engine decides when
// evidence is sustained enough to surface, how confident and severe it is,
// and when it is over. It never acts on a candidate.
export class ThreatAssessmentEngine {
  private window: MonitorFrame[] = [];
  private tracks = new Map<string, Track>();
  private resolved: ThreatCandidate[] = [];
  private lastTimestamp: number | null = null;

  constructor(
    private readonly detectors: readonly ThreatDetector[],
    private readonly options: { poseCoverage?: (window: readonly MonitorFrame[]) => number } = {},
  ) {}

  reset() {
    this.window = [];
    this.tracks.clear();
    this.resolved = [];
    this.lastTimestamp = null;
  }

  update(frame: MonitorFrame): ThreatAssessment {
    const now = frame.timestamp;
    const dtSec = this.lastTimestamp == null ? 0 : Math.max(0, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;
    this.window.push(frame);
    while (this.window.length && now - this.window[0].timestamp > ENGINE_CONFIG.windowMs) this.window.shift();

    const poseCoverage = this.options.poseCoverage?.(this.window) ?? 0;
    const reliability = computeSourceReliability(this.window, poseCoverage);
    const unavailable: ThreatAssessment['unavailable'] = [];

    const observations: DetectorObservation[] = [];
    for (const detector of this.detectors) {
      const missing = this.missingRequirement(detector, reliability, frame);
      if (missing) {
        for (const type of detector.types) unavailable.push({ type, reason: missing });
        continue;
      }
      try {
        observations.push(...detector.evaluate({ window: this.window, reliability }).filter((o) => detector.types.includes(o.type)));
      } catch (error) {
        // One faulty detector must never take the monitor down.
        console.warn(`[ThreatEngine] detector ${detector.id} failed`, error);
      }
    }

    const supported = new Set<string>();
    for (const obs of observations) {
      const strength = clamp01(obs.strength);
      if (strength <= 0) continue;
      const key = `${obs.type}|${obs.subjectKey}`;
      supported.add(key);
      let track = this.tracks.get(key);
      if (!track || track.status === 'resolved') {
        track = {
          type: obs.type,
          subjectKey: obs.subjectKey,
          id: `threat-${nextCandidateId++}`,
          evidence: 0,
          peakStrength: 0,
          firstSeenAt: now,
          lastSupportAt: now,
          supportingFrames: 0,
          trackIds: [],
          indicators: [],
          shown: false,
          status: 'emerging',
        };
        this.tracks.set(key, track);
      }
      track.evidence += (strength - track.evidence) * ENGINE_CONFIG.riseRate * (strength > track.evidence ? 1 : 0.5);
      track.peakStrength = Math.max(track.peakStrength, strength);
      track.lastSupportAt = now;
      track.supportingFrames += 1;
      track.trackIds = [...new Set([...track.trackIds, ...obs.trackIds])].sort((a, b) => a - b);
      track.indicators = mergeIndicators(track.indicators, obs.indicators);
    }

    for (const [key, track] of this.tracks) {
      if (!supported.has(key)) track.evidence = Math.max(0, track.evidence - ENGINE_CONFIG.decayPerSecond * dtSec);
      const sustained =
        track.supportingFrames >= ENGINE_CONFIG.minSupportingFrames &&
        track.lastSupportAt - track.firstSeenAt >= ENGINE_CONFIG.minEvidenceMs;
      if (!track.shown && sustained && track.evidence >= ENGINE_CONFIG.emergeAt) track.shown = true;
      // Escalate only if the evidence keeps going: shown first as emerging,
      // active once it has lasted twice as long and is strong.
      if (
        track.shown &&
        track.evidence >= ENGINE_CONFIG.activateAt &&
        track.lastSupportAt - track.firstSeenAt >= ENGINE_CONFIG.minEvidenceMs * 2
      ) {
        track.status = 'active';
      }
      if (track.evidence < ENGINE_CONFIG.resolveBelow) {
        if (track.shown) {
          track.status = 'resolved';
          track.resolvedAt = now;
          this.resolved.unshift(this.toCandidate(track, reliability));
        }
        this.tracks.delete(key);
      }
    }
    this.resolved = this.resolved.filter((c) => now - (c.lastSeenAt ?? now) <= ENGINE_CONFIG.keepResolvedMs).slice(0, 10);

    const candidates = [...this.tracks.values()]
      .filter((t) => t.shown)
      .map((t) => this.toCandidate(t, reliability))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.lastSeenAt - a.lastSeenAt);

    return { timestamp: now, candidates, recentlyResolved: this.resolved, sourceReliability: reliability, unavailable };
  }

  private missingRequirement(detector: ThreatDetector, reliability: SourceReliability, frame: MonitorFrame): string | null {
    for (const req of detector.requires) {
      if (req === 'pose' && reliability.poseCoverage < ENGINE_CONFIG.minPoseCoverage) return 'Body pose is not available';
      if (req === 'reliableMotion' && !frame.crowdMetrics.motionReliable) return 'Phone is moving';
      if (req === 'multiplePeople' && frame.peopleCount < 2) return 'Fewer than two people visible';
    }
    return null;
  }

  private toCandidate(track: Track, reliability: SourceReliability): ThreatCandidate {
    // Uncalibrated confidence: sustained evidence, discounted by how much the
    // camera input can be trusted. Replaced by a calibration table in M10.
    const confidence = clamp01(track.evidence * RELIABILITY_FACTOR[reliability.level]);
    const severity = severityFor(track.type, confidence, track.peakStrength);
    return {
      id: track.id,
      type: track.type,
      status: track.status,
      severity,
      confidence,
      calibrated: false,
      firstSeenAt: track.firstSeenAt,
      lastSeenAt: track.lastSupportAt,
      trackIds: track.trackIds,
      indicators: [...track.indicators].sort((a, b) => b.weight - a.weight),
      sourceReliability: reliability,
      recommendedActions: recommendedActions(track.type, severity),
    };
  }
}

// Severity scales with confidence; falls and crowd surges are treated as
// more serious at the same confidence (injury / crush risk).
export function severityFor(type: ThreatType, confidence: number, peakStrength: number): Severity {
  const bump = type === 'assault' || type === 'crowd_surge' || type === 'fall' ? 0.1 : 0;
  const score = Math.max(confidence, peakStrength * 0.8) + bump;
  if (score >= ENGINE_CONFIG.severity.high) return 'high';
  if (score >= ENGINE_CONFIG.severity.moderate) return 'moderate';
  return 'low';
}

function mergeIndicators(existing: ThreatIndicator[], incoming: ThreatIndicator[]): ThreatIndicator[] {
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const i of incoming) {
    const prev = byId.get(i.id);
    byId.set(i.id, prev ? { ...i, weight: Math.max(prev.weight, i.weight) } : i);
  }
  return [...byId.values()];
}

const severityRank = (s: Severity) => (s === 'high' ? 3 : s === 'moderate' ? 2 : 1);
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
