import type { MonitorFrame } from '../models/types';
import { ENGINE_CONFIG, ThreatAssessmentEngine, severityFor } from '../threat/ThreatAssessmentEngine';
import { computeSourceReliability } from '../threat/reliability';
import type { DetectorContext, DetectorObservation, ThreatAssessment, ThreatDetector, ThreatType } from '../threat/types';
import { syntheticSequence } from '../threat/validation/syntheticFrames';

// A scripted detector: reports `strengthAt(frameIndex)` for one subject.
function scripted(
  strengthAt: (i: number, ctx: DetectorContext) => number,
  opts: { type?: ThreatType; requires?: ThreatDetector['requires']; subjectKey?: string; id?: string } = {},
): ThreatDetector {
  let i = -1;
  return {
    id: opts.id ?? 'scripted',
    types: [opts.type ?? 'physical_confrontation'],
    requires: opts.requires ?? [],
    evaluate(ctx) {
      i += 1;
      const strength = strengthAt(i, ctx);
      if (strength <= 0) return [];
      const obs: DetectorObservation = {
        type: opts.type ?? 'physical_confrontation',
        subjectKey: opts.subjectKey ?? 'pair:1-2',
        trackIds: [1, 2],
        strength,
        indicators: [{ id: 'close', label: '2 people within arm’s reach', weight: strength }],
      };
      return [obs];
    },
  };
}

const twoPeople = () => [
  { id: 1, x: 0.3, y: 0.3 },
  { id: 2, x: 0.42, y: 0.3 },
];

function run(engine: ThreatAssessmentEngine, frames: MonitorFrame[]): ThreatAssessment[] {
  return frames.map((f) => engine.update(f));
}

describe('ThreatAssessmentEngine', () => {
  it('never surfaces a candidate from a single-frame spike', () => {
    const engine = new ThreatAssessmentEngine([scripted((i) => (i === 5 ? 1 : 0))]);
    const out = run(engine, syntheticSequence(5, 8, twoPeople));
    expect(out.every((a) => a.candidates.length === 0)).toBe(true);
  });

  it('needs sustained evidence: emerging, then active, then resolved after it stops', () => {
    // Strong evidence from 1 s to 4 s, then nothing.
    const engine = new ThreatAssessmentEngine([scripted((i) => (i >= 8 && i < 32 ? 0.9 : 0))]);
    const out = run(engine, syntheticSequence(8, 8, twoPeople));
    const firstShown = out.findIndex((a) => a.candidates.length > 0);
    expect(firstShown).toBeGreaterThanOrEqual(8 + ENGINE_CONFIG.minSupportingFrames - 1);
    expect(out[firstShown].candidates[0].status).toBe('emerging');
    expect(out.some((a) => a.candidates[0]?.status === 'active')).toBe(true);
    const last = out[out.length - 1];
    expect(last.candidates).toHaveLength(0);
    expect(last.recentlyResolved[0]).toEqual(expect.objectContaining({ type: 'physical_confrontation', status: 'resolved' }));
  });

  it('keeps one stable candidate id for the life of a threat', () => {
    const engine = new ThreatAssessmentEngine([scripted(() => 0.9)]);
    const ids = new Set(run(engine, syntheticSequence(4, 8, twoPeople)).flatMap((a) => a.candidates.map((c) => c.id)));
    expect(ids.size).toBe(1);
  });

  it('ignores weak, intermittent evidence (flicker)', () => {
    const engine = new ThreatAssessmentEngine([scripted((i) => (i % 4 === 0 ? 0.5 : 0))]);
    const out = run(engine, syntheticSequence(10, 8, twoPeople));
    expect(out.every((a) => a.candidates.length === 0)).toBe(true);
  });

  it('never runs a pose-dependent detector without pose evidence, and says why', () => {
    const evaluate = jest.fn(() => []);
    const engine = new ThreatAssessmentEngine([{ id: 'violence', types: ['assault'], requires: ['pose'], evaluate }]);
    const out = run(engine, syntheticSequence(3, 8, twoPeople));
    expect(evaluate).not.toHaveBeenCalled();
    expect(out[out.length - 1].unavailable).toEqual([{ type: 'assault', reason: 'Body pose is not available' }]);
  });

  it('runs a pose-dependent detector once pose coverage is sufficient', () => {
    const evaluate = jest.fn(() => []);
    const engine = new ThreatAssessmentEngine([{ id: 'violence', types: ['assault'], requires: ['pose'], evaluate }], {
      poseCoverage: () => 0.9,
    });
    run(engine, syntheticSequence(1, 8, twoPeople));
    expect(evaluate).toHaveBeenCalled();
  });

  it('skips motion-dependent detectors while the phone is moving', () => {
    const evaluate = jest.fn(() => []);
    const engine = new ThreatAssessmentEngine([{ id: 'crowd', types: ['crowd_panic'], requires: ['reliableMotion'], evaluate }]);
    run(engine, syntheticSequence(2, 8, twoPeople, { motionReliableAt: () => false }));
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('lowers confidence when the camera input is unreliable', () => {
    const steady = new ThreatAssessmentEngine([scripted(() => 0.9)]);
    const shaky = new ThreatAssessmentEngine([scripted(() => 0.9)]);
    const a = run(steady, syntheticSequence(4, 8, twoPeople)).pop()!;
    const b = run(shaky, syntheticSequence(4, 8, twoPeople, { motionReliableAt: (t) => t < 2 })).pop()!;
    expect(b.sourceReliability.level).not.toBe('good');
    expect(b.candidates[0].confidence).toBeLessThan(a.candidates[0].confidence);
    expect(b.sourceReliability.reasons).toContain('Phone is moving');
  });

  it('tracks separate subjects separately', () => {
    let i = -1;
    const engine = new ThreatAssessmentEngine([
      {
        id: 'two-pairs',
        types: ['physical_confrontation'],
        requires: [],
        evaluate: () => {
          i += 1;
          return ['pair:1-2', 'pair:3-4'].map((subjectKey, k) => ({
            type: 'physical_confrontation' as const,
            subjectKey,
            trackIds: k ? [3, 4] : [1, 2],
            strength: 0.9,
            indicators: [],
          }));
        },
      },
    ]);
    const last = run(engine, syntheticSequence(3, 8, twoPeople)).pop()!;
    expect(last.candidates.map((c) => c.trackIds)).toEqual(expect.arrayContaining([[1, 2], [3, 4]]));
  });

  it('a failing detector does not stop the others', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: ThreatDetector = { id: 'broken', types: ['fall'], requires: [], evaluate: () => { throw new Error('bug'); } };
    const engine = new ThreatAssessmentEngine([broken, scripted(() => 0.9)]);
    expect(run(engine, syntheticSequence(3, 8, twoPeople)).pop()!.candidates).toHaveLength(1);
  });

  it('drops observations for types a detector did not declare', () => {
    const sneaky = scripted(() => 0.9, { type: 'assault' });
    const engine = new ThreatAssessmentEngine([{ ...sneaky, types: ['fall'] as const, evaluate: sneaky.evaluate.bind(sneaky) }]);
    expect(run(engine, syntheticSequence(3, 8, twoPeople)).pop()!.candidates).toHaveLength(0);
  });

  it('candidates are explainable and advisory only', () => {
    const engine = new ThreatAssessmentEngine([scripted(() => 1, { type: 'assault' })]);
    const c = run(engine, syntheticSequence(5, 8, twoPeople)).pop()!.candidates[0];
    expect(c).toEqual(
      expect.objectContaining({
        type: 'assault',
        severity: 'high',
        calibrated: false,
        trackIds: [1, 2],
        indicators: [expect.objectContaining({ label: '2 people within arm’s reach' })],
      }),
    );
    expect(c.recommendedActions).toContain('If you are in danger, tap SOS to start Emergency');
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
    // Nothing in a candidate can trigger an action on its own.
    expect(Object.keys(c).sort()).toEqual(
      ['calibrated', 'confidence', 'firstSeenAt', 'id', 'indicators', 'lastSeenAt', 'recommendedActions', 'severity', 'sourceReliability', 'status', 'trackIds', 'type'].sort(),
    );
  });

  it('reset clears all state for a new session', () => {
    const engine = new ThreatAssessmentEngine([scripted(() => 0.9)]);
    run(engine, syntheticSequence(3, 8, twoPeople));
    engine.reset();
    expect(engine.update(syntheticSequence(0.2, 8, twoPeople)[0]).candidates).toHaveLength(0);
  });
});

describe('source reliability', () => {
  it('is poor at a low analysis rate', () => {
    expect(computeSourceReliability(syntheticSequence(3, 1, twoPeople)).level).toBe('poor');
  });
  it('is limited for weak detections', () => {
    const frames = syntheticSequence(2, 8, () => [{ id: 1, x: 0.2, y: 0.2, confidence: 0.32 }]);
    const r = computeSourceReliability(frames);
    expect(r.level).toBe('limited');
    expect(r.reasons[0]).toMatch(/hard to see/);
  });
  it('is good for steady, clear input', () => {
    expect(computeSourceReliability(syntheticSequence(2, 8, twoPeople)).level).toBe('good');
  });
});

describe('severity', () => {
  it('rises with confidence and treats falls, assaults and surges as more serious', () => {
    expect(severityFor('physical_confrontation', 0.3, 0.3)).toBe('low');
    expect(severityFor('physical_confrontation', 0.55, 0.55)).toBe('moderate');
    expect(severityFor('crowd_surge', 0.68, 0.68)).toBe('high');
    expect(severityFor('physical_confrontation', 0.68, 0.68)).toBe('moderate');
  });
});
