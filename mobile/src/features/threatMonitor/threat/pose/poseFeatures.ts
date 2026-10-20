import type { BoundingBox, MonitorFrame, Pose } from '../../models/types';
import { KP, hipMid, poseQuality, shoulderMid, torsoAngle, torsoLength, visible, type Point } from './skeleton';

// Body-relative measurements over a person's recent poses. Distances are in
// "frame height" units (x converted with the frame aspect) so they mean the
// same thing in every direction, and are usually divided by the person's
// torso length so near and far people are measured alike.

export type PoseSample = { t: number; pose: Pose; box: BoundingBox; aspect: number };

export function poseHistory(window: readonly MonitorFrame[], trackId: number, sinceMs = Infinity): PoseSample[] {
  const last = window.length ? window[window.length - 1].timestamp : 0;
  const out: PoseSample[] = [];
  for (const f of window) {
    if (last - f.timestamp > sinceMs) continue;
    const d = f.detections.find((p) => p.trackId === trackId);
    if (d?.pose && poseQuality(d.pose) >= 0.5) out.push({ t: f.timestamp, pose: d.pose, box: d.boundingBox, aspect: f.frameAspect ?? 4 / 3 });
  }
  return out;
}

// Point in uniform units (frame heights).
export const uni = (p: Point, aspect: number): Point => ({ x: p.x / aspect, y: p.y });

export function typicalTorso(samples: PoseSample[]): number | null {
  const lengths = samples
    .map((s) => {
      const sm = shoulderMid(s.pose);
      const hm = hipMid(s.pose);
      return sm && hm ? Math.hypot((sm.x - hm.x) / s.aspect, sm.y - hm.y) : null;
    })
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  if (!lengths.length) return null;
  // Upper quartile: a person bending or falling shows a foreshortened torso.
  return lengths[Math.floor(lengths.length * 0.75)];
}

export function torsoCenter(s: PoseSample): Point | null {
  const sm = shoulderMid(s.pose);
  const hm = hipMid(s.pose);
  if (!sm || !hm) return null;
  return uni({ x: (sm.x + hm.x) / 2, y: (sm.y + hm.y) / 2 }, s.aspect);
}

// Head/upper-torso target for strikes: between the head and the chest.
export function strikeTarget(s: PoseSample): Point | null {
  const sm = shoulderMid(s.pose);
  const nose = s.pose.keypoints[KP.nose];
  if (sm && visible(nose)) return uni({ x: (sm.x + nose.x) / 2, y: (sm.y + nose.y) / 2 }, s.aspect);
  return torsoCenter(s);
}

export function wrists(s: PoseSample): Point[] {
  return [KP.leftWrist, KP.rightWrist]
    .map((i) => s.pose.keypoints[i])
    .filter((k) => visible(k))
    .map((k) => uni(k, s.aspect));
}

export { torsoAngle, torsoLength, hipMid };
