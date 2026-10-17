import type { CrowdMetrics, DensityLevel, TrackedPerson } from '../models/types';

export const CROWD_CONFIG = {
  // Phone rotation (gyroscope, rad/s) above which image motion is mostly the
  // camera moving, not people.
  cameraRotationRadPerSec: 0.35,
  rapidSpeed: 0.6, // frame widths / second
  // Fallback when there's no gyroscope reading: most people moving the same
  // way at the same speed looks like the camera panning.
  commonMotionMinTracks: 3,
  commonMotionShare: 0.8,
  commonMotionAngleDeg: 30,
  commonMotionSpeedSpread: 0.3,
};

const median = (values: number[]) => {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const centerOf = (p: TrackedPerson) => ({
  x: p.boundingBox.x + p.boundingBox.width / 2,
  y: p.boundingBox.y + p.boundingBox.height / 2,
});

// How close people stand, in body heights. Using box height as the unit is a
// rough perspective correction: distant people are small, so their spacing
// is judged against their own size.
export function medianNeighbourSpacing(people: TrackedPerson[]): number {
  if (people.length < 2) return Infinity;
  const spacings = people.map((p, i) => {
    const c = centerOf(p);
    let best = Infinity;
    people.forEach((q, j) => {
      if (i === j) return;
      const d = Math.hypot(c.x - centerOf(q).x, c.y - centerOf(q).y);
      const unit = (p.boundingBox.height + q.boundingBox.height) / 2 || 1;
      best = Math.min(best, d / unit);
    });
    return best;
  });
  return median(spacings);
}

export function estimateVisualDensity(people: TrackedPerson[]): DensityLevel {
  const n = people.length;
  if (n < 3) return 'low';
  const occupied = Math.min(
    1,
    people.reduce((sum, p) => sum + p.boundingBox.width * p.boundingBox.height, 0),
  );
  const spacing = medianNeighbourSpacing(people);
  if ((n >= 8 && spacing < 0.8) || occupied > 0.45) return 'high';
  if ((n >= 4 && spacing < 1.2) || occupied > 0.2) return 'medium';
  return 'low';
}

// Everyone moving the same way at the same speed is more likely the phone
// panning than the crowd. Only used when the gyroscope gives no answer.
export function looksLikeCameraPan(people: TrackedPerson[]): boolean {
  const moving = people.filter((p) => p.motion.direction !== 'still');
  if (moving.length < CROWD_CONFIG.commonMotionMinTracks) return false;
  const angles = moving.map((p) => directionAngle(p.motion.direction));
  const speeds = moving.map((p) => p.motion.speed);
  const refAngle = median(angles);
  const refSpeed = median(speeds);
  const agreeing = moving.filter((p, i) => {
    const diff = Math.abs(((angles[i] - refAngle + 540) % 360) - 180);
    return diff <= CROWD_CONFIG.commonMotionAngleDeg && Math.abs(p.motion.speed - refSpeed) <= refSpeed * CROWD_CONFIG.commonMotionSpeedSpread;
  });
  return agreeing.length / people.length >= CROWD_CONFIG.commonMotionShare;
}

function directionAngle(direction: TrackedPerson['motion']['direction']): number {
  const order = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  return Math.max(0, order.indexOf(direction)) * 45;
}

// Phase 1 measurements only — nothing here is a threat judgment.
export function computeCrowdMetrics(
  people: TrackedPerson[],
  options: { deviceRotationRate?: number | null } = {},
): CrowdMetrics {
  const rotation = options.deviceRotationRate;
  const cameraMoving =
    rotation != null ? rotation > CROWD_CONFIG.cameraRotationRadPerSec : looksLikeCameraPan(people);
  const speeds = people.map((p) => p.motion.speed);
  return {
    visiblePeople: people.length,
    estimatedVisualDensity: estimateVisualDensity(people),
    rapidMovementCount: people.filter((p) => p.motion.speed > CROWD_CONFIG.rapidSpeed || p.motion.suddenChange).length,
    averageSpeed: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
    cameraMoving,
    motionReliable: !cameraMoving,
  };
}
