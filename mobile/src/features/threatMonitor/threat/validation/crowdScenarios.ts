import type { MonitorFrame } from '../../models/types';
import { withOnset, type Clip, type Scenario } from './scenarios';
import { changeAt, packedBlock, placePeople, renderCrowd, rng, walker, type CrowdCamera, type Walker } from './syntheticCrowd';

// Labelled synthetic crowd scenes: the three crowd threats and the everyday
// scenes most likely to be mistaken for them (races, sport, concerts,
// commuters, a crossing starting on green, the phone turning). Seeds vary
// the camera (lens, height, tilt), detector noise, frame rate, crowd size,
// layout, direction and timing.

type Ctx = {
  r: () => number;
  fps: number;
  camera: CrowdCamera;
  duration: number;
  onset: number; // when the event starts, seconds
  // Floor area that's comfortably in view.
  area: (z0: number, z1: number) => { x0: number; x1: number; z0: number; z1: number };
  int: (a: number, b: number) => number;
  between: (a: number, b: number) => number;
};

function context(seed: number, duration = 12): Ctx {
  const r = rng(seed);
  const camera: CrowdCamera = {
    focal: 0.7 + r() * 0.25,
    height: 1.2 + r() * 0.4,
    horizon: 0.35 + r() * 0.15,
    aspect: r() < 0.8 ? 4 / 3 : 16 / 9,
    boxJitter: 0.02 + r() * 0.03,
    missRate: 0.04 + r() * 0.06,
  };
  const between = (a: number, b: number) => a + r() * (b - a);
  return {
    r,
    fps: [6, 8, 10][Math.floor(r() * 3)],
    camera,
    duration,
    onset: 3.5 + r() * 1.5,
    area: (z0, z1) => {
      const half = (0.4 / (camera.aspect * camera.focal)) * z0;
      return { x0: -half, x1: half, z0, z1 };
    },
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    between,
  };
}

const still = { vx: 0, vz: 0 };
// 0 at the front of a block (the side it moves toward), 1 at the back.
function backness(block: Array<{ x: number; z: number }>, dir: number) {
  const along = block.map((p) => Math.cos(dir) * p.x + Math.sin(dir) * p.z);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  return along.map((a) => (hi > lo ? (hi - a) / (hi - lo) : 0.5));
}
const heading = (angle: number, speed: number) => ({ vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed });
// Slow milling about: a small, random drift.
const mill = (c: Ctx) => heading(c.r() * Math.PI * 2, c.r() * 0.5);

// A standing crowd wider than the view, so turning the phone brings new people in.
const wideStandingCrowd = (c: Ctx) =>
  placePeople(c.r, c.int(30, 45), { x0: -14, x1: 14, z0: 6, z1: 14 }, 0.8).map((p) => walker(p.x, p.z, () => still, c.duration, 0.04, c.r() * 6));

function build(c: Ctx, walkers: Walker[], hasEvent: boolean): Clip {
  return withOnset(renderCrowd(walkers, c.camera, c.duration, c.fps, Math.floor(c.r() * 1e6)), hasEvent ? c.onset : undefined);
}

const scenario = (
  id: string,
  label: Scenario['label'],
  activity: string,
  make: (c: Ctx) => Walker[],
  alsoPresent?: Scenario['alsoPresent'],
): Scenario => ({
  id,
  label,
  activity,
  ...(alsoPresent ? { alsoPresent } : {}),
  build: (seed) => {
    const c = context(seed);
    return build(c, make(c), label !== 'none');
  },
});

export const CROWD_SCENARIOS: Scenario[] = [
  // ── Threats ────────────────────────────────────────────────────────────
  scenario('panic-flee-one-way', 'crowd_panic', 'people milling in a plaza suddenly run the same way', (c) => {
    const away = c.r() * Math.PI * 2;
    return placePeople(c.r, c.int(8, 14), c.area(7, 14), 1.0).map((p) => {
      const runs = c.r() < 0.85;
      const v = runs ? heading(away + (c.r() - 0.5) * 1.2, c.between(3, 5.5)) : mill(c);
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.8, mill(c), v), c.duration, 0.05, c.r() * 6);
    });
  }),
  scenario('panic-scatter', 'crowd_panic', 'people in a plaza suddenly run in all directions', (c) =>
    placePeople(c.r, c.int(8, 14), c.area(7, 14), 1.0).map((p) => {
      const v = c.r() < 0.85 ? heading(c.r() * Math.PI * 2, c.between(3, 5.5)) : mill(c);
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.8, mill(c), v), c.duration, 0.05, c.r() * 6);
    }),
    ['sudden_dispersal'],
  ),
  scenario('dispersal-cluster', 'sudden_dispersal', 'a standing group suddenly scatters outward', (c) => {
    const center = { x: c.between(-1, 1), z: c.between(8, 11) };
    const radius = c.between(1.2, 2);
    return Array.from({ length: c.int(7, 12) }, () => {
      const a = c.r() * Math.PI * 2;
      const d = radius * Math.sqrt(0.2 + 0.8 * c.r());
      const p = { x: center.x + Math.cos(a) * d, z: center.z + Math.sin(a) * d };
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.6, still, heading(a + (c.r() - 0.5) * 0.8, c.between(2.5, 5))), c.duration, 0.04, c.r() * 6);
    });
  }, ['crowd_panic']),
  scenario('dispersal-from-point', 'sudden_dispersal', 'people near something in a plaza move sharply away from it', (c) => {
    const people = placePeople(c.r, c.int(10, 14), c.area(7, 14), 1.0);
    const source = people[Math.floor(c.r() * people.length)];
    return people.map((p) => {
      const dx = p.x - source.x;
      const dz = p.z - source.z;
      const d = Math.hypot(dx, dz);
      const flees = d < 5 && d > 0.01;
      const v = flees ? heading(Math.atan2(dz, dx) + (c.r() - 0.5) * 0.6, c.between(2.5, 5)) : still;
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.6, still, d < 0.01 ? still : v), c.duration, 0.04, c.r() * 6);
    });
  }, ['crowd_panic']),
  scenario('surge-lurch', 'crowd_surge', 'a packed crowd is suddenly pushed forward together', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][c.int(0, 3)];
    const gap = c.between(0.5, 0.7);
    const rows = c.int(3, 4);
    const block = packedBlock(c.r, rows, c.int(4, 5), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, gap);
    const speed = c.between(1.6, 2.6);
    const back = backness(block, dir);
    return block.map((p, i) => {
      // People at the back are pushed harder, so the crowd compresses.
      const k = 0.85 + 0.3 * back[i];
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.3, still, heading(dir, speed * k), 0.5), c.duration, 0.03, c.r() * 6);
    });
  }),
  scenario('surge-compress', 'crowd_surge', 'the back of a packed crowd pushes forward into a blocked front', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][c.int(0, 3)];
    const rows = c.int(4, 5);
    const gap = c.between(0.55, 0.75);
    const block = packedBlock(c.r, rows, c.int(4, 5), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, gap);
    const back = backness(block, dir);
    const extent = (rows - 1) * gap;
    const push = c.between(1.6, 2.6);
    const at = c.onset + c.r() * 0.3;
    return block.map((p, i) => {
      // The back moves fastest; everyone stops once packed up against the
      // people in front (the block ends up ~half as deep).
      const speed = push * (0.4 + 0.6 * back[i]);
      const travel = push * 0.4 * 1.2 + back[i] * extent * 0.5;
      const stopAt = at + 0.3 + travel / speed;
      const v = heading(dir, speed);
      return walker(p.x, p.z, (t) => (t < stopAt ? changeAt(at, still, v, 0.6)(t) : still), c.duration, 0.03, c.r() * 6);
    });
  }),

  // ── Look-alikes (should produce nothing) ───────────────────────────────
  scenario('plaza-crossing', 'none', 'people walking across a plaza in all directions', (c) =>
    placePeople(c.r, c.int(8, 14), c.area(6, 15), 1.0).map((p) => {
      const v = heading(c.r() * Math.PI * 2, c.between(1, 1.6));
      return walker(p.x, p.z, () => v, c.duration, 0.03, c.r() * 6);
    }),
  ),
  scenario('commuter-flow', 'none', 'commuters walking the same way through a busy station', (c) => {
    const dir = c.r() * Math.PI * 2;
    return placePeople(c.r, c.int(10, 16), c.area(6, 13), 0.8).map((p) =>
      walker(p.x, p.z, () => heading(dir + (c.r() - 0.5) * 0.3, c.between(1.1, 1.6)), c.duration, 0.03, c.r() * 6),
    );
  }),
  scenario('jogging-group', 'none', 'a running club jogging past together', (c) => {
    const dir = c.r() < 0.5 ? 0 : Math.PI;
    return placePeople(c.r, c.int(6, 12), c.area(7, 12), 1.0).map((p) =>
      walker(p.x - Math.cos(dir) * 4, p.z, () => heading(dir, c.between(2.8, 4)), c.duration, 0.03, c.r() * 6),
    );
  }),
  scenario('race-start', 'none', 'runners at a start line set off together on the gun', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][c.int(0, 3)];
    return placePeople(c.r, c.int(8, 14), c.area(7, 12), 0.8).map((p) =>
      walker(p.x, p.z, changeAt(c.onset + c.r() * 0.6, still, heading(dir + (c.r() - 0.5) * 0.2, c.between(3, 5))), c.duration, 0.03, c.r() * 6),
    );
  }),
  scenario('sports-game', 'none', 'a pickup soccer game: sprints, stops and turns', (c) =>
    placePeople(c.r, c.int(6, 10), c.area(7, 15), 1.5).map((p) => {
      const plan = Array.from({ length: 8 }, () => ({ at: c.r() * c.duration, v: c.r() < 0.5 ? heading(c.r() * Math.PI * 2, c.between(3, 6)) : heading(c.r() * Math.PI * 2, c.between(0, 1.2)) })).sort((a, b) => a.at - b.at);
      const velocityAt = (t: number) => {
        let v = { vx: 0, vz: 0 };
        for (const step of plan) if (t >= step.at) v = step.v;
        return v;
      };
      return walker(p.x, p.z, velocityAt, c.duration, 0.03, c.r() * 6);
    }),
  ),
  scenario('concert-jumping', 'none', 'a packed concert crowd jumping to the beat', (c) => {
    const block = packedBlock(c.r, c.int(3, 4), c.int(4, 5), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, c.between(0.5, 0.7));
    const beat = c.between(1.8, 2.4);
    return block.map((p) => {
      const base = walker(p.x, p.z, () => still, c.duration, 0.06, c.r() * 6);
      const phase = c.r() * 0.3;
      return (t: number) => ({ ...base(t), lift: t > c.onset ? 0.3 * Math.max(0, Math.sin((t + phase) * beat * Math.PI * 2)) : 0 });
    });
  }),
  scenario('concert-sway', 'none', 'a packed crowd swaying side to side together', (c) => {
    const block = packedBlock(c.r, c.int(3, 4), c.int(4, 5), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, c.between(0.5, 0.7));
    const rate = c.between(0.4, 0.8);
    return block.map((p) => walker(p.x, p.z, (t) => ({ vx: t > c.onset ? 0.5 * Math.cos(t * rate * Math.PI * 2) : 0, vz: 0 }), c.duration, 0.04, c.r() * 6));
  }),
  scenario('crosswalk-start', 'none', 'people waiting at a crossing all start walking on green', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][c.int(0, 3)];
    return placePeople(c.r, c.int(8, 14), c.area(7, 11), 0.7).map((p) =>
      walker(p.x, p.z, changeAt(c.onset + c.r() * 1.2, still, heading(dir + (c.r() - 0.5) * 0.3, c.between(1.1, 1.6)), 0.8), c.duration, 0.03, c.r() * 6),
    );
  }),
  scenario('group-breaks-up', 'none', 'friends chatting in a circle say goodbye and walk off in different directions', (c) => {
    const center = { x: c.between(-1, 1), z: c.between(8, 11) };
    const n = c.int(5, 8);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + c.r() * 0.4;
      const p = { x: center.x + Math.cos(a) * 0.9, z: center.z + Math.sin(a) * 0.9 };
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 2.5, still, heading(a + (c.r() - 0.5) * 0.8, c.between(1, 1.5)), 0.8), c.duration, 0.04, c.r() * 6);
    });
  }),
  // Final baseline pass: more look-alikes.
  scenario('race-start-line', 'none', 'runners lined up on a start line set off together', (c) => {
    const lateral = c.r() < 0.5;
    const dir = lateral ? (c.r() < 0.5 ? 0 : Math.PI) : c.r() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    const n = c.int(8, 14);
    const center = { x: c.between(-0.5, 0.5), z: c.between(8, 11) };
    return Array.from({ length: n }, (_, i) => {
      const along = (i - (n - 1) / 2) * c.between(0.6, 0.9);
      const p = lateral ? { x: center.x + (c.r() - 0.5) * 0.3, z: center.z + along * 0.6 } : { x: center.x + along, z: center.z + (c.r() - 0.5) * 0.3 };
      return walker(p.x, p.z, changeAt(c.onset + c.r() * 0.5, still, heading(dir + (c.r() - 0.5) * 0.15, c.between(3, 5))), c.duration, 0.02, c.r() * 6);
    });
  }),
  scenario('goal-celebration', 'none', 'fans jump and rush toward the same spot to celebrate a goal', (c) => {
    const people = placePeople(c.r, c.int(10, 14), c.area(7, 14), 1.0);
    const spot = { x: c.between(-1, 1), z: c.between(9, 12) };
    return people.map((p) => {
      const dx = spot.x - p.x;
      const dz = spot.z - p.z;
      const d = Math.hypot(dx, dz);
      if (c.r() < 0.35 || d < 1) {
        const base = walker(p.x, p.z, () => still, c.duration, 0.05, c.r() * 6);
        return (t: number) => ({ ...base(t), lift: t > c.onset ? 0.35 * Math.max(0, Math.sin(t * 2.2 * Math.PI * 2)) : 0 });
      }
      const speed = c.between(2.5, 4);
      const at = c.onset + c.r() * 0.6;
      const stopAt = at + 0.3 + (d - 0.8) / speed;
      const v = heading(Math.atan2(dz, dx), speed);
      return walker(p.x, p.z, (t) => (t < stopAt ? changeAt(at, still, v)(t) : still), c.duration, 0.04, c.r() * 6);
    });
  }),
  scenario('venue-exit', 'none', 'a packed crowd starts walking out of a venue together', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][c.int(0, 3)];
    const block = packedBlock(c.r, c.int(3, 4), c.int(4, 5), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, c.between(0.5, 0.7));
    return block.map((p) => walker(p.x, p.z, changeAt(c.onset + c.r() * 1.5, still, heading(dir + (c.r() - 0.5) * 0.2, c.between(0.9, 1.4)), 0.8), c.duration, 0.03, c.r() * 6));
  }),
  scenario('queue-shuffle', 'none', 'a packed queue shuffles forward a step at a time', (c) => {
    const dir = [Math.PI / 2, -Math.PI / 2][c.int(0, 1)];
    const block = packedBlock(c.r, c.int(4, 5), c.int(2, 3), { x: c.between(-0.5, 0.5), z: c.between(9, 11) }, c.between(0.5, 0.7));
    const period = c.between(1.8, 2.6);
    return block.map((p) => walker(p.x, p.z, (t) => (t > c.onset && (t - c.onset) % period < 0.6 ? heading(dir, 0.8) : still), c.duration, 0.03, c.r() * 6));
  }),
  {
    id: 'phone-turning-slowly',
    label: 'none',
    activity: 'the phone slowly turns across a standing crowd (below the gyroscope threshold)',
    build: (seed) => {
      const c = context(seed);
      const rate = c.between(0.12, 0.25) * (c.r() < 0.5 ? 1 : -1);
      c.camera.rotationAt = (t) => (t > c.onset ? rate : 0);
      c.camera.panAt = (t) => Math.max(0, t - c.onset) * rate;
      return build(c, wideStandingCrowd(c), false);
    },
  },
  {
    id: 'phone-swung',
    label: 'none',
    activity: 'the phone is swung across a crowd (gyroscope reports it)',
    build: (seed) => {
      const c = context(seed);
      const rate = c.between(0.5, 1.2) * (c.r() < 0.5 ? 1 : -1);
      c.camera.rotationAt = (t) => (t > c.onset && t < c.onset + 1.5 ? rate : 0);
      c.camera.panAt = (t) => Math.min(1.5, Math.max(0, t - c.onset)) * rate;
      return build(c, wideStandingCrowd(c), false);
    },
  },
];
