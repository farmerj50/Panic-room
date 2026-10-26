import type { MonitorFrame } from '../models/types';
import { BehaviorEventEngine, BEHAVIOR_CONFIG, interactionEvidence, struggleEvidence, type BehaviorEvent, type BehaviorKind } from '../services/BehaviorEventEngine';
import { observePairs, type PairObservation } from '../services/PersonInteractionService';
import { POSE_SCENARIOS, SPLITS } from '../threat/validation/scenarios';
import { syntheticSequence, type SyntheticPerson } from '../threat/validation/syntheticFrames';
import { actions, actor } from '../threat/validation/syntheticPoses';

// Deterministic synthetic sequences: these prove the logic, not real-world accuracy.

const FPS = 8;
const H = 0.1; // small, distant people: 1 frame width/s ≈ 7.5 body heights/s
const box = (id: number, x: number, extra: Partial<SyntheticPerson> = {}): SyntheticPerson => ({ id, x, y: 0.4, width: 0.04, height: H, ...extra });

type Run = { snaps: ReturnType<BehaviorEventEngine['update']>[]; alerts: BehaviorEvent[] };
function run(frames: MonitorFrame[], engine = new BehaviorEventEngine()): Run {
  const snaps = frames.map((f) => engine.update(f));
  return { snaps, alerts: snaps.map((s) => s.alert).filter((a): a is BehaviorEvent => a != null) };
}
const everStatus = (r: Run, kind: BehaviorKind) => new Set(r.snaps.flatMap((s) => s.events.filter((e) => e.kind === kind).map((e) => e.status)));
const anyActive = (r: Run) => r.snaps.some((s) => s.events.some((e) => e.status === 'active'));
const last = (r: Run, kind: BehaviorKind) => [...r.snaps].reverse().flatMap((s) => s.events).find((e) => e.kind === kind);
const withRotation = (frames: MonitorFrame[], rad: number) => frames.map((f) => ({ ...f, crowdMetrics: { ...f.crowdMetrics, deviceRotationRate: rad } }));

// #1 runs after #2 (both moving right), closing the gap.
const chase = (followerSpeed = 0.16, opts: { motionReliable?: boolean; confidence?: number; hideFollowerEvery?: number } = {}) =>
  syntheticSequence(
    3,
    FPS,
    (t, i) => [
      ...(opts.hideFollowerEvery && i % opts.hideFollowerEvery === 0 ? [] : [box(1, 0.03 + followerSpeed * t, { vx: followerSpeed, confidence: opts.confidence })]),
      box(2, 0.5 + 0.1 * t, { vx: 0.1, confidence: opts.confidence }),
    ],
    { motionReliableAt: () => opts.motionReliable ?? true },
  );

describe('pursuit-like movement', () => {
  it('raises an active event when one person closes on another moving the same way', () => {
    const r = run(chase());
    expect(everStatus(r, 'PURSUIT_LIKE_MOVEMENT').has('active')).toBe(true);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].trackIds).toEqual([1, 2]);
  });

  it('nothing for two people walking the same way at the same pace', () => {
    expect(anyActive(run(syntheticSequence(3, FPS, (t) => [box(1, 0.1 + 0.12 * t), box(2, 0.4 + 0.12 * t)])))).toBe(false);
  });

  it('nothing for people crossing paths', () => {
    const r = run(syntheticSequence(3, FPS, (t) => [box(1, 0.1 + 0.2 * t), box(2, 0.8 - 0.2 * t, { y: 0.45 })]));
    expect(r.snaps.some((s) => s.events.length)).toBe(false);
  });

  it('nothing for two people walking toward each other to meet', () => {
    const r = run(syntheticSequence(3, FPS, (t) => [box(1, Math.min(0.1 + 0.08 * t, 0.33)), box(2, Math.max(0.7 - 0.08 * t, 0.45))]));
    expect(anyActive(r)).toBe(false);
  });

  it('nothing for one person running alone, or two running together', () => {
    expect(run(syntheticSequence(3, FPS, (t) => [box(1, 0.05 + 0.25 * t)])).snaps.every((s) => s.events.length === 0)).toBe(true);
    expect(anyActive(run(syntheticSequence(3, FPS, (t) => [box(1, 0.05 + 0.25 * t), box(2, 0.12 + 0.25 * t, { y: 0.45 })])))).toBe(false);
  });
});

describe('rapid approach (one person runs at another)', () => {
  // #1 waits, sprints at #2 (2+ body heights/s) and stops within reach.
  const sprintTo = () => syntheticSequence(3, FPS, (t) => [box(1, t < 1.2 ? 0.1 : Math.min(0.1 + 0.4 * (t - 1.2), 0.5)), box(2, 0.6)]);

  it('keeps a provisional, uncertain observation without body pose — never active, never alerted', () => {
    const r = run(sprintTo());
    const e = last(r, 'UNUSUAL_PHYSICAL_INTERACTION');
    expect(e?.status).toBe('uncertain');
    expect(e?.uncertainty.join(' ')).toMatch(/Body pose unavailable/);
    expect(anyActive(r)).toBe(false);
    expect(r.alerts).toHaveLength(0);
  });

  it('becomes confirmable only with positive arm evidence', () => {
    const base: PairObservation = {
      key: '1-2',
      trackIds: [1, 2],
      separation: 0.5,
      closingRate: 0.2,
      approach: { closing: 1.6, approacher: 1, approacherSpeed: 2 },
      speeds: [0.2, 0],
      headingCos: null,
      follower: null,
      withinReachMs: 600,
      suddenChanges: 0,
      armActions: { strikes: 0, shoves: 0, strikeTimes: [], shoveTimes: [] },
      quality: { phone: 'steady', poseAvailable: true, factor: 1, insufficient: false, reasons: [] },
    };
    expect(interactionEvidence(base)).toBeNull(); // bodies seen, nobody reached at the other
    expect(interactionEvidence({ ...base, armActions: { strikes: 0, shoves: 1, strikeTimes: [], shoveTimes: [1] } })?.confirmable).toBe(true);
    expect(interactionEvidence({ ...base, armActions: null })?.confirmable).toBe(false);
    expect(struggleEvidence({ ...base, withinReachMs: 2000, armActions: null, suddenChanges: 3 })?.confirmable).toBe(false);
    expect(struggleEvidence({ ...base, withinReachMs: 2000, armActions: { strikes: 2, shoves: 0, strikeTimes: [1, 2], shoveTimes: [] } })?.confirmable).toBe(true);
  });
});

describe('close contact and look-alikes (pose scenarios)', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => SPLITS.evaluation.from + i);
  const scenario = (id: string) => POSE_SCENARIOS.find((s) => s.id === id)!;
  const activeRate = (id: string, kinds?: BehaviorKind[]) =>
    seeds.filter((seed) => run(scenario(id).build(seed)).snaps.some((s) => s.events.some((e) => e.status === 'active' && (!kinds || kinds.includes(e.kind))))).length / seeds.length;

  it.each(['hug', 'handshake', 'high-five', 'dance-pair-close', 'standing-chat', 'walk-past-each-other', 'run-past', 'point-and-talk', 'stretch-near-friend', 'wave-hello'])('no active event for %s', (id) => {
    expect(activeRate(id)).toBe(0);
  });

  it('sudden arm movement: nothing alone, nothing with the other person out of reach', () => {
    const alone = syntheticSequence(5, FPS, (t) => [actor(1, actions.punching(0.4, 1), FPS)(t)]);
    expect(run(alone).snaps.every((s) => s.events.length === 0)).toBe(true);
    const far = syntheticSequence(5, FPS, (t) => [actor(1, actions.punching(0.25, 1), FPS)(t), actor(2, actions.stand(0.75, -1), FPS)(t)]);
    expect(anyActive(run(far))).toBe(false);
  });

  it('repeated strikes, or a shove that pushes the other person back, raise a possible struggle', () => {
    // Synthetic detection rate (20 seeds): misses remain — see BEHAVIOR_EVENTS.md.
    expect(activeRate('mutual-fight', ['POSSIBLE_STRUGGLE'])).toBeGreaterThanOrEqual(0.5);
    expect(activeRate('one-sided-attack', ['POSSIBLE_STRUGGLE'])).toBeGreaterThanOrEqual(0.5);
    expect(activeRate('shove-attack', ['POSSIBLE_STRUGGLE'])).toBeGreaterThanOrEqual(0.6);
  });

  it.each(['play-fight', 'pad-training'])('no active event for %s (known real-world false-positive risk)', (id) => {
    expect(activeRate(id)).toBe(0);
  });
});

describe('input quality: degrade, abstain only when evidence is insufficient', () => {
  it('phone moving: a strong chase is still detected, at lower confidence', () => {
    const steady = last(run(chase(0.2)), 'PURSUIT_LIKE_MOVEMENT')!;
    const moving = last(run(chase(0.2, { motionReliable: false })), 'PURSUIT_LIKE_MOVEMENT')!;
    expect(moving.status).toBe('active');
    expect(moving.confidence).toBeLessThan(steady.confidence);
    expect(moving.uncertainty.join(' ')).toMatch(/Phone moving/);
  });

  it('phone moving: a weaker chase stays uncertain instead of disappearing', () => {
    const r = run(chase(0.16, { motionReliable: false }));
    expect(everStatus(r, 'PURSUIT_LIKE_MOVEMENT').has('uncertain')).toBe(true);
    expect(r.alerts).toHaveLength(0);
  });

  it('phone moving during a close struggle: still raised, with lower confidence', () => {
    const fight = POSE_SCENARIOS.find((s) => s.id === 'mutual-fight')!;
    const seeds = Array.from({ length: 8 }, (_, i) => SPLITS.evaluation.from + i);
    const best = (moving: boolean) =>
      Math.max(
        0,
        ...seeds.flatMap((seed) => {
          const frames = fight.build(seed).map((f) => (moving ? { ...f, crowdMetrics: { ...f.crowdMetrics, motionReliable: false, deviceRotationRate: 0.3 } } : f));
          return run(frames).snaps.flatMap((s) => s.events.filter((e) => e.kind === 'POSSIBLE_STRUGGLE').map((e) => e.confidence));
        }),
      );
    expect(best(true)).toBeGreaterThanOrEqual(BEHAVIOR_CONFIG.activeConfidence);
    expect(best(true)).toBeLessThan(best(false));
  });

  it('severe phone motion: abstains with a reason (not "all clear")', () => {
    const r = run(withRotation(chase(0.2), 0.8));
    expect(r.snaps.every((s) => s.events.length === 0)).toBe(true);
    expect(r.snaps[r.snaps.length - 1].abstaining).toBe('Phone moving too much');
  });

  it('low detection confidence and partial occlusion lower confidence and are named', () => {
    const low = last(run(chase(0.16, { confidence: 0.3 })), 'PURSUIT_LIKE_MOVEMENT')!;
    expect(low.uncertainty).toContain('Low detection confidence');
    expect(low.status).not.toBe('active');
    const hidden = last(run(chase(0.16, { hideFollowerEvery: 2 })), 'PURSUIT_LIKE_MOVEMENT');
    if (hidden) expect(hidden.uncertainty).toContain('People partly hidden');
  });

  it('a person who only just appeared is not judged yet', () => {
    const frames = chase(0.2).slice(0, 6); // < 1 s of history
    const { pairs } = observePairs(frames);
    expect(pairs[0].quality.insufficient).toBe(true);
    expect(run(frames).snaps.every((s) => s.events.length === 0)).toBe(true);
  });

  it('tracking ID switch: history is dropped, nothing carries over', () => {
    // At 1.5 s the tracker swaps the two IDs.
    const frames = syntheticSequence(3, FPS, (t) => {
      const f = box(1, 0.03 + 0.2 * t, { vx: 0.2 });
      const l = box(2, 0.5 + 0.1 * t, { vx: 0.1 });
      return t < 1.5 ? [f, l] : [{ ...f, id: 2 }, { ...l, id: 1 }];
    });
    const swapAt = frames.findIndex((f) => f.timestamp - frames[0].timestamp >= 1500);
    const r = run(frames);
    const { pairs } = observePairs(frames.slice(0, swapAt + 1));
    expect(pairs[0].quality.reasons).toContain('Tracking was interrupted');
    // No active pursuit can come from the mixed history right after the swap.
    expect(r.snaps.slice(swapAt, swapAt + 8).some((s) => s.events.some((e) => e.status === 'active'))).toBe(false);
  });
});

describe('lifecycle, debounce and cooldown', () => {
  it('emerging → active, one alert for a continuing event, then ended', () => {
    const engine = new BehaviorEventEngine();
    const first = run(chase(0.2), engine);
    const statuses = first.snaps.flatMap((s) => s.events.map((e) => e.status));
    expect(statuses.indexOf('emerging')).toBeLessThan(statuses.indexOf('active'));
    expect(first.alerts).toHaveLength(1);
    const lastT = first.snaps.length ? chase(0.2)[chase(0.2).length - 1].timestamp : 0;
    const empty = syntheticSequence(2, FPS, () => [], { startMs: lastT + 125 });
    const after = run(empty, engine);
    expect(after.snaps[after.snaps.length - 1].recentlyEnded.map((e) => e.status)).toContain('ended');
  });

  it('the same pair returning within the cooldown merges into the same event, without a second alert', () => {
    const engine = new BehaviorEventEngine();
    const a = run(chase(0.2), engine);
    const id = a.alerts[0].id;
    const endA = chase(0.2)[chase(0.2).length - 1].timestamp;
    run(syntheticSequence(2, FPS, () => [], { startMs: endA + 125 }), engine);
    const again = syntheticSequence(3, FPS, (t) => [box(1, 0.03 + 0.2 * t, { vx: 0.2 }), box(2, 0.5 + 0.1 * t, { vx: 0.1 })], { startMs: endA + 2200 });
    const b = run(again, engine);
    expect(b.alerts).toHaveLength(0);
    const e = last(b, 'PURSUIT_LIKE_MOVEMENT')!;
    expect(e.id).toBe(id);
    expect(e.recurrences).toBe(1);
  });

  it('reset (camera flip / session end) forgets everything', () => {
    const engine = new BehaviorEventEngine();
    run(chase(0.2), engine);
    engine.reset();
    const snap = engine.update(chase(0.2)[0]);
    expect(snap.events).toHaveLength(0);
    expect(snap.recentlyEnded).toHaveLength(0);
  });
});
