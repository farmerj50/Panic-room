import type { CrowdMetrics, MonitorFrame, TrackedPerson } from '../../models/types';

// Builds MonitorFrame sequences for unit tests and offline validation of the
// threat engine and detectors, without a camera.

export type SyntheticPerson = {
  id: number;
  x: number; // box left, normalized
  y: number; // box top, normalized
  width?: number;
  height?: number;
  vx?: number; // frame widths / second
  vy?: number;
  confidence?: number;
  suddenChange?: boolean;
};

export function syntheticFrame(
  timestamp: number,
  people: SyntheticPerson[],
  options: { motionReliable?: boolean; sessionId?: string } = {},
): MonitorFrame {
  const detections: TrackedPerson[] = people.map((p) => {
    const vx = p.vx ?? 0;
    const vy = p.vy ?? 0;
    const speed = Math.hypot(vx, vy);
    return {
      trackId: p.id,
      class: 'person',
      confidence: p.confidence ?? 0.8,
      boundingBox: { x: p.x, y: p.y, width: p.width ?? 0.1, height: p.height ?? 0.3 },
      motion: { direction: speed < 0.05 ? 'still' : 'right', speed, suddenChange: p.suddenChange ?? false, vx, vy },
    };
  });
  const motionReliable = options.motionReliable ?? true;
  const crowdMetrics: CrowdMetrics = {
    visiblePeople: detections.length,
    estimatedVisualDensity: detections.length >= 8 ? 'high' : detections.length >= 4 ? 'medium' : 'low',
    rapidMovementCount: detections.filter((d) => d.motion.speed > 0.6 || d.motion.suddenChange).length,
    averageSpeed: detections.length ? detections.reduce((s, d) => s + d.motion.speed, 0) / detections.length : 0,
    cameraMoving: !motionReliable,
    motionReliable,
  };
  return {
    timestamp,
    sessionId: options.sessionId ?? 'synthetic',
    peopleCount: detections.length,
    detections,
    crowdMetrics,
    inferenceMs: 40,
  };
}

// A sequence at a fixed analysis rate; `peopleAt(t)` gives the scene at time t (seconds).
export function syntheticSequence(
  durationSec: number,
  fps: number,
  peopleAt: (tSec: number, frameIndex: number) => SyntheticPerson[],
  options: { motionReliableAt?: (tSec: number) => boolean; startMs?: number } = {},
): MonitorFrame[] {
  const frames: MonitorFrame[] = [];
  const start = options.startMs ?? 1_000_000;
  const count = Math.round(durationSec * fps);
  for (let i = 0; i < count; i += 1) {
    const t = i / fps;
    frames.push(syntheticFrame(start + Math.round(t * 1000), peopleAt(t, i), { motionReliable: options.motionReliableAt?.(t) ?? true }));
  }
  return frames;
}
