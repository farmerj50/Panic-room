// Shared AI Monitor data contracts. Coordinates are normalized (0..1) to the
// upright camera frame; speeds are image-space (frame widths per second),
// not real-world speed. Track IDs are temporary and session-scoped — there is
// no face, identity or demographic data anywhere in this pipeline.

export type BoundingBox = { x: number; y: number; width: number; height: number };

export type Detection = BoundingBox & { score: number };

export type Direction = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left' | 'still';

export type TrackMotion = {
  direction: Direction;
  speed: number; // smoothed, frame widths per second
  suddenChange: boolean;
  // Smoothed velocity in frame widths per second (+x right, +y down).
  vx?: number;
  vy?: number;
};

// 17 body keypoints in COCO order (nose, eyes, ears, shoulders, elbows,
// wrists, hips, knees, ankles), normalized to the upright frame. Body pose
// only — no face landmarks, no identity.
export type Keypoint = { x: number; y: number; score: number };
export type Pose = { score: number; keypoints: Keypoint[] };

export type TrackedPerson = {
  trackId: number;
  class: 'person';
  confidence: number;
  boundingBox: BoundingBox;
  motion: TrackMotion;
  pose?: Pose;
};

export type DensityLevel = 'low' | 'medium' | 'high';

export type CrowdMetrics = {
  visiblePeople: number;
  estimatedVisualDensity: DensityLevel; // a visual estimate, never people per m²
  rapidMovementCount: number;
  averageSpeed: number;
  cameraMoving: boolean;
  motionReliable: boolean; // false while the phone itself is moving
  // Gyroscope reading behind that call (rad/s), when the phone has one.
  // Crowd threat detectors apply a stricter limit than motionReliable.
  deviceRotationRate?: number;
};

export type MonitorFrame = {
  timestamp: number;
  sessionId: string;
  peopleCount: number;
  detections: TrackedPerson[];
  crowdMetrics: CrowdMetrics;
  inferenceMs: number;
  // Frame height / width, so body-relative distances can be measured in one
  // unit (x is normalized to width, y to height). Defaults to 4/3 (portrait).
  frameAspect?: number;
};
