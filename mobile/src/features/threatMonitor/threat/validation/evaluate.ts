import type { MonitorFrame } from '../../models/types';
import { THREAT_DETECTORS } from '../detectors';
import { ThreatAssessmentEngine } from '../ThreatAssessmentEngine';
import type { ThreatDetector, ThreatType } from '../types';
import { SPLITS, type Scenario, type ScenarioLabel, type SplitName } from './scenarios';

export const THREAT_TYPES: ThreatType[] = ['physical_confrontation', 'assault', 'fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge'];

// Which threat types the engine surfaced at any point during a sequence.
export function surfacedTypes(frames: MonitorFrame[], detectors: readonly ThreatDetector[] = THREAT_DETECTORS): Set<ThreatType> {
  const engine = new ThreatAssessmentEngine(detectors);
  const seen = new Set<ThreatType>();
  for (const f of frames) for (const c of engine.update(f).candidates) seen.add(c.type);
  return seen;
}

export type CategoryMetrics = {
  category: ThreatType;
  positives: number; // labelled clips of this category
  truePositives: number;
  falsePositives: number; // clips not of this category where it was raised
  negatives: number; // clips not of this category
  recall: number | null;
  precision: number | null;
  falsePositiveRate: number | null; // per clip without this threat
};

export type EvaluationReport = {
  split: SplitName;
  clips: number;
  // Related categories not counted against each other (see ALSO_ACCEPTABLE).
  perCategory: CategoryMetrics[];
  // Strict: raising any type other than the clip's own label is a false positive.
  perCategoryExact: CategoryMetrics[];
  // Look-alike clips ('none') that raised anything at all.
  lookAlikeAlerts: Array<{ scenario: string; seed: number; raised: ThreatType[] }>;
  misses: Array<{ scenario: string; seed: number; expected: ScenarioLabel; raised: ThreatType[] }>;
};

// Related labels that are not counted as errors against each other: an
// assault where the victim falls may also surface as a fall; a fight may
// briefly look one-sided.
const ALSO_ACCEPTABLE: Partial<Record<ScenarioLabel, ThreatType[]>> = {
  assault: ['fall', 'physical_confrontation'],
  physical_confrontation: ['assault'],
  // People scattering in a hurry are both a dispersal and a panic.
  crowd_panic: ['sudden_dispersal'],
  sudden_dispersal: ['crowd_panic'],
  crowd_surge: ['crowd_panic'],
};

export function evaluate(scenarios: Scenario[], split: SplitName, seedsPerScenario = 10, detectors?: readonly ThreatDetector[]): EvaluationReport {
  const { from, to } = SPLITS[split];
  const step = Math.max(1, Math.floor((to - from + 1) / seedsPerScenario));
  const results: Array<{ scenario: Scenario; seed: number; raised: Set<ThreatType> }> = [];
  for (const scenario of scenarios) {
    for (let seed = from; seed <= to && seed < from + step * seedsPerScenario; seed += step) {
      results.push({ scenario, seed, raised: surfacedTypes(scenario.build(seed), detectors) });
    }
  }

  const metricsFor = (tolerateRelated: boolean) => THREAT_TYPES.map((category) => {
    let positives = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let negatives = 0;
    for (const r of results) {
      const isPositive = r.scenario.label === category;
      const tolerated = tolerateRelated && (ALSO_ACCEPTABLE[r.scenario.label] ?? []).includes(category);
      if (isPositive) {
        positives += 1;
        if (r.raised.has(category)) truePositives += 1;
      } else {
        negatives += 1;
        if (r.raised.has(category) && !tolerated) falsePositives += 1;
      }
    }
    return {
      category,
      positives,
      truePositives,
      falsePositives,
      negatives,
      recall: positives ? truePositives / positives : null,
      precision: truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null,
      falsePositiveRate: negatives ? falsePositives / negatives : null,
    };
  });

  return {
    split,
    clips: results.length,
    perCategory: metricsFor(true),
    perCategoryExact: metricsFor(false),
    lookAlikeAlerts: results.filter((r) => r.scenario.label === 'none' && r.raised.size).map((r) => ({ scenario: r.scenario.id, seed: r.seed, raised: [...r.raised] })),
    misses: results
      .filter((r) => r.scenario.label !== 'none' && !r.raised.has(r.scenario.label as ThreatType))
      .map((r) => ({ scenario: r.scenario.id, seed: r.seed, expected: r.scenario.label, raised: [...r.raised] })),
  };
}
