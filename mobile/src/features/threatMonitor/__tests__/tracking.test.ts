import type { Detection } from '../models/types';
import { assignMaxAffinity } from '../services/assignment';
import { PersonTracker, directionOf } from '../services/PersonTrackingService';

const FRAME_MS = 125; // 8 analyzed frames per second
type GtBox = { gt: string; x: number; y: number; width?: number; height?: number; score?: number };

// Runs ground-truth boxes through the tracker and counts ID switches per
// person (a person's ID changing between two frames where they're tracked).
function run(frames: GtBox[][], tracker = new PersonTracker()) {
  const idsByGt: Record<string, number[]> = {};
  const counts: number[] = [];
  const lastId: Record<string, number> = {};
  let switches = 0;
  frames.forEach((boxes, f) => {
    const detections: Detection[] = boxes.map((b) => ({
      x: b.x,
      y: b.y,
      width: b.width ?? 0.1,
      height: b.height ?? 0.3,
      score: b.score ?? 0.8,
    }));
    const tracked = tracker.update(detections, f * FRAME_MS);
    counts.push(tracked.length);
    boxes.forEach((b) => {
      // The tracker reports each matched person's (clipped) input box.
      const match = tracked.find(
        (t) => Math.abs(t.boundingBox.x - Math.max(0, b.x)) < 1e-6 && Math.abs(t.boundingBox.y - b.y) < 1e-6,
      );
      if (!match) return;
      (idsByGt[b.gt] ??= []).push(match.trackId);
      if (lastId[b.gt] != null && lastId[b.gt] !== match.trackId) switches += 1;
      lastId[b.gt] = match.trackId;
    });
  });
  return { idsByGt, switches, counts };
}

const walk = (gt: string, n: number, x0: number, y0: number, vxPerFrame: number, vyPerFrame = 0): GtBox[] =>
  Array.from({ length: n }, (_, i) => ({ gt, x: x0 + vxPerFrame * i, y: y0 + vyPerFrame * i }));

const zip = (...people: GtBox[][]): GtBox[][] =>
  Array.from({ length: Math.max(...people.map((p) => p.length)) }, (_, i) =>
    people.map((p) => p[i]).filter(Boolean),
  );

describe('assignMaxAffinity', () => {
  it('finds the globally best pairing, not the greedy first match', () => {
    // Greedy would take (0,0)=0.9 and leave row 1 with 0.1; optimal is 0.8 + 0.85.
    const pairs = assignMaxAffinity(
      [
        [0.9, 0.8],
        [0.85, 0.1],
      ],
      0.05,
    );
    expect(pairs.sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('never pairs below the minimum affinity and handles unequal sizes', () => {
    expect(assignMaxAffinity([[0.05, 0.02]], 0.1)).toEqual([]);
    expect(assignMaxAffinity([[0.5], [0.7], [0.2]], 0.1)).toEqual([[1, 0]]);
    expect(assignMaxAffinity([], 0.1)).toEqual([]);
  });
});

describe('PersonTracker', () => {
  it('keeps one stable ID for a person walking across the frame', () => {
    const { idsByGt, switches } = run(zip(walk('a', 30, 0.05, 0.3, 0.02)));
    expect(switches).toBe(0);
    expect(new Set(idsByGt.a)).toEqual(new Set([1]));
  });

  it('only counts a new person after they are seen twice (no one-frame false positives)', () => {
    const { counts } = run([[{ gt: 'ghost', x: 0.5, y: 0.5 }], [], [], []]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it('keeps IDs when two people cross paths', () => {
    const a = walk('a', 24, 0.1, 0.35, 0.03);
    const b = walk('b', 24, 0.8, 0.4, -0.03);
    const { switches, idsByGt } = run(zip(a, b));
    expect(switches).toBe(0);
    expect(idsByGt.a[0]).not.toBe(idsByGt.b[0]);
  });

  it('keeps the ID of a person briefly hidden behind another (occlusion)', () => {
    const a = walk('a', 24, 0.45, 0.35, 0); // standing in the middle
    const b = walk('b', 24, 0.1, 0.36, 0.03); // walks behind a
    // b is not detected while behind a (frames 10-14, 625 ms).
    const frames = zip(a, b).map((boxes, i) => (i >= 10 && i <= 14 ? boxes.filter((x) => x.gt !== 'b') : boxes));
    const { switches, idsByGt } = run(frames);
    expect(switches).toBe(0);
    expect(new Set(idsByGt.b).size).toBe(1);
  });

  it('gives a new ID to someone gone longer than the grace period, never reusing IDs', () => {
    const frames: GtBox[][] = [
      ...walk('a', 4, 0.3, 0.3, 0).map((b) => [b]),
      ...Array.from({ length: 10 }, () => []), // 1.25 s gone
      ...walk('a2', 4, 0.3, 0.3, 0).map((b) => [b]),
    ];
    const { idsByGt } = run(frames);
    expect(idsByGt.a[0]).toBe(1);
    expect(idsByGt.a2[0]).toBe(2);
  });

  it('follows fast movement where boxes no longer overlap between frames', () => {
    // 0.12 frame widths per analyzed frame (~1 frame width per second) with 0.1-wide boxes.
    const { switches, idsByGt } = run(zip(walk('a', 8, 0.0, 0.3, 0.12)));
    expect(switches).toBe(0);
    expect(idsByGt.a.length).toBeGreaterThanOrEqual(7);
  });

  it('keeps the ID while a person walks partly out of the frame', () => {
    const { switches, idsByGt } = run(zip(walk('a', 10, 0.2, 0.3, -0.03)));
    expect(switches).toBe(0);
    expect(new Set(idsByGt.a).size).toBe(1);
  });

  it('keeps IDs while the camera pans (everyone shifts together)', () => {
    const people = ['a', 'b', 'c'].map((gt, i) => walk(gt, 20, 0.1 + i * 0.25, 0.3, 0.025));
    expect(run(zip(...people)).switches).toBe(0);
  });

  it('keeps IDs in a dense, jittery crowd', () => {
    let seed = 7;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    const people = Array.from({ length: 12 }, (_, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      return Array.from({ length: 24 }, (_, f) => ({
        gt: `p${i}`,
        x: 0.02 + col * 0.16 + f * 0.004 + jitter(),
        y: 0.2 + row * 0.35 + jitter(),
      }));
    });
    const { switches, counts } = run(zip(...people));
    expect(switches).toBe(0);
    expect(counts[counts.length - 1]).toBe(12);
  });

  it('resets IDs for a new session', () => {
    const tracker = new PersonTracker();
    run(zip(walk('a', 4, 0.3, 0.3, 0)), tracker);
    tracker.reset();
    expect(run(zip(walk('b', 4, 0.6, 0.3, 0)), tracker).idsByGt.b[0]).toBe(1);
  });

  it('reports direction, speed and sudden changes', () => {
    const tracker = new PersonTracker();
    const standing = walk('a', 6, 0.4, 0.3, 0);
    const sprint = Array.from({ length: 6 }, (_, i) => ({ gt: 'a', x: 0.4 + 0.08 * (i + 1), y: 0.3 }));
    const results = [...standing, ...sprint].map((b, f) =>
      tracker.update([{ x: b.x, y: b.y, width: 0.1, height: 0.3, score: 0.9 }], f * FRAME_MS),
    );
    expect(results[5][0].motion).toMatchObject({ direction: 'still', suddenChange: false });
    expect(results.slice(6, 8).some((r) => r[0].motion.suddenChange)).toBe(true);
    const last = results[results.length - 1][0].motion;
    expect(last.direction).toBe('right');
    expect(last.speed).toBeGreaterThan(0.4);
  });

  it('maps velocity to eight directions', () => {
    expect(directionOf(1, 0, 1)).toBe('right');
    expect(directionOf(-1, 0, 1)).toBe('left');
    expect(directionOf(0, -1, 1)).toBe('up');
    expect(directionOf(0, 1, 1)).toBe('down');
    expect(directionOf(1, 1, 1.4)).toBe('down-right');
    expect(directionOf(0.01, 0, 0.01)).toBe('still');
  });
});
