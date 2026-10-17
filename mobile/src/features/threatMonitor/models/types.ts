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
};

export type TrackedPerson = {
  trackId: number;
  class: 'person';
  confidence: number;
  boundingBox: BoundingBox;
  motion: TrackMotion;
};

export type DensityLevel = 'low' | 'medium' | 'high';

export type CrowdMetrics = {
  visiblePeople: number;
  estimatedVisualDensity: DensityLevel; // a visual estimate, never people per m²
  rapidMovementCount: number;
  averageSpeed: number;
  cameraMoving: boolean;
  motionReliable: boolean; // false while the phone itself is moving
};

export type MonitorFrame = {
  timestamp: number;
  sessionId: string;
  peopleCount: number;
  detections: TrackedPerson[];
  crowdMetrics: CrowdMetrics;
  inferenceMs: number;
};
