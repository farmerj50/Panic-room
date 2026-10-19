import type { MonitorFrame, TrackedPerson } from '../models/types';
import { PROXIMITY_CONFIG, ProximityEstimator, type PersonProximity } from '../services/ProximityEstimator';
import { ProximityAlerter } from '../services/proximityAlerts';

const STEP = 100; // 10 frames per second

function frame(t: number, people: Array<Partial<TrackedPerson> & { h: number; x?: number; y?: number; id?: number }>, { reliable = true, rotation = 0 } = {}): MonitorFrame {
  const detections: TrackedPerson[] = people.map((p) => ({
    trackId: p.id ?? 1,
    class: 'person',
    confidence: p.confidence ?? 0.9,
    boundingBox: { x: p.x ?? 0.4, y: p.y ?? 0.2, width: p.h * 0.4, height: p.h },
    motion: { direction: 'still', speed: 0, suddenChange: false },
  }));
  return {
    timestamp: t,
    sessionId: 's1',
    peopleCount: detections.length,
    detections,
    crowdMetrics: { visiblePeople: detections.length, estimatedVisualDensity: 'low', rapidMovementCount: 0, averageSpeed: 0, cameraMoving: !reliable, motionReliable: reliable, deviceRotationRate: rotation },
    inferenceMs: 20,
  };
}

// Runs `seconds` of frames with box height h(t) and returns the last reading.
function run(est: ProximityEstimator, seconds: number, height: (s: number) => number, opts: Parameters<typeof frame>[2] & { start?: number; sensitivity?: 'normal' | 'low'; y?: number } = {}) {
  let last: PersonProximity | undefined;
  const start = opts.start ?? 0;
  for (let t = start; t <= start + seconds * 1000; t += STEP) {
    last = est.update(frame(t, [{ h: height((t - start) / 1000), y: opts.y }], opts), opts.sensitivity).get(1);
  }
  return last!;
}

describe('proximity estimator', () => {
  it('reads a growing box as getting closer', () => {
    const r = run(new ProximityEstimator(), 2.5, (s) => 0.3 * Math.exp(0.2 * s));
    expect(r.state).toBe('APPROACHING');
    expect(r.reliable).toBe(true);
  });

  it('reads a shrinking box as moving away', () => {
    expect(run(new ProximityEstimator(), 2.5, (s) => 0.5 * Math.exp(-0.2 * s)).state).toBe('MOVING_AWAY');
  });

  it('reads a steady box as still', () => {
    expect(run(new ProximityEstimator(), 2.5, (s) => 0.4 + 0.002 * Math.sin(s * 9)).state).toBe('STATIONARY');
  });

  it('stays unsure without 1.5 s of history', () => {
    const r = run(new ProximityEstimator(), 1.0, (s) => 0.3 * Math.exp(0.3 * s));
    expect(r.state).toBe('UNCERTAIN');
    expect(r.reliable).toBe(false);
  });

  it('stays unsure while the phone is moving', () => {
    expect(run(new ProximityEstimator(), 2.5, (s) => 0.3 * Math.exp(0.2 * s), { reliable: false }).state).toBe('UNCERTAIN');
    expect(run(new ProximityEstimator(), 2.5, (s) => 0.3 * Math.exp(0.2 * s), { rotation: 0.3 }).state).toBe('UNCERTAIN');
  });

  it('uses a configurable phone-steadiness limit', () => {
    const saved = PROXIMITY_CONFIG.maxRotationRadPerSec;
    PROXIMITY_CONFIG.maxRotationRadPerSec = 0.5;
    try {
      expect(run(new ProximityEstimator(), 2.5, (s) => 0.3 * Math.exp(0.2 * s), { rotation: 0.3 }).state).toBe('APPROACHING');
    } finally {
      PROXIMITY_CONFIG.maxRotationRadPerSec = saved;
    }
  });

  it('stays unsure when the box touches the frame edge', () => {
    // Bottom edge at the frame border: the visible height is cropped.
    const r = run(new ProximityEstimator(), 2.5, (s) => 0.3 * Math.exp(0.2 * s), { y: 0.6 });
    expect(r.state).toBe('UNCERTAIN');
    expect(r.reason).toBe('cropped');
  });

  it('stays unsure for a jumpy box', () => {
    const r = run(new ProximityEstimator(), 2.5, (s) => (Math.round(s * 10) % 2 ? 0.3 : 0.45));
    expect(r.state).toBe('UNCERTAIN');
  });

  it('does not flicker on a single odd frame', () => {
    const est = new ProximityEstimator();
    run(est, 2.5, (s) => 0.3 * Math.exp(0.2 * s));
    const blip = est.update(frame(2600, [{ h: 0.3 * Math.exp(0.52) }], { reliable: false })).get(1)!;
    expect(blip.state).toBe('APPROACHING'); // held
    expect(blip.reliable).toBe(false); // but not trusted for an alert
  });

  it('low sensitivity needs a faster approach', () => {
    const grow = (s: number) => 0.3 * Math.exp(0.15 * s);
    expect(run(new ProximityEstimator(), 2.5, grow).state).toBe('APPROACHING');
    expect(run(new ProximityEstimator(), 2.5, grow, { sensitivity: 'low' }).state).not.toBe('APPROACHING');
  });

  it('forgets everything on reset', () => {
    const est = new ProximityEstimator();
    run(est, 2.5, (s) => 0.3 * Math.exp(0.2 * s));
    est.reset();
    expect(est.update(frame(2600, [{ h: 0.5 }])).get(1)!.state).toBe('UNCERTAIN');
  });
});

describe('proximity alerts', () => {
  const reading = (trackId: number, state: PersonProximity['state'] = 'APPROACHING', reliable = true): [number, PersonProximity] => [trackId, { trackId, state, reliable, rate: 0.2 }];

  it('alerts once when someone starts getting closer', () => {
    const a = new ProximityAlerter();
    expect(a.evaluate(new Map([reading(3)]), 0)).toBe(3);
    expect(a.evaluate(new Map([reading(3)]), 100)).toBeNull(); // still approaching: no repeat
  });

  it('ignores unreliable and other states', () => {
    const a = new ProximityAlerter();
    expect(a.evaluate(new Map([reading(1, 'APPROACHING', false)]), 0)).toBeNull();
    expect(a.evaluate(new Map([reading(1, 'MOVING_AWAY')]), 0)).toBeNull();
    expect(a.evaluate(new Map([reading(1, 'STATIONARY')]), 0)).toBeNull();
  });

  it('waits 30 s before alerting about the same person again', () => {
    const a = new ProximityAlerter();
    expect(a.evaluate(new Map([reading(1)]), 0)).toBe(1);
    a.evaluate(new Map([reading(1, 'STATIONARY')]), 5_000);
    expect(a.evaluate(new Map([reading(1)]), 20_000)).toBeNull();
    a.evaluate(new Map([reading(1, 'STATIONARY')]), 25_000);
    expect(a.evaluate(new Map([reading(1)]), 31_000)).toBe(1);
  });

  it('waits 10 s between any two alerts', () => {
    const a = new ProximityAlerter();
    expect(a.evaluate(new Map([reading(1)]), 0)).toBe(1);
    expect(a.evaluate(new Map([reading(1), reading(2)]), 5_000)).toBeNull();
    a.evaluate(new Map([reading(1), reading(2, 'STATIONARY')]), 6_000);
    expect(a.evaluate(new Map([reading(1), reading(2)]), 11_000)).toBe(2);
  });

  it('starts fresh after reset (a camera flip)', () => {
    const a = new ProximityAlerter();
    a.evaluate(new Map([reading(1)]), 0);
    a.reset();
    expect(a.evaluate(new Map([reading(1)]), 1_000)).toBe(1);
  });
});
