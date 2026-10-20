import type { BoundingBox, Pose, TrackedPerson } from '../../models/types';
import { assignMaxAffinity } from '../../services/assignment';
import { iou } from '../../services/PersonTrackingService';
import { MIN_KEYPOINT_SCORE } from './skeleton';

// Native poses arrive unmatched; attach each to the tracked person whose box
// it overlaps best. Poses that match nobody are dropped (never guessed).

export type NativePoseLike = { score: number; keypoints: Array<[number, number, number]> };

export function toPose(native: NativePoseLike): Pose {
  return { score: native.score, keypoints: native.keypoints.map(([x, y, score]) => ({ x, y, score })) };
}

export function poseBounds(pose: Pose): BoundingBox | null {
  const pts = pose.keypoints.filter((k) => k.score >= MIN_KEYPOINT_SCORE);
  if (pts.length < 4) return null;
  const xs = pts.map((k) => k.x);
  const ys = pts.map((k) => k.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// Overlap of the pose's joints with a person box: the share of the pose box
// inside the person box, which tolerates the pose box being tighter.
function containment(pose: BoundingBox, box: BoundingBox): number {
  const x1 = Math.max(pose.x, box.x);
  const y1 = Math.max(pose.y, box.y);
  const x2 = Math.min(pose.x + pose.width, box.x + box.width);
  const y2 = Math.min(pose.y + pose.height, box.y + box.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = pose.width * pose.height;
  return area > 0 ? inter / area : 0;
}

export function attachPoses(people: TrackedPerson[], poses: Pose[], minAffinity = 0.3): TrackedPerson[] {
  if (!poses.length || !people.length) return people;
  const bounds = poses.map(poseBounds);
  const affinity = people.map((p) =>
    bounds.map((b) => (b ? 0.6 * containment(b, p.boundingBox) + 0.4 * iou(b, p.boundingBox) : 0)),
  );
  const pairs = assignMaxAffinity(affinity, minAffinity);
  const out = people.map((p) => ({ ...p }));
  for (const [personIdx, poseIdx] of pairs) out[personIdx].pose = poses[poseIdx];
  return out;
}

// Pose runs on every other frame: keep each person's latest pose briefly so
// detectors see a continuous sequence.
export class PoseCarry {
  private last = new Map<number, { pose: Pose; at: number }>();
  constructor(private readonly maxAgeMs = 400) {}

  reset() {
    this.last.clear();
  }

  apply(people: TrackedPerson[], timestamp: number, poseRan: boolean): TrackedPerson[] {
    const out = people.map((p) => {
      if (p.pose) {
        this.last.set(p.trackId, { pose: p.pose, at: timestamp });
        return p;
      }
      const prev = this.last.get(p.trackId);
      if (!poseRan && prev && timestamp - prev.at <= this.maxAgeMs) return { ...p, pose: prev.pose };
      return p;
    });
    for (const [id, v] of this.last) if (timestamp - v.at > this.maxAgeMs * 4) this.last.delete(id);
    return out;
  }
}
