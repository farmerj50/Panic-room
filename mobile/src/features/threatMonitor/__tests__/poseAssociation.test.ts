import type { TrackedPerson } from '../models/types';
import { PoseCarry, attachPoses, poseBounds, toPose } from '../threat/pose/poseAssociation';
import { actions, poseBox, skeleton } from '../threat/validation/syntheticPoses';

function person(trackId: number, hipX: number): { tracked: TrackedPerson; native: { score: number; keypoints: Array<[number, number, number]> } } {
  const pose = skeleton(actions.stand(hipX)(0));
  const box = poseBox(pose);
  return {
    tracked: {
      trackId,
      class: 'person',
      confidence: 0.9,
      boundingBox: box,
      motion: { direction: 'still', speed: 0, suddenChange: false },
    },
    native: { score: pose.score, keypoints: pose.keypoints.map((k) => [k.x, k.y, k.score] as [number, number, number]) },
  };
}

describe('pose association', () => {
  it('attaches each pose to the person it belongs to, regardless of order', () => {
    const a = person(1, 0.25);
    const b = person(2, 0.7);
    const out = attachPoses([a.tracked, b.tracked], [toPose(b.native), toPose(a.native)]);
    expect(poseBounds(out[0].pose!)!.x).toBeLessThan(0.4);
    expect(poseBounds(out[1].pose!)!.x).toBeGreaterThan(0.5);
  });

  it('drops a pose that matches nobody instead of guessing', () => {
    const a = person(1, 0.25);
    const stray = person(9, 0.85).native;
    const out = attachPoses([a.tracked], [toPose(stray)]);
    expect(out[0].pose).toBeUndefined();
  });

  it('ignores poses with too few confident keypoints', () => {
    const a = person(1, 0.3);
    const weak = { ...a.native, keypoints: a.native.keypoints.map(([x, y]) => [x, y, 0.1] as [number, number, number]) };
    expect(attachPoses([a.tracked], [toPose(weak)])[0].pose).toBeUndefined();
  });

  it('carries a pose briefly across frames where pose did not run, then lets it expire', () => {
    const a = person(1, 0.3);
    const carry = new PoseCarry(400);
    const withPose = attachPoses([a.tracked], [toPose(a.native)]);
    carry.apply(withPose, 1000, true);
    expect(carry.apply([a.tracked], 1200, false)[0].pose).toBeDefined(); // skipped frame
    expect(carry.apply([a.tracked], 1300, true)[0].pose).toBeUndefined(); // pose ran and missed them
    expect(carry.apply([a.tracked], 2000, false)[0].pose).toBeUndefined(); // too old
  });
});
