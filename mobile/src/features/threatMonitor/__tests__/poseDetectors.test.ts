import { THREAT_DETECTORS, EXPERIMENTAL_DETECTORS, NOT_YET_SUPPORTED } from '../threat/detectors';
import { ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';
import { torsoAngle } from '../threat/pose/skeleton';
import { SCENARIOS } from '../threat/validation/scenarios';
import { evaluate, surfacedTypes } from '../threat/validation/evaluate';
import { actions, skeleton } from '../threat/validation/syntheticPoses';

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
// Seeds from the train split only — evaluation seeds are never used to shape tests.
const TRAIN_SEEDS = [2, 11, 23, 37, 58];

describe('synthetic skeleton', () => {
  it('stands upright, and lies flat after a fall', () => {
    expect(torsoAngle(skeleton(actions.stand(0.4)(0)))).toBeLessThan(5);
    expect(torsoAngle(skeleton(actions.fall(0.4, 1)(3)))).toBeGreaterThan(80);
  });
});

describe('fall detection (pose)', () => {
  it('detects a person falling and staying down', () => {
    const hits = TRAIN_SEEDS.filter((seed) => surfacedTypes(scenario('fall-forward').build(seed)).has('fall'));
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it.each(['sit-down', 'lie-down', 'bend-over', 'walk-alone', 'hug', 'dance-pair-close'])('does not call "%s" a fall', (id) => {
    for (const seed of TRAIN_SEEDS) expect(surfacedTypes(scenario(id).build(seed)).has('fall')).toBe(false);
  });

  it('explains a fall and suggests checking on the person — advice only', () => {
    const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
    let candidate;
    for (const f of scenario('fall-forward').build(2)) candidate = engine.update(f).candidates[0] ?? candidate;
    expect(candidate).toEqual(
      expect.objectContaining({
        type: 'fall',
        trackIds: [1],
        indicators: expect.arrayContaining([expect.objectContaining({ id: 'fall-fast' })]),
      }),
    );
    expect(candidate!.recommendedActions[0]).toMatch(/Check whether the person needs help/);
  });

  it('does nothing without pose data', () => {
    const frames = scenario('fall-forward').build(2).map((f) => ({ ...f, detections: f.detections.map(({ pose, ...d }) => d) }));
    const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
    const outs = frames.map((f) => engine.update(f));
    expect(outs.every((a) => a.candidates.length === 0)).toBe(true);
    expect(outs[outs.length - 1].unavailable).toContainEqual({ type: 'fall', reason: 'Body pose is not available' });
  });
});

describe('violence recognition is not guessed', () => {
  it('ships no confrontation or assault detector, and says why', () => {
    expect(THREAT_DETECTORS.flatMap((d) => d.types)).not.toEqual(expect.arrayContaining(['physical_confrontation']));
    expect(THREAT_DETECTORS.flatMap((d) => d.types)).not.toEqual(expect.arrayContaining(['assault']));
    const engine = new ThreatAssessmentEngine(THREAT_DETECTORS, { notYetSupported: NOT_YET_SUPPORTED });
    const last = scenario('mutual-fight').build(2).map((f) => engine.update(f)).pop()!;
    expect(last.candidates).toHaveLength(0);
    expect(last.unavailable).toContainEqual({ type: 'physical_confrontation', reason: 'Needs an action model trained on real clips' });
  });

  it('the experimental rules stay measurable (so a trained model can be compared against them)', () => {
    const report = evaluate(SCENARIOS.filter((s) => ['mutual-fight', 'hug'].includes(s.id)), 'train', 3, EXPERIMENTAL_DETECTORS);
    expect(report.clips).toBe(6);
    expect(report.perCategory.find((c) => c.category === 'physical_confrontation')!.positives).toBe(3);
  });
});
