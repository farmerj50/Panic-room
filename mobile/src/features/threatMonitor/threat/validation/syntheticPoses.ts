import type { Keypoint, Pose } from '../../models/types';
import type { SyntheticPerson } from './syntheticFrames';

// A 2-D stick figure that produces MoveNet-style keypoints, plus scripted
// actions (threats and everyday look-alikes) for unit tests and offline
// validation. Synthetic: it proves the logic, never real-world accuracy.

export type ArmPose = {
  shoulder: number; // degrees from hanging down: 0 down, 90 straight out in front, 180 straight up
  elbow: number; // bend: 0 straight, 90 right angle
};

export type BodyParams = {
  hipX: number; // hip center, normalized
  hipY: number;
  height: number; // standing body height, normalized to frame height
  torsoTilt?: number; // degrees from vertical (positive leans toward `facing`)
  facing?: 1 | -1; // +1 faces right
  leftArm?: ArmPose;
  rightArm?: ArmPose;
  kneeBend?: number; // degrees
  aspect?: number; // frame height / width, to keep proportions square
  noise?: number; // keypoint jitter (normalized)
  seed?: number;
};

const rad = (d: number) => (d * Math.PI) / 180;

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

export function skeleton(params: BodyParams): Pose {
  const H = params.height;
  const aspect = params.aspect ?? 4 / 3;
  const facing = params.facing ?? 1;
  const tilt = rad(params.torsoTilt ?? 0) * facing;
  const jitter = rng((params.seed ?? 1) + Math.round(params.hipX * 1000) + Math.round(params.hipY * 1000));
  const n = params.noise ?? 0;
  // Work in "height units"; x scaled by aspect so limbs keep proportions.
  const toFrame = (x: number, y: number): Keypoint => ({
    x: params.hipX + (x * H) / aspect + jitter() * n,
    y: params.hipY + y * H + jitter() * n,
    score: 0.9,
  });
  // Torso axis (up from hips), rotated by tilt.
  const up = { x: Math.sin(tilt), y: -Math.cos(tilt) };
  const side = { x: Math.cos(tilt), y: Math.sin(tilt) }; // perpendicular, toward facing for +
  const torso = 0.3;
  const sh = { x: up.x * torso, y: up.y * torso };
  const head = { x: sh.x + up.x * 0.1, y: sh.y + up.y * 0.1 };
  const shW = 0.09;
  const hipW = 0.06;

  const arm = (base: { x: number; y: number }, a: ArmPose | undefined) => {
    const p = a ?? { shoulder: 10, elbow: 10 };
    // Hanging-down direction is -up; rotate toward facing by `shoulder` degrees.
    const ang = rad(p.shoulder);
    const dir1 = {
      x: -up.x * Math.cos(ang) + side.x * facing * Math.sin(ang),
      y: -up.y * Math.cos(ang) + side.y * facing * Math.sin(ang),
    };
    const elbow = { x: base.x + dir1.x * 0.17, y: base.y + dir1.y * 0.17 };
    const ang2 = ang + rad(p.elbow);
    const dir2 = {
      x: -up.x * Math.cos(ang2) + side.x * facing * Math.sin(ang2),
      y: -up.y * Math.cos(ang2) + side.y * facing * Math.sin(ang2),
    };
    const wrist = { x: elbow.x + dir2.x * 0.15, y: elbow.y + dir2.y * 0.15 };
    return { elbow, wrist };
  };

  const lSh = { x: sh.x - side.x * shW, y: sh.y - side.y * shW };
  const rSh = { x: sh.x + side.x * shW, y: sh.y + side.y * shW };
  const lArm = arm(lSh, params.leftArm);
  const rArm = arm(rSh, params.rightArm);
  const lHip = { x: -side.x * hipW, y: -side.y * hipW };
  const rHip = { x: side.x * hipW, y: side.y * hipW };
  // Legs hang from the hips (straight down unless lying: follow the torso).
  const legDir = { x: -up.x, y: -up.y };
  const knee = rad(params.kneeBend ?? 0);
  const leg = (h: { x: number; y: number }) => {
    const k = { x: h.x + legDir.x * 0.24, y: h.y + legDir.y * 0.24 };
    const a = { x: k.x + (legDir.x * Math.cos(knee) + side.x * facing * Math.sin(knee)) * 0.24, y: k.y + (legDir.y * Math.cos(knee) + side.y * facing * Math.sin(knee)) * 0.24 };
    return { k, a };
  };
  const lLeg = leg(lHip);
  const rLeg = leg(rHip);

  const pts = [
    head,
    { x: head.x - side.x * 0.02, y: head.y - side.y * 0.02 },
    { x: head.x + side.x * 0.02, y: head.y + side.y * 0.02 },
    { x: head.x - side.x * 0.04, y: head.y - side.y * 0.04 },
    { x: head.x + side.x * 0.04, y: head.y + side.y * 0.04 },
    lSh,
    rSh,
    lArm.elbow,
    rArm.elbow,
    lArm.wrist,
    rArm.wrist,
    lHip,
    rHip,
    lLeg.k,
    rLeg.k,
    lLeg.a,
    rLeg.a,
  ];
  return { score: 0.85, keypoints: pts.map((p) => toFrame(p.x, p.y)) };
}

// Box around the keypoints with a small margin, as the person detector would give.
export function poseBox(pose: Pose) {
  const xs = pose.keypoints.map((k) => k.x);
  const ys = pose.keypoints.map((k) => k.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const mx = (maxX - minX) * 0.1 + 0.01;
  const my = (maxY - minY) * 0.05 + 0.01;
  return { x: minX - mx, y: minY - my, width: maxX - minX + 2 * mx, height: maxY - minY + 2 * my };
}

export type ActorAt = (tSec: number) => BodyParams;

// Converts body parameters over time into a SyntheticPerson with box, pose and velocity.
export function actor(id: number, at: ActorAt, fps: number): (tSec: number) => SyntheticPerson {
  return (t) => {
    const pose = skeleton(at(t));
    const box = poseBox(pose);
    const prev = poseBox(skeleton(at(Math.max(0, t - 1 / fps))));
    const dt = t > 0 ? 1 / fps : 1;
    return {
      id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      vx: (box.x + box.width / 2 - (prev.x + prev.width / 2)) / dt,
      vy: (box.y + box.height / 2 - (prev.y + prev.height / 2)) / dt,
      pose,
    };
  };
}

// ── Scripted actions (BodyParams over time) ─────────────────────────────────
const H = 0.55; // a person filling roughly half the frame height
const STAND_Y = 0.6;

export const actions = {
  stand: (x: number, facing: 1 | -1 = 1): ActorAt => () => ({ hipX: x, hipY: STAND_Y, height: H, facing }),

  walk: (x0: number, speed: number, facing: 1 | -1 = 1): ActorAt => (t) => ({
    hipX: x0 + speed * t,
    hipY: STAND_Y,
    height: H,
    facing,
    leftArm: { shoulder: 20 * Math.sin(t * 6), elbow: 15 },
    rightArm: { shoulder: -20 * Math.sin(t * 6), elbow: 15 },
  }),

  run: (x0: number, speed: number, facing: 1 | -1 = 1): ActorAt => (t) => ({
    hipX: x0 + speed * t,
    hipY: STAND_Y,
    height: H,
    facing,
    torsoTilt: 12,
    leftArm: { shoulder: 50 * Math.sin(t * 10), elbow: 80 },
    rightArm: { shoulder: -50 * Math.sin(t * 10), elbow: 80 },
  }),

  // Repeated straight punches with the right arm at someone in front.
  punching: (x: number, facing: 1 | -1, opts: { start?: number; period?: number; stop?: number } = {}): ActorAt => (t) => {
    const start = opts.start ?? 0.5;
    const period = opts.period ?? 0.55;
    const active = t >= start && t < (opts.stop ?? Infinity);
    const phase = active ? ((t - start) % period) / period : 0;
    // Realistic timing: the fist reaches the target in ~0.12 s, held briefly,
    // then pulled back to the guard.
    const extendFor = 0.12 / period;
    const ext = !active ? 0 : phase < extendFor ? phase / extendFor : phase < extendFor + 0.1 ? 1 : Math.max(0, 1 - (phase - extendFor - 0.1) / 0.4);
    return {
      hipX: x,
      hipY: STAND_Y,
      height: H,
      facing,
      torsoTilt: 10 * ext,
      leftArm: { shoulder: 70, elbow: 110 }, // guard up
      rightArm: { shoulder: 25 + 65 * ext, elbow: 130 * (1 - ext) }, // from a guard at the chest to full extension
    };
  },

  // Collapses to the ground (tripping, fainting or knocked down).
  fall: (x: number, at: number, facing: 1 | -1 = 1, durationSec = 0.6): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / durationSec));
    const e = k * k; // accelerating
    return {
      hipX: x + 0.12 * e * facing,
      hipY: STAND_Y + (0.27 * H) * e,
      height: H,
      facing,
      torsoTilt: 85 * e,
      leftArm: { shoulder: 30 + 60 * e, elbow: 20 },
      rightArm: { shoulder: 30 + 60 * e, elbow: 20 },
    };
  },

  // Sits down on purpose: slow, torso stays fairly upright.
  sitDown: (x: number, at: number): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / 2.5));
    return { hipX: x, hipY: STAND_Y + 0.2 * H * k, height: H, torsoTilt: 15 * k, kneeBend: 90 * k };
  },

  // Bends to pick something up and straightens again.
  bendOver: (x: number, at: number): ActorAt => (t) => {
    const k = t < at ? 0 : t < at + 1 ? (t - at) : t < at + 2 ? 1 : Math.max(0, 1 - (t - at - 2));
    return { hipX: x, hipY: STAND_Y, height: H, torsoTilt: 75 * k, leftArm: { shoulder: 30, elbow: 0 }, rightArm: { shoulder: 30, elbow: 0 } };
  },

  // Lies down deliberately and slowly (e.g. on a lawn).
  lieDown: (x: number, at: number): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / 4));
    return { hipX: x, hipY: STAND_Y + 0.27 * H * k, height: H, torsoTilt: 85 * k, kneeBend: 40 * (1 - k) };
  },

  hug: (x: number, facing: 1 | -1): ActorAt => (t) => ({
    hipX: x,
    hipY: STAND_Y,
    height: H,
    facing,
    torsoTilt: 10,
    leftArm: { shoulder: 85 + 5 * Math.sin(t * 2), elbow: 70 },
    rightArm: { shoulder: 85 + 5 * Math.sin(t * 2), elbow: 70 },
  }),

  // Energetic dancing: big, fast arm movement, not aimed at anyone.
  dance: (x: number, facing: 1 | -1 = 1, freq = 2): ActorAt => (t) => ({
    hipX: x + 0.02 * Math.sin(t * freq * Math.PI),
    hipY: STAND_Y - 0.01 * Math.abs(Math.sin(t * freq * 2 * Math.PI)),
    height: H,
    facing,
    leftArm: { shoulder: 160 - 120 * Math.abs(Math.sin(t * freq * Math.PI)), elbow: 30 },
    rightArm: { shoulder: 40 + 120 * Math.abs(Math.sin(t * freq * Math.PI + 1)), elbow: 30 },
  }),

  // Sits straight down onto the floor quickly (a child plopping down): hips
  // drop fast but the torso stays upright.
  plopSit: (x: number, at: number): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / 0.6));
    return { hipX: x, hipY: STAND_Y + 0.42 * H * k, height: H, torsoTilt: 10 * k, kneeBend: 100 * k };
  },

  // Kneels down (to tie a shoe), torso upright, then stands again.
  kneel: (x: number, at: number): ActorAt => (t) => {
    const k = t < at ? 0 : t < at + 0.8 ? (t - at) / 0.8 : t < at + 3 ? 1 : Math.max(0, 1 - (t - at - 3) / 0.8);
    return { hipX: x, hipY: STAND_Y + 0.25 * H * k, height: H, torsoTilt: 20 * k, kneeBend: 90 * k };
  },

  // Flops down onto a bed or couch on purpose: fast, and nearly a fall.
  flopDown: (x: number, at: number, facing: 1 | -1 = 1): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / 0.9));
    return { hipX: x + 0.05 * k * facing, hipY: STAND_Y + 0.2 * H * k, height: H, facing, torsoTilt: 80 * k, kneeBend: 40 * k };
  },

  // ── Gestures and interactions (final baseline pass) ─────────────────────
  // Handshake: right hand out to meet the other person's, a few small pumps.
  handshake: (x: number, facing: 1 | -1, at: number): ActorAt => (t) => {
    const on = t >= at && t < at + 1.6;
    return { hipX: x, hipY: STAND_Y, height: H, facing, rightArm: { shoulder: on ? 55 + 6 * Math.sin((t - at) * 14) : 10, elbow: on ? 25 : 10 } };
  },

  // Waving at someone across the room.
  wave: (x: number, facing: 1 | -1, at: number): ActorAt => (t) => {
    const on = t >= at && t < at + 2.2;
    return { hipX: x, hipY: STAND_Y, height: H, facing, rightArm: { shoulder: on ? 150 : 10, elbow: on ? 35 + 30 * Math.sin((t - at) * 12) : 10 } };
  },

  // Pointing at someone while talking.
  point: (x: number, facing: 1 | -1, at: number): ActorAt => (t) => {
    const k = Math.min(1, Math.max(0, (t - at) / 0.4)) * (t < at + 2.5 ? 1 : Math.max(0, 1 - (t - at - 2.5) / 0.4));
    return { hipX: x, hipY: STAND_Y, height: H, facing, rightArm: { shoulder: 10 + 80 * k, elbow: 10 * (1 - k) } };
  },

  // Stretching both arms overhead.
  stretch: (x: number, at: number): ActorAt => (t) => {
    const k = t < at ? 0 : t < at + 1 ? t - at : t < at + 2.5 ? 1 : Math.max(0, 1 - (t - at - 2.5));
    return { hipX: x, hipY: STAND_Y, height: H, leftArm: { shoulder: 10 + 160 * k, elbow: 10 }, rightArm: { shoulder: 10 + 160 * k, elbow: 10 } };
  },

  // A hard two-handed shove at `at` (and again at `again`, if given).
  shove: (x: number, facing: 1 | -1, at: number, again?: number): ActorAt => (t) => {
    const ext = (s: number) => (t < s ? 0 : t < s + 0.15 ? (t - s) / 0.15 : t < s + 0.35 ? 1 : Math.max(0, 1 - (t - s - 0.35) / 0.4));
    const k = Math.max(ext(at), again != null ? ext(again) : 0);
    return {
      hipX: x + 0.03 * k * facing,
      hipY: STAND_Y,
      height: H,
      facing,
      torsoTilt: 12 * k,
      leftArm: { shoulder: 60 + 30 * k, elbow: 100 * (1 - k) },
      rightArm: { shoulder: 60 + 30 * k, elbow: 100 * (1 - k) },
    };
  },

  // Being shoved: pushed backwards (away from `facing`) just after each shove lands.
  shoved: (x: number, facing: 1 | -1, at: number, again?: number): ActorAt => (t) => {
    const push = (s: number) => Math.min(1, Math.max(0, (t - s - 0.12) / 0.35));
    const back = 0.09 * push(at) + (again != null ? 0.09 * push(again) : 0);
    const reel = Math.max(0, 1 - Math.abs(t - at - 0.3) / 0.4) + (again != null ? Math.max(0, 1 - Math.abs(t - again - 0.3) / 0.4) : 0);
    return { hipX: x - back * facing, hipY: STAND_Y, height: H, facing, torsoTilt: -15 * Math.min(1, reel), leftArm: { shoulder: 30 + 40 * Math.min(1, reel), elbow: 30 }, rightArm: { shoulder: 30 + 40 * Math.min(1, reel), elbow: 30 } };
  },

  // Play-fighting: slow, pulled punches that stop short of the other person.
  playPunch: (x: number, facing: 1 | -1, opts: { start?: number; period?: number } = {}): ActorAt => (t) => {
    const start = opts.start ?? 0.8;
    const period = opts.period ?? 0.9;
    const phase = t >= start ? ((t - start) % period) / period : 0;
    const ext = t < start ? 0 : phase < 0.35 ? phase / 0.35 : Math.max(0, 1 - (phase - 0.35) / 0.4);
    return {
      hipX: x,
      hipY: STAND_Y,
      height: H,
      facing,
      leftArm: { shoulder: 70, elbow: 110 },
      rightArm: { shoulder: 25 + 45 * ext, elbow: 130 - 70 * ext }, // never fully extended
    };
  },

  // Holding punch pads out in front of the chest for a partner (sport).
  holdPads: (x: number, facing: 1 | -1): ActorAt => (t) => ({
    hipX: x,
    hipY: STAND_Y,
    height: H,
    facing,
    leftArm: { shoulder: 85 + 3 * Math.sin(t * 3), elbow: 30 },
    rightArm: { shoulder: 85 + 3 * Math.sin(t * 3 + 1), elbow: 30 },
  }),

  // One quick mutual high-five.
  highFive: (x: number, facing: 1 | -1, at: number): ActorAt => (t) => {
    const k = Math.max(0, 1 - Math.abs(t - at) / 0.3);
    return { hipX: x, hipY: STAND_Y, height: H, facing, rightArm: { shoulder: 20 + 140 * k, elbow: 20 } };
  },
};
