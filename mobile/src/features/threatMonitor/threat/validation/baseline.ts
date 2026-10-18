import { EXPERIMENTAL_DETECTORS, THREAT_DETECTORS } from '../detectors';
import type { ThreatDetector, ThreatType } from '../types';
import { evaluate, type CategoryMetrics } from './evaluate';
import { SCENARIOS, type SplitName } from './scenarios';

// The final AI behavior baseline: one bounded improvement pass per
// category, each scored on its own threats and look-alikes. Synthetic data
// only — it proves the logic, not real-world accuracy.

export type BaselineCategory = {
  name: string;
  types: ThreatType[];
  positives: string[];
  lookAlikes: string[];
  detectors: readonly ThreatDetector[];
  enabled: boolean; // shown to users in AI test builds
};

const ALL = [...THREAT_DETECTORS, ...EXPERIMENTAL_DETECTORS];

export const BASELINE_CATEGORIES: BaselineCategory[] = [
  {
    name: '1. Fighting and possible assault',
    types: ['physical_confrontation', 'assault'],
    positives: ['mutual-fight', 'one-sided-attack', 'attack-victim-falls'],
    lookAlikes: ['hug', 'dance-pair-close', 'high-five', 'handshake', 'play-fight', 'pad-training', 'run-past', 'walk-past-each-other', 'standing-chat'],
    detectors: ALL,
    enabled: false,
  },
  {
    name: '2. Aggressive physical behavior vs ordinary gestures',
    types: ['assault'],
    positives: ['shove-attack', 'one-sided-attack'],
    lookAlikes: ['handshake', 'wave-hello', 'point-and-talk', 'stretch-near-friend', 'standing-chat', 'high-five'],
    detectors: ALL,
    enabled: false,
  },
  {
    name: '3. Normal interactions (hugging, dancing, greetings, sport, play-fighting)',
    types: ['physical_confrontation', 'assault'],
    positives: [],
    lookAlikes: ['hug', 'dance-pair-close', 'high-five', 'handshake', 'wave-hello', 'play-fight', 'pad-training', 'run-past'],
    detectors: ALL,
    enabled: false,
  },
  {
    name: '4. Crowd panic vs race starts and celebrations',
    types: ['crowd_panic'],
    positives: ['panic-flee-one-way', 'panic-scatter'],
    lookAlikes: ['race-start', 'race-start-line', 'goal-celebration', 'jogging-group', 'sports-game', 'plaza-crossing', 'commuter-flow', 'concert-jumping'],
    detectors: THREAT_DETECTORS,
    enabled: true,
  },
  {
    name: '5. Sudden crowd dispersal',
    types: ['sudden_dispersal'],
    positives: ['dispersal-cluster', 'dispersal-from-point'],
    lookAlikes: ['group-breaks-up', 'plaza-crossing', 'sports-game', 'race-start', 'race-start-line', 'goal-celebration'],
    detectors: THREAT_DETECTORS,
    enabled: true,
  },
  {
    name: '6. Crowd surges vs normal crowd movement',
    types: ['crowd_surge'],
    positives: ['surge-lurch', 'surge-compress'],
    lookAlikes: ['concert-jumping', 'concert-sway', 'venue-exit', 'queue-shuffle', 'crosswalk-start', 'commuter-flow'],
    detectors: THREAT_DETECTORS,
    enabled: true,
  },
  {
    name: '7. Falls vs sitting, bending and lying down',
    types: ['fall'],
    positives: ['fall-forward', 'fall-while-walking'],
    lookAlikes: ['sit-down', 'lie-down', 'bend-over', 'plop-sit', 'kneel', 'flop-on-bed'],
    detectors: THREAT_DETECTORS,
    enabled: true,
  },
];

export type BaselineResult = { category: BaselineCategory; clips: number; rows: CategoryMetrics[]; strictRows: CategoryMetrics[]; lookAlikeAlerts: Record<string, number> };

export function runBaseline(split: SplitName, seeds: number): BaselineResult[] {
  return BASELINE_CATEGORIES.map((category) => {
    const ids = new Set([...category.positives, ...category.lookAlikes]);
    const report = evaluate(SCENARIOS.filter((s) => ids.has(s.id)), split, seeds, category.detectors);
    const alerts: Record<string, number> = {};
    for (const a of report.lookAlikeAlerts) {
      for (const t of a.raised) if (category.types.includes(t)) alerts[a.scenario] = (alerts[a.scenario] ?? 0) + 1;
    }
    return {
      category,
      clips: report.clips,
      rows: report.perCategory.filter((r) => category.types.includes(r.category)),
      strictRows: report.perCategoryExact.filter((r) => category.types.includes(r.category)),
      lookAlikeAlerts: alerts,
    };
  });
}

const f2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

export function baselineMarkdown(results: BaselineResult[], split: SplitName, seeds: number, fingerprint: string): string {
  const lines = [
    `# Final AI behavior baseline — ${split} split (${seeds} seeds per scenario)`,
    '',
    `Threshold fingerprint \`${fingerprint}\`. Synthetic clips only: proves the logic, not real-world accuracy.`,
    'Rule-based detectors on pose and crowd motion — not a trained or validated action-recognition model.',
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.category.name} — ${r.category.enabled ? 'enabled in AI test builds' : 'DISABLED (not shown to users)'}`, '');
    lines.push('| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |');
    lines.push('|---|---|---|---|---|---|---|---|');
    r.rows.forEach((m, i) => {
      const strict = r.strictRows[i];
      lines.push(
        `| ${m.category} | ${f2(m.recall)} (${m.truePositives}/${m.positives}) | ${f2(m.precision)} | ${m.falsePositives}/${m.negatives} | ${f2(m.falsePositiveRate)} | ${f1(m.falseAlarmsPerHour)} | ${m.latency ? `${f1(m.latency.median)} / ${f1(m.latency.p90)}` : '—'} | ${f2(strict.precision)} |`,
      );
    });
    const alerts = Object.entries(r.lookAlikeAlerts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    lines.push('', `Look-alikes that raised this category: ${alerts}.`, '');
  }
  return lines.join('\n');
}
