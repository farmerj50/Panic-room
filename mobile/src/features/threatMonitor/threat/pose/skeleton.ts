import type { Keypoint, Pose } from '../../models/types';

// COCO keypoint order used by MoveNet.
export const KP = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

export const MIN_KEYPOINT_SCORE = 0.3;

export type Point = { x: number; y: number };

export const visible = (k: Keypoint | undefined, min = MIN_KEYPOINT_SCORE): k is Keypoint => Boolean(k && k.score >= min);

export function midpoint(pose: Pose, a: number, b: number): Point | null {
  const ka = pose.keypoints[a];
  const kb = pose.keypoints[b];
  if (visible(ka) && visible(kb)) return { x: (ka.x + kb.x) / 2, y: (ka.y + kb.y) / 2 };
  if (visible(ka)) return ka;
  if (visible(kb)) return kb;
  return null;
}

export const shoulderMid = (p: Pose) => midpoint(p, KP.leftShoulder, KP.rightShoulder);
export const hipMid = (p: Pose) => midpoint(p, KP.leftHip, KP.rightHip);
export const ankleMid = (p: Pose) => midpoint(p, KP.leftAnkle, KP.rightAnkle);

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// Torso tilt from vertical in degrees: 0 upright, 90 lying flat.
export function torsoAngle(p: Pose): number | null {
  const s = shoulderMid(p);
  const h = hipMid(p);
  if (!s || !h) return null;
  const dx = s.x - h.x;
  const dy = h.y - s.y; // up is positive
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

export function torsoLength(p: Pose): number | null {
  const s = shoulderMid(p);
  const h = hipMid(p);
  return s && h ? distance(s, h) : null;
}

// Share of the 17 keypoints the model is reasonably sure about.
export const poseQuality = (p: Pose) => p.keypoints.filter((k) => visible(k)).length / 17;
