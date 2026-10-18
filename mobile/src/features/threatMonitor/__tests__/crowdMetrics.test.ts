import type { Direction, TrackedPerson } from '../models/types';
import {
  computeCrowdMetrics,
  estimateVisualDensity,
  looksLikeCameraPan,
  medianNeighbourSpacing,
} from '../services/CrowdMetricsService';

let nextId = 1;
const person = (
  x: number,
  y: number,
  { w = 0.08, h = 0.25, direction = 'still' as Direction, speed = 0, suddenChange = false } = {},
): TrackedPerson => ({
  trackId: nextId++,
  class: 'person',
  confidence: 0.9,
  boundingBox: { x, y, width: w, height: h },
  motion: { direction, speed, suddenChange },
});

const grid = (n: number, spacingX: number, opts = {}) =>
  Array.from({ length: n }, (_, i) => person(0.02 + (i % 6) * spacingX, 0.2 + Math.floor(i / 6) * 0.3, opts));

describe('estimated visual density', () => {
  it('is low for a few spread-out people', () => {
    expect(estimateVisualDensity([person(0.1, 0.3), person(0.5, 0.3), person(0.85, 0.3)])).toBe('low');
    expect(estimateVisualDensity([person(0.1, 0.3)])).toBe('low');
  });

  it('is medium for a small close group', () => {
    expect(estimateVisualDensity(grid(4, 0.1))).toBe('medium');
  });

  it('is high for many tightly packed people', () => {
    expect(estimateVisualDensity(grid(12, 0.1))).toBe('high');
  });

  it('judges spacing relative to body size (distant small people)', () => {
    // Same pixel spacing, but tiny (far away) people are many body heights apart.
    const far = Array.from({ length: 4 }, (_, i) => person(0.1 + i * 0.1, 0.4, { w: 0.02, h: 0.06 }));
    const near = Array.from({ length: 4 }, (_, i) => person(0.1 + i * 0.1, 0.4, { w: 0.08, h: 0.3 }));
    expect(medianNeighbourSpacing(far)).toBeGreaterThan(medianNeighbourSpacing(near));
    expect(estimateVisualDensity(far)).toBe('low');
    expect(estimateVisualDensity(near)).toBe('medium');
  });
});

describe('crowd metrics', () => {
  it('counts rapid movement and sudden changes', () => {
    const people = [
      person(0.1, 0.3, { direction: 'right', speed: 0.9 }),
      person(0.5, 0.3, { direction: 'left', speed: 0.2, suddenChange: true }),
      person(0.8, 0.3),
    ];
    const m = computeCrowdMetrics(people, { deviceRotationRate: 0 });
    expect(m).toMatchObject({ visiblePeople: 3, rapidMovementCount: 2, cameraMoving: false, motionReliable: true });
    expect(m.averageSpeed).toBeCloseTo((0.9 + 0.2) / 3);
  });

  it('marks motion unreliable while the phone is rotating (gyroscope)', () => {
    const m = computeCrowdMetrics([person(0.1, 0.3, { direction: 'right', speed: 1 })], { deviceRotationRate: 1.2 });
    expect(m).toMatchObject({ cameraMoving: true, motionReliable: false });
  });

  it('without a gyroscope, treats everyone moving together as a camera pan', () => {
    const panning = grid(5, 0.15, { direction: 'left', speed: 0.5 });
    expect(looksLikeCameraPan(panning)).toBe(true);
    expect(computeCrowdMetrics(panning).motionReliable).toBe(false);
  });

  it('does not mistake people moving in different directions for a pan', () => {
    const scatter = [
      person(0.1, 0.3, { direction: 'left', speed: 0.8 }),
      person(0.3, 0.3, { direction: 'right', speed: 0.8 }),
      person(0.5, 0.3, { direction: 'up', speed: 0.8 }),
      person(0.7, 0.3, { direction: 'down', speed: 0.8 }),
    ];
    expect(looksLikeCameraPan(scatter)).toBe(false);
    expect(computeCrowdMetrics(scatter).rapidMovementCount).toBe(4);
  });

  it('prefers the gyroscope over the image heuristic when it says the phone is still', () => {
    const together = grid(5, 0.15, { direction: 'left', speed: 0.5 });
    expect(computeCrowdMetrics(together, { deviceRotationRate: 0.05 }).motionReliable).toBe(true);
  });

  it('reports zeros for an empty scene', () => {
    expect(computeCrowdMetrics([], { deviceRotationRate: 0 })).toEqual({
      visiblePeople: 0,
      estimatedVisualDensity: 'low',
      rapidMovementCount: 0,
      averageSpeed: 0,
      cameraMoving: false,
      motionReliable: true,
      deviceRotationRate: 0,
    });
  });
});
