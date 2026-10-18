import type { MonitorFrame } from '../../models/types';
import type { ThreatType } from '../types';
import { syntheticSequence, type SyntheticPerson } from './syntheticFrames';
import { CROWD_SCENARIOS } from './crowdScenarios';
import { actions, actor, type ActorAt } from './syntheticPoses';

// Labelled synthetic scenarios: threats and everyday look-alikes. Seeds vary
// placement, timing, frame rate, keypoint noise and pose dropout. Synthetic
// results prove the logic only — never real-world accuracy.

export type ScenarioLabel = ThreatType | 'none';

// A generated clip: frames, plus when the labelled event starts (absent for
// look-alikes).
export type Clip = MonitorFrame[] & { onsetMs?: number };

export type Scenario = {
  id: string;
  label: ScenarioLabel;
  activity: string;
  // Other threat types that genuinely occur in this clip too (a victim who is
  // knocked down also falls; people scattering also break into a run).
  // Raising them is a legitimate overlapping event, not a false alarm, and
  // not raising them is not a miss.
  alsoPresent?: ThreatType[];
  build: (seed: number) => Clip;
};

export function withOnset(frames: MonitorFrame[], onsetSec: number | undefined): Clip {
  const clip = frames as Clip;
  if (onsetSec != null && frames.length) clip.onsetMs = frames[0].timestamp + Math.round(onsetSec * 1000);
  return clip;
}

export const SPLITS = {
  train: { from: 1, to: 99 },
  validation: { from: 100, to: 199 },
  evaluation: { from: 200, to: 299 },
} as const;
export type SplitName = keyof typeof SPLITS;

function rand(seed: number) {
  let s = (seed * 7919) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// Common variation for a seed.
function variation(seed: number) {
  const r = rand(seed);
  return {
    fps: [6, 8, 10][Math.floor(r() * 3)],
    shift: (r() - 0.5) * 0.2, // horizontal placement
    timing: r() * 1.5, // when things start
    noise: 0.002 + r() * 0.006, // keypoint jitter
    dropout: r() * 0.15, // share of frames with a person's pose missing
    facing: (r() < 0.5 ? 1 : -1) as 1 | -1,
    r,
  };
}

function scene(
  seed: number,
  durationSec: number,
  cast: Array<(fps: number, v: ReturnType<typeof variation>) => (t: number) => SyntheticPerson>,
  onset?: (v: ReturnType<typeof variation>) => number,
): Clip {
  const v = variation(seed);
  const people = cast.map((c) => c(v.fps, v));
  const onsetSec = onset?.(v);
  return withOnset(syntheticSequence(durationSec, v.fps, (t) =>
    people.map((p) => {
      const person = p(t);
      // Pose occasionally missing (model miss, occlusion).
      return v.r() < v.dropout ? { ...person, pose: undefined } : person;
    }),
  ), onsetSec);
}

const withNoise = (at: ActorAt, v: ReturnType<typeof variation>): ActorAt => (t) => ({ ...at(t), noise: v.noise });
const cast = (id: number, make: (v: ReturnType<typeof variation>) => ActorAt) => (fps: number, v: ReturnType<typeof variation>) =>
  actor(id, withNoise(make(v), v), fps);

// Fist-to-face distance for the stick figure: hips ~0.22 frame widths apart.
const REACH = 0.22;

// Person-level scenes (pose): falls, fights and their look-alikes.
export const POSE_SCENARIOS: Scenario[] = [
  // ── Threats ────────────────────────────────────────────────────────────
  {
    id: 'fall-forward',
    label: 'fall',
    activity: 'person trips and falls, stays down',
    build: (seed) => scene(seed, 7, [cast(1, (v) => actions.fall(0.4 + v.shift, 1.5 + v.timing, v.facing))], (v) => 1.5 + v.timing),
  },
  {
    id: 'fall-while-walking',
    label: 'fall',
    activity: 'walking person collapses',
    build: (seed) =>
      scene(seed, 7, [
        cast(1, (v) => {
          const walk = actions.walk(0.3 + v.shift, 0.05, v.facing);
          const at = 2 + v.timing;
          return (t) => (t < at ? walk(t) : actions.fall(walk(at).hipX, at, v.facing, 0.5)(t));
        }),
      ], (v) => 2 + v.timing),
  },
  {
    id: 'mutual-fight',
    label: 'physical_confrontation',
    activity: 'two people exchanging punches',
    alsoPresent: ['assault'],
    build: (seed) =>
      scene(seed, 7, [
        cast(1, (v) => actions.punching(0.35 + v.shift, 1, { start: 0.8 + v.timing, period: 0.5 })),
        cast(2, (v) => actions.punching(0.35 + v.shift + REACH, -1, { start: 1.0 + v.timing, period: 0.6 })),
      ], (v) => 0.8 + v.timing),
  },
  {
    id: 'one-sided-attack',
    label: 'assault',
    activity: 'one person repeatedly punching another who does not fight back',
    alsoPresent: ['physical_confrontation'],
    build: (seed) =>
      scene(seed, 7, [
        cast(1, (v) => actions.punching(0.35 + v.shift, 1, { start: 0.8 + v.timing, period: 0.5 })),
        cast(2, (v) => actions.stand(0.35 + v.shift + REACH, -1)),
      ], (v) => 0.8 + v.timing),
  },
  {
    id: 'attack-victim-falls',
    label: 'assault',
    activity: 'person is punched and knocked down',
    alsoPresent: ['fall', 'physical_confrontation'],
    build: (seed) =>
      scene(seed, 8, [
        cast(1, (v) => actions.punching(0.35 + v.shift, 1, { start: 0.8 + v.timing, period: 0.5 })),
        cast(2, (v) => actions.fall(0.35 + v.shift + REACH, 2.6 + v.timing, 1, 0.5)),
      ], (v) => 0.8 + v.timing),
  },

  {
    id: 'shove-attack',
    label: 'assault',
    activity: 'one person shoves another hard, twice, pushing them back',
    build: (seed) =>
      scene(
        seed,
        7,
        [
          cast(1, (v) => actions.shove(0.36 + v.shift, 1, 1.5 + v.timing, 3.2 + v.timing)),
          cast(2, (v) => actions.shoved(0.36 + v.shift + 0.18, -1, 1.5 + v.timing, 3.2 + v.timing)),
        ],
        (v) => 1.5 + v.timing,
      ),
  },

  // ── Look-alikes (should produce nothing) ───────────────────────────────
  { id: 'walk-alone', label: 'none', activity: 'person walking past', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.walk(0.1 + v.shift, 0.1, 1))]) },
  {
    id: 'walk-past-each-other',
    label: 'none',
    activity: 'two people walking past each other',
    build: (seed) => scene(seed, 7, [cast(1, (v) => actions.walk(0.1 + v.shift, 0.1, 1)), cast(2, (v) => actions.walk(0.8 + v.shift, -0.1, -1))]),
  },
  { id: 'sit-down', label: 'none', activity: 'person sits down on purpose', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.sitDown(0.4 + v.shift, 1 + v.timing))]) },
  { id: 'lie-down', label: 'none', activity: 'person lies down slowly (e.g. on a lawn)', build: (seed) => scene(seed, 9, [cast(1, (v) => actions.lieDown(0.4 + v.shift, 1 + v.timing))]) },
  { id: 'bend-over', label: 'none', activity: 'person bends to pick something up', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.bendOver(0.4 + v.shift, 1 + v.timing))]) },
  {
    id: 'hug',
    label: 'none',
    activity: 'two people hugging',
    build: (seed) => scene(seed, 7, [cast(1, (v) => actions.hug(0.4 + v.shift, 1)), cast(2, (v) => actions.hug(0.4 + v.shift + 0.12, -1))]),
  },
  {
    id: 'dance-pair-close',
    label: 'none',
    activity: 'two people dancing near each other',
    build: (seed) =>
      scene(seed, 7, [cast(1, (v) => actions.dance(0.33 + v.shift, 1, 2)), cast(2, (v) => actions.dance(0.33 + v.shift + 0.3, -1, 2.3))]),
  },
  {
    id: 'high-five',
    label: 'none',
    activity: 'two friends high-five',
    build: (seed) =>
      scene(seed, 6, [cast(1, (v) => actions.highFive(0.38 + v.shift, 1, 2 + v.timing)), cast(2, (v) => actions.highFive(0.38 + v.shift + REACH, -1, 2 + v.timing))]),
  },
  {
    id: 'standing-chat',
    label: 'none',
    activity: 'two people talking face to face',
    build: (seed) => scene(seed, 7, [cast(1, (v) => actions.stand(0.38 + v.shift, 1)), cast(2, (v) => actions.stand(0.38 + v.shift + REACH, -1))]),
  },
  {
    id: 'run-past',
    label: 'none',
    activity: 'two joggers running past each other',
    build: (seed) => scene(seed, 6, [cast(1, (v) => actions.run(0.05 + v.shift, 0.25, 1)), cast(2, (v) => actions.run(0.95 + v.shift, -0.25, -1))]),
  },

  // Fall look-alikes (final baseline pass).
  { id: 'plop-sit', label: 'none', activity: 'someone drops quickly to sit on the floor', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.plopSit(0.4 + v.shift, 1.5 + v.timing))]) },
  { id: 'kneel', label: 'none', activity: 'someone kneels to tie a shoe and stands up', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.kneel(0.4 + v.shift, 1.5 + v.timing))]) },
  { id: 'flop-on-bed', label: 'none', activity: 'someone flops down onto a bed or couch on purpose', build: (seed) => scene(seed, 7, [cast(1, (v) => actions.flopDown(0.4 + v.shift, 1.5 + v.timing, v.facing))]) },

  // Ordinary gestures and interactions (final baseline pass).
  {
    id: 'handshake',
    label: 'none',
    activity: 'two people shake hands',
    build: (seed) =>
      scene(seed, 6, [cast(1, (v) => actions.handshake(0.38 + v.shift, 1, 2 + v.timing)), cast(2, (v) => actions.handshake(0.38 + v.shift + REACH + 0.02, -1, 2 + v.timing))]),
  },
  {
    id: 'wave-hello',
    label: 'none',
    activity: 'someone waves hello to a friend a few steps away',
    build: (seed) => scene(seed, 6, [cast(1, (v) => actions.wave(0.3 + v.shift, 1, 1.5 + v.timing)), cast(2, (v) => actions.stand(0.3 + v.shift + 0.38, -1))]),
  },
  {
    id: 'point-and-talk',
    label: 'none',
    activity: 'someone points at the person they are talking to',
    build: (seed) => scene(seed, 6, [cast(1, (v) => actions.point(0.34 + v.shift, 1, 1.5 + v.timing)), cast(2, (v) => actions.stand(0.34 + v.shift + 0.3, -1))]),
  },
  {
    id: 'stretch-near-friend',
    label: 'none',
    activity: 'someone stretches their arms overhead next to a friend',
    build: (seed) => scene(seed, 6, [cast(1, (v) => actions.stretch(0.36 + v.shift, 1.5 + v.timing)), cast(2, (v) => actions.stand(0.36 + v.shift + REACH, -1))]),
  },
  {
    id: 'play-fight',
    label: 'none',
    activity: 'friends play-fighting: slow pulled punches that stop short',
    build: (seed) =>
      scene(seed, 7, [
        cast(1, (v) => actions.playPunch(0.35 + v.shift, 1, { start: 0.8 + v.timing, period: 0.9 })),
        cast(2, (v) => actions.playPunch(0.35 + v.shift + REACH + 0.06, -1, { start: 1.2 + v.timing, period: 1.0 })),
      ]),
  },
  {
    id: 'pad-training',
    label: 'none',
    activity: 'boxing practice: punches land on pads a partner holds up',
    build: (seed) =>
      scene(seed, 7, [
        cast(1, (v) => actions.punching(0.35 + v.shift, 1, { start: 0.8 + v.timing, period: 0.55 })),
        cast(2, (v) => actions.holdPads(0.35 + v.shift + REACH + 0.06, -1)),
      ]),
  },
];

export { CROWD_SCENARIOS };
export const SCENARIOS: Scenario[] = [...POSE_SCENARIOS, ...CROWD_SCENARIOS];
