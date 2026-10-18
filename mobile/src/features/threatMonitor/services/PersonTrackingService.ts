import type { BoundingBox, Detection, Direction, TrackedPerson } from '../models/types';
import { assignMaxAffinity } from './assignment';

export const TRACKING_CONFIG = {
  // A track survives this long without a matching detection (occlusion,
  // someone walking behind another person, a missed frame).
  maxMissingMs: 1000,
  // Frames a new track must be seen before it gets an ID and is counted.
  confirmHits: 2,
  minAffinity: 0.1,
  // Centroid gate for fast movement / no overlap: centers closer than this
  // many box heights can still match.
  centroidGateHeights: 0.8,
  velocitySmoothing: 0.5,
  stillSpeed: 0.05, // frame widths / second
  suddenAcceleration: 1.5, // frame widths / second²
  // Prediction is capped so a long occlusion can't fling a box away.
  maxPredictMs: 500,
};

type Track = {
  id: number | null; // assigned on confirmation
  box: BoundingBox;
  score: number;
  vx: number; // normalized frame widths / second
  vy: number; // normalized frame heights / second
  speed: number;
  suddenChange: boolean;
  hits: number;
  lastSeen: number;
  seenThisFrame: boolean;
};

const center = (b: BoundingBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function clip(b: BoundingBox): BoundingBox {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  const right = Math.min(1, b.x + b.width);
  const bottom = Math.min(1, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function directionOf(vx: number, vyWidths: number, speed: number): Direction {
  if (speed < TRACKING_CONFIG.stillSpeed) return 'still';
  // Screen coordinates: +y is down.
  const angle = (Math.atan2(vyWidths, vx) * 180) / Math.PI; // -180..180, 0 = right
  const dirs: Direction[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const index = Math.round(((angle + 360) % 360) / 45) % 8;
  return dirs[index];
}

// IoU-plus-centroid multi-person tracker with constant-velocity prediction
// and optimal (Hungarian) matching. IDs are small integers, temporary and
// valid only within one monitoring session.
export class PersonTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  // frameAspect = frameHeight / frameWidth, to express vertical speed in
  // frame widths like horizontal speed.
  update(detections: Detection[], timestamp: number, frameAspect = 4 / 3): TrackedPerson[] {
    // Predict where each track should be now.
    const predicted = this.tracks.map((t) => {
      const ageSec = Math.min(timestamp - t.lastSeen, TRACKING_CONFIG.maxPredictMs) / 1000;
      return clip({ ...t.box, x: t.box.x + t.vx * ageSec, y: t.box.y + t.vy * ageSec });
    });

    const affinity = this.tracks.map((_, ti) => detections.map((d) => this.affinity(predicted[ti], clip(d))));
    const pairs = assignMaxAffinity(affinity, TRACKING_CONFIG.minAffinity);

    const matchedTracks = new Set<number>();
    const matchedDetections = new Set<number>();
    for (const t of this.tracks) t.seenThisFrame = false;

    for (const [ti, di] of pairs) {
      matchedTracks.add(ti);
      matchedDetections.add(di);
      this.applyMatch(this.tracks[ti], detections[di], timestamp, frameAspect);
    }

    // Drop tracks missing for too long.
    this.tracks = this.tracks.filter(
      (t, i) => matchedTracks.has(i) || timestamp - t.lastSeen <= TRACKING_CONFIG.maxMissingMs,
    );

    detections.forEach((d, di) => {
      if (matchedDetections.has(di)) return;
      this.tracks.push({
        id: null,
        box: clip(d),
        score: d.score,
        vx: 0,
        vy: 0,
        speed: 0,
        suddenChange: false,
        hits: 1,
        lastSeen: timestamp,
        seenThisFrame: true,
      });
    });

    return this.tracks
      .filter((t) => t.seenThisFrame && t.id != null)
      .map((t) => ({
        trackId: t.id as number,
        class: 'person' as const,
        confidence: t.score,
        boundingBox: t.box,
        motion: {
          direction: directionOf(t.vx, t.vy * frameAspect, t.speed),
          speed: t.speed,
          suddenChange: t.suddenChange,
          vx: t.vx,
          vy: t.vy * frameAspect,
        },
      }));
  }

  private affinity(a: BoundingBox, b: BoundingBox): number {
    const overlap = iou(a, b);
    if (overlap > 0.3) return overlap;
    // Fast movement or small boxes: fall back to how close the centers are,
    // relative to body size.
    const ca = center(a);
    const cb = center(b);
    const gate = TRACKING_CONFIG.centroidGateHeights * Math.max(a.height, b.height);
    const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    const closeness = gate > 0 ? Math.max(0, 1 - dist / gate) : 0;
    // Similar sizes make a centroid match more believable.
    const sizeRatio = Math.min(a.height, b.height) / (Math.max(a.height, b.height) || 1);
    return Math.max(overlap, 0.6 * closeness * sizeRatio);
  }

  private applyMatch(t: Track, d: Detection, timestamp: number, frameAspect: number) {
    const dt = (timestamp - t.lastSeen) / 1000;
    const box = clip(d);
    if (dt > 0) {
      const prev = center(t.box);
      const now = center(box);
      const a = TRACKING_CONFIG.velocitySmoothing;
      const rawVx = (now.x - prev.x) / dt;
      const rawVy = (now.y - prev.y) / dt;
      const vx = t.hits > 1 ? a * rawVx + (1 - a) * t.vx : rawVx;
      const vy = t.hits > 1 ? a * rawVy + (1 - a) * t.vy : rawVy;
      const speed = Math.hypot(vx, vy * frameAspect);
      const accel = Math.hypot(vx - t.vx, (vy - t.vy) * frameAspect) / dt;
      t.suddenChange = t.hits >= TRACKING_CONFIG.confirmHits && accel > TRACKING_CONFIG.suddenAcceleration;
      t.vx = vx;
      t.vy = vy;
      t.speed = speed;
    }
    t.box = box;
    t.score = d.score;
    t.hits += 1;
    t.lastSeen = timestamp;
    t.seenThisFrame = true;
    if (t.id == null && t.hits >= TRACKING_CONFIG.confirmHits) {
      t.id = this.nextId;
      this.nextId += 1;
    }
  }
}
