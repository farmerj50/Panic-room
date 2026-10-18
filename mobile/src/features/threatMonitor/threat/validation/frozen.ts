import { CROWD_CONFIG } from '../../services/CrowdMetricsService';
import { TRACKING_CONFIG } from '../../services/PersonTrackingService';
import { CROWD_FEATURES } from '../crowd/crowdFeatures';
import { THREAT_DETECTORS } from '../detectors';
import { CROWD_THREAT_CONFIG } from '../detectors/crowdDetectors';
import { FALL_CONFIG } from '../detectors/fallDetector';
import { RELIABILITY_CONFIG } from '../reliability';
import { ENGINE_CONFIG } from '../ThreatAssessmentEngine';
import type { CategoryMetrics, EvaluationReport } from './evaluate';

// Every threshold the reported results depend on. The final evaluation split
// was run once with exactly these values; changing any of them invalidates
// those results (re-tune on train, check on validation, then re-run
// evaluation once and record it).
export function frozenThresholds() {
  return {
    engine: ENGINE_CONFIG,
    reliability: RELIABILITY_CONFIG,
    tracking: TRACKING_CONFIG,
    crowdMetrics: CROWD_CONFIG,
    crowdFeatures: CROWD_FEATURES,
    crowdThreats: CROWD_THREAT_CONFIG,
    fall: FALL_CONFIG,
    detectors: THREAT_DETECTORS.map((d) => ({ id: d.id, types: d.types, requires: d.requires })),
  };
}

// FNV-1a over the JSON of the thresholds.
export function thresholdFingerprint(): string {
  const text = JSON.stringify(frozenThresholds());
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Fingerprint of the thresholds the M10 evaluation-split results were produced with.
export const FROZEN_FINGERPRINT = 'ec789a7e';

const f2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

function table(rows: CategoryMetrics[], types: string[]) {
  const head =
    '| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |\n|---|---|---|---|---|---|---|---|---|';
  const body = rows
    .filter((r) => types.includes(r.category))
    .map(
      (r) =>
        `| ${r.category} | ${f2(r.recall)} (${r.truePositives}/${r.positives}) | ${f2(r.precision)} | ${r.falsePositives}/${r.negatives} | ${f2(r.falsePositiveRate)} | ${r.falseAlarms} | ${f1(r.falseAlarmsPerHour)} | ${r.overlapping} | ${r.latency ? `${f1(r.latency.median)} / ${f1(r.latency.p90)} / ${f1(r.latency.max)}` : '—'} |`,
    )
    .join('\n');
  return `${head}\n${body}`;
}

export function reportMarkdown(report: EvaluationReport, seedsPerScenario: number) {
  const enabled = ['fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge'];
  const count = (list: Array<{ scenario: string }>) => {
    const m: Record<string, number> = {};
    for (const x of list) m[x.scenario] = (m[x.scenario] ?? 0) + 1;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none';
  };
  return [
    `# Synthetic ${report.split} split — ${report.clips} clips (${seedsPerScenario} seeds per scenario)`,
    '',
    `Threshold fingerprint: \`${thresholdFingerprint()}\`. Synthetic data: proves the logic, not real-world accuracy.`,
    '',
    '## Multilabel event results',
    'A type that genuinely occurs in the clip too (e.g. the victim of an assault falls) is counted as an overlapping event, not a false alarm.',
    '',
    table(report.perCategory, enabled),
    '',
    '## Strict category results',
    'Any type other than the clip\'s own label counts as a false positive.',
    '',
    table(report.perCategoryExact, enabled),
    '',
    `Fight / assault: disabled (0 raised).`,
    '',
    `Look-alike clips that raised anything: ${count(report.lookAlikeAlerts)}.`,
    '',
    `Missed events: ${count(report.misses.filter((m) => enabled.includes(m.expected)))}.`,
    '',
  ].join('\n');
}
