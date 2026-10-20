import type { Detection, MonitorFrame } from '../../models/types';
import { computeCrowdMetrics } from '../../services/CrowdMetricsService';
import { PersonTracker } from '../../services/PersonTrackingService';

// Synthetic crowds for the crowd detectors: people walk on a floor (metres),
// a phone camera at chest height projects them into boxes, the boxes get
// detector-like noise (jitter, misses, people hidden behind others), and the
// result goes through the app's real tracker and crowd metrics. Synthetic:
// it proves the logic, never real-world accuracy.

export type FloorPos = { x: number; z: number; lift?: number }; // x sideways, z distance from camera, lift = feet off the ground
export type Walker = (t: number) => FloorPos;

export type CrowdCamera = {
  focal: number; // frame heights; varied per seed (the detectors assume 0.8)
  height: number; // metres
  horizon: number; // horizon line, frame heights from the top
  aspect: number; // frame height / width
  boxJitter: number; // box noise, share of box height
  missRate: number;
  rotationAt?: (t: number) => number; // gyroscope, rad/s
  panAt?: (t: number) => number; // how far the phone has turned, radians
};

const PERSON_H = 1.7;
const PERSON_W = 0.5;

export function rng(seed: number) {
  let s = (seed * 104729 + 7) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// A walker from a velocity profile (m/s), integrated in small steps.
export function walker(x0: number, z0: number, velocityAt: (t: number) => { vx: number; vz: number }, durationSec: number, swayM = 0.05, phase = 0): Walker {
  const dt = 0.02;
  const xs: number[] = [x0];
  const zs: number[] = [z0];
  for (let t = 0; t < durationSec + 1; t += dt) {
    const v = velocityAt(t);
    xs.push(xs[xs.length - 1] + v.vx * dt);
    zs.push(Math.max(1.5, zs[zs.length - 1] + v.vz * dt));
  }
  return (t) => {
    const i = Math.min(xs.length - 1, Math.max(0, Math.round(t / dt)));
    return { x: xs[i] + swayM * Math.sin(t * 1.3 + phase), z: zs[i] + swayM * Math.cos(t * 0.9 + phase) };
  };
}

// Velocity that changes from `from` to `to` at `at`, over `rampSec` (people
// need a moment to speed up).
export const changeAt = (at: number, from: { vx: number; vz: number }, to: { vx: number; vz: number }, rampSec = 0.4) => (t: number) => {
  const k = Math.min(1, Math.max(0, (t - at) / rampSec));
  return { vx: from.vx + (to.vx - from.vx) * k, vz: from.vz + (to.vz - from.vz) * k };
};

export function renderCrowd(walkers: Walker[], camera: CrowdCamera, durationSec: number, fps: number, seed: number): MonitorFrame[] {
  const r = rng(seed + 13);
  const gauss = () => (r() + r() + r() - 1.5) * 1.15;
  const tracker = new PersonTracker();
  const frames: MonitorFrame[] = [];
  const start = 2_000_000;
  for (let i = 0; i < Math.round(durationSec * fps); i += 1) {
    const t = i / fps;
    const pan = camera.panAt?.(t) ?? 0;
    // Project everyone, nearest first (they hide people behind them).
    const boxes = walkers
      .map((w) => w(t))
      .filter((p) => p.z > 1.5)
      .sort((a, b) => a.z - b.z)
      .map((p) => {
        const h = (PERSON_H * camera.focal) / p.z;
        const feetY = camera.horizon + (camera.height * camera.focal) / p.z - ((p.lift ?? 0) * camera.focal) / p.z;
        const cx = 0.5 + ((p.x * camera.focal) / p.z - pan * camera.focal) * camera.aspect;
        const w = ((PERSON_W * camera.focal) / p.z) * camera.aspect;
        return { x: cx - w / 2, y: feetY - h, width: w, height: h };
      });
    const detections: Detection[] = [];
    boxes.forEach((b, k) => {
      if (b.height < 0.05 || b.x + b.width < 0.02 || b.x > 0.98 || b.y > 1) return;
      const hiddenBy = boxes.slice(0, k).some((n) => overlapShare(b, n) > 0.6);
      if (r() < camera.missRate || (hiddenBy && r() < 0.6)) return;
      const j = camera.boxJitter * b.height;
      const s = 1 + gauss() * camera.boxJitter;
      detections.push({
        x: b.x + gauss() * j * 0.5,
        y: b.y + gauss() * j * 0.5,
        width: b.width * s,
        height: b.height * s,
        score: 0.5 + r() * 0.4,
      });
    });
    const people = tracker.update(detections, start + Math.round(t * 1000), camera.aspect);
    const rotation = Math.abs(camera.rotationAt?.(t) ?? 0) + r() * 0.03;
    frames.push({
      timestamp: start + Math.round(t * 1000),
      sessionId: `synthetic-crowd-${seed}`,
      peopleCount: people.length,
      detections: people,
      crowdMetrics: computeCrowdMetrics(people, { deviceRotationRate: rotation }),
      inferenceMs: 40,
      frameAspect: camera.aspect,
    });
  }
  return frames;
}

// Share of box a covered by box b.
function overlapShare(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (w * h) / (a.width * a.height || 1);
}

// Random floor positions inside a box, at least `minGap` metres apart.
export function placePeople(r: () => number, n: number, area: { x0: number; x1: number; z0: number; z1: number }, minGap: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let tries = 0; out.length < n && tries < n * 200; tries += 1) {
    const p = { x: area.x0 + r() * (area.x1 - area.x0), z: area.z0 + r() * (area.z1 - area.z0) };
    if (out.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= minGap)) out.push(p);
  }
  return out;
}

// A packed block of people in rows, `gap` metres apart with some jitter.
export function packedBlock(r: () => number, rows: number, cols: number, center: { x: number; z: number }, gap: number) {
  const out: Array<{ x: number; z: number; row: number }> = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      out.push({
        x: center.x + (j - (cols - 1) / 2) * gap + (r() - 0.5) * gap * 0.4 + (i % 2) * gap * 0.5,
        z: center.z + (i - (rows - 1) / 2) * gap + (r() - 0.5) * gap * 0.4,
        row: i,
      });
    }
  }
  return out;
}
