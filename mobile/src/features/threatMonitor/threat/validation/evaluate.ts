import type { MonitorFrame } from '../../models/types';
import { THREAT_DETECTORS } from '../detectors';
import { ThreatAssessmentEngine } from '../ThreatAssessmentEngine';
import type { ThreatDetector, ThreatType } from '../types';
import { SPLITS, type Clip, type Scenario, type ScenarioLabel, type SplitName } from './scenarios';

export const THREAT_TYPES: ThreatType[] = ['physical_confrontation', 'assault', 'fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge'];

// What the engine showed during a clip, per type: when first, and how many
// separate candidates (each one is an alert the user would have seen).
export type Surfaced = Map<ThreatType, { firstAt: number; candidates: Set<string> }>;

export function surface(frames: MonitorFrame[], detectors: readonly ThreatDetector[] = THREAT_DETECTORS): Surfaced {
  const engine = new ThreatAssessmentEngine(detectors);
  const out: Surfaced = new Map();
  for (const f of frames) {
    for (const c of engine.update(f).candidates) {
      const entry = out.get(c.type) ?? { firstAt: f.timestamp, candidates: new Set<string>() };
      entry.candidates.add(c.id);
      out.set(c.type, entry);
    }
  }
  return out;
}

// Which threat types the engine surfaced at any point during a sequence.
export function surfacedTypes(frames: MonitorFrame[], detectors: readonly ThreatDetector[] = THREAT_DETECTORS): Set<ThreatType> {
  return new Set(surface(frames, detectors).keys());
}

export type CategoryMetrics = {
  category: ThreatType;
  positives: number; // clips labelled with this category
  truePositives: number;
  falsePositives: number; // clips where it was raised but doesn't count as present
  negatives: number; // clips where it doesn't count as present
  recall: number | null;
  precision: number | null;
  falsePositiveRate: number | null; // per negative clip
  // Separate alerts raised in negative clips, and per hour of that footage.
  falseAlarms: number;
  falseAlarmsPerHour: number | null;
  // Raised where it genuinely overlaps another labelled event (multilabel only).
  overlapping: number;
  // Seconds from the event's start to the first candidate, over true positives.
  latency: { median: number; p90: number; max: number; n: number } | null;
};

export type EvaluationReport = {
  split: SplitName;
  clips: number;
  // Multilabel event results: raising a type that genuinely occurs in the
  // clip too (Scenario.alsoPresent) is not a false alarm.
  perCategory: CategoryMetrics[];
  // Strict category results: raising any type other than the clip's own
  // label is a false positive.
  perCategoryExact: CategoryMetrics[];
  lookAlikeAlerts: Array<{ scenario: string; seed: number; raised: ThreatType[] }>;
  misses: Array<{ scenario: string; seed: number; expected: ScenarioLabel; raised: ThreatType[] }>;
};

type ClipResult = { scenario: Scenario; seed: number; surfaced: Surfaced; durationMs: number; onsetMs?: number };

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function metrics(results: ClipResult[], category: ThreatType, multilabel: boolean): CategoryMetrics {
  let positives = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let negatives = 0;
  let falseAlarms = 0;
  let negativeMs = 0;
  let overlapping = 0;
  const latencies: number[] = [];
  for (const r of results) {
    const raised = r.surfaced.get(category);
    if (r.scenario.label === category) {
      positives += 1;
      if (raised) {
        truePositives += 1;
        if (r.onsetMs != null) latencies.push((raised.firstAt - r.onsetMs) / 1000);
      }
      continue;
    }
    if (multilabel && r.scenario.alsoPresent?.includes(category)) {
      if (raised) overlapping += 1;
      continue;
    }
    negatives += 1;
    negativeMs += r.durationMs;
    if (raised) {
      falsePositives += 1;
      falseAlarms += raised.candidates.size;
    }
  }
  latencies.sort((a, b) => a - b);
  return {
    category,
    positives,
    truePositives,
    falsePositives,
    negatives,
    recall: positives ? truePositives / positives : null,
    precision: truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null,
    falsePositiveRate: negatives ? falsePositives / negatives : null,
    falseAlarms,
    falseAlarmsPerHour: negativeMs ? falseAlarms / (negativeMs / 3_600_000) : null,
    overlapping,
    latency: latencies.length
      ? { median: quantile(latencies, 0.5), p90: quantile(latencies, 0.9), max: latencies[latencies.length - 1], n: latencies.length }
      : null,
  };
}

export function evaluate(scenarios: Scenario[], split: SplitName, seedsPerScenario = 10, detectors?: readonly ThreatDetector[]): EvaluationReport {
  const { from, to } = SPLITS[split];
  const step = Math.max(1, Math.floor((to - from + 1) / seedsPerScenario));
  const results: ClipResult[] = [];
  for (const scenario of scenarios) {
    for (let seed = from; seed <= to && seed < from + step * seedsPerScenario; seed += step) {
      const clip: Clip = scenario.build(seed);
      const durationMs = clip.length > 1 ? clip[clip.length - 1].timestamp - clip[0].timestamp : 0;
      results.push({ scenario, seed, surfaced: surface(clip, detectors), durationMs, onsetMs: clip.onsetMs });
    }
  }
  const raisedOf = (r: ClipResult) => [...r.surfaced.keys()];
  return {
    split,
    clips: results.length,
    perCategory: THREAT_TYPES.map((c) => metrics(results, c, true)),
    perCategoryExact: THREAT_TYPES.map((c) => metrics(results, c, false)),
    lookAlikeAlerts: results.filter((r) => r.scenario.label === 'none' && r.surfaced.size).map((r) => ({ scenario: r.scenario.id, seed: r.seed, raised: raisedOf(r) })),
    misses: results
      .filter((r) => r.scenario.label !== 'none' && !r.surfaced.has(r.scenario.label as ThreatType))
      .map((r) => ({ scenario: r.scenario.id, seed: r.seed, expected: r.scenario.label, raised: raisedOf(r) })),
  };
}
