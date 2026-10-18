import { synchronized, type Onset } from '../threat/crowd/crowdFeatures';
import { THREAT_DETECTORS } from '../threat/detectors';
import { CROWD_DETECTORS, radiatingFrom } from '../threat/detectors/crowdDetectors';
import { ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';
import type { ThreatType } from '../threat/types';
import { surfacedTypes } from '../threat/validation/evaluate';
import { CROWD_SCENARIOS } from '../threat/validation/scenarios';

// Crowd scenes run through the real tracker and crowd metrics (see
// syntheticCrowd). Train-split seeds only; thresholds were tuned on these.
const scenario = (id: string) => CROWD_SCENARIOS.find((s) => s.id === id)!;
const SEEDS = [1, 6, 11, 16, 21];
const raisedIn = (id: string, type: ThreatType) => SEEDS.filter((seed) => surfacedTypes(scenario(id).build(seed)).has(type)).length;
const raisedAnything = (id: string) => SEEDS.filter((seed) => surfacedTypes(scenario(id).build(seed)).size > 0).length;

const onset = (x: number, z: number, vx: number, vz: number, t = 0): Onset => ({
  trackId: Math.round(x * 100 + z),
  t,
  vx,
  vz,
  speed: Math.hypot(vx, vz),
  from: { x, z },
});

describe('crowd features', () => {
  it('finds the point a scatter radiates from', () => {
    const group = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return onset(3 + Math.cos(a), 8 + Math.sin(a), Math.cos(a) * 2, Math.sin(a) * 2);
    });
    const p = radiatingFrom(group)!;
    expect(p.x).toBeCloseTo(3, 1);
    expect(p.z).toBeCloseTo(8, 1);
  });

  it('finds no common point when everyone moves the same way', () => {
    const group = [0, 1, 2, 3, 4].map((i) => onset(i * 0.6, 8 + (i % 2) * 0.5, 2, 0.05 * (i % 3)));
    expect(radiatingFrom(group)).toBeNull();
  });

  it('groups movement onsets that happen at about the same time', () => {
    const list = [0, 100, 300, 900, 4000, 4100].map((t, i) => ({ ...onset(i, 8, 2, 0), t }));
    expect(synchronized(list, 1200).map((o) => o.t)).toEqual([0, 100, 300, 900]);
  });
});

describe('crowd threat detectors', () => {
  it('are enabled and need steady footage, not pose', () => {
    for (const d of CROWD_DETECTORS) {
      expect(THREAT_DETECTORS).toContain(d);
      expect(d.requires).toEqual(['reliableMotion']);
    }
  });

  it('raises crowd panic when a calm crowd breaks into a run', () => {
    expect(raisedIn('panic-flee-one-way', 'crowd_panic')).toBeGreaterThanOrEqual(3);
    expect(raisedIn('panic-scatter', 'crowd_panic')).toBeGreaterThanOrEqual(3);
  });

  it('raises sudden dispersal when a standing group scatters outward', () => {
    expect(raisedIn('dispersal-cluster', 'sudden_dispersal')).toBeGreaterThanOrEqual(3);
  });

  it('raises a crowd surge when a packed crowd lurches or is pushed together', () => {
    expect(raisedIn('surge-lurch', 'crowd_surge')).toBeGreaterThanOrEqual(3);
    expect(raisedIn('surge-compress', 'crowd_surge')).toBeGreaterThanOrEqual(2);
  });

  it.each([
    'plaza-crossing',
    'commuter-flow',
    'jogging-group',
    'concert-jumping',
    'concert-sway',
    'group-breaks-up',
    'phone-turning-slowly',
    'phone-swung',
  ])('raises nothing for an everyday look-alike: %s', (id) => {
    expect(raisedAnything(id)).toBe(0);
  });

  it('reports crowd types unavailable while the phone is swung', () => {
    const frames = scenario('phone-swung').build(1);
    const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
    const unavailable = new Set<string>();
    for (const f of frames) for (const u of engine.update(f).unavailable) if (u.reason === 'Phone is moving') unavailable.add(u.type);
    expect([...unavailable].sort()).toEqual(['crowd_panic', 'crowd_surge', 'sudden_dispersal']);
  });

  it('explains a crowd candidate and only recommends, never acts', () => {
    const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
    let found = null;
    for (const seed of SEEDS) {
      engine.reset();
      for (const f of scenario('surge-lurch').build(seed)) {
        const c = engine.update(f).candidates.find((x) => x.type === 'crowd_surge');
        if (c) found = c;
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    expect(found!.calibrated).toBe(false);
    expect(found!.indicators.map((i) => i.id)).toContain('surge-packed');
    expect(found!.recommendedActions).toContain('Move diagonally toward the edge of the crowd');
  });
});
