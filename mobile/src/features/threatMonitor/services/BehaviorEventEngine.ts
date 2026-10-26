import type { MonitorFrame } from '../models/types';
import { INTERACTION_CONFIG, observePairs, type PairObservation } from './PersonInteractionService';

// Behavioral event candidates between two people, built from sustained
// multi-frame pair observations. Candidates only — never a verdict, never a
// trigger for Emergency, contacts or calls.
//
// Status:
//   emerging  — evidence building, not yet sustained
//   uncertain — something is there, but the input (or a missing body pose)
//               doesn't allow confirming it; never alerted
//   active    — sustained positive evidence at sufficient confidence; the
//               only status that may raise a (opt-in) banner
//   ended     — no evidence for a while
//
// All thresholds are first guesses: UNVALIDATED on real footage.

export type BehaviorKind = 'PURSUIT_LIKE_MOVEMENT' | 'UNUSUAL_PHYSICAL_INTERACTION' | 'POSSIBLE_STRUGGLE';
export type BehaviorStatus = 'emerging' | 'active' | 'uncertain' | 'ended';

export type BehaviorEvent = {
  id: string;
  kind: BehaviorKind;
  trackIds: number[];
  status: BehaviorStatus;
  confidence: number;
  observations: string[];
  uncertainty: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  // Times this event came back within the cooldown and was merged into it.
  recurrences: number;
};

export type BehaviorSnapshot = {
  events: BehaviorEvent[]; // emerging, uncertain and active
  recentlyEnded: BehaviorEvent[];
  abstaining: string | null; // why nothing can be judged right now
  alert: BehaviorEvent | null; // an event that just became active and may be announced
};

export const BEHAVIOR_CONFIG = {
  frameWindowMs: INTERACTION_CONFIG.windowMs,
  maxFrames: 40,
  activeConfidence: 0.55,
  confirmEvaluations: 2,
  evidenceGapMs: 500, // a gap longer than this restarts "sustained"
  endAfterMs: 1500,
  cooldownMs: 20_000, // the same pair + kind returning within this merges into the same event
  alertGapMs: 15_000, // between any two banners
  pursuit: { minSpeed: 0.6, minHeadingCos: 0.8, minClosing: 0.25, maxSeparation: 6, sustainMs: 1500 },
  // The approacher has to stay near the other person (not just pass by).
  interaction: { minApproach: 0.8, minApproacherSpeed: 1.4, minReachMs: 400, sustainMs: 600 },
  // Arm actions toward each other are accumulated per pair over armMemoryMs.
  // Two strikes, or one shove that visibly pushed the other person back.
  struggle: { minReachMs: 1500, minStrikes: 2, minShoves: 1, armMemoryMs: 6000, minSuddenChanges: 2, sustainMs: 1500 },
};

type Evidence = { strength: number; confirmable: boolean; observations: string[]; missing: string[]; usesPose: boolean };

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function pursuitEvidence(p: PairObservation): Evidence | null {
  const C = BEHAVIOR_CONFIG.pursuit;
  const [va, vb] = p.speeds;
  if (va == null || vb == null || p.headingCos == null || p.closingRate == null || p.follower == null) return null;
  if (Math.min(va, vb) < C.minSpeed || p.headingCos < C.minHeadingCos || p.closingRate < C.minClosing || p.separation > C.maxSeparation) return null;
  const leader = p.trackIds.find((id) => id !== p.follower)!;
  return {
    strength: 0.5 + 0.5 * clamp((p.closingRate - C.minClosing) / 0.75),
    confirmable: true,
    usesPose: false,
    observations: [`#${p.follower} following #${leader} in the same direction`, `Gap closing (${p.closingRate.toFixed(2)} body lengths/s)`],
    missing: [],
  };
}

export function interactionEvidence(p: PairObservation): Evidence | null {
  const C = BEHAVIOR_CONFIG.interaction;
  const ap = p.approach;
  if (!ap || p.withinReachMs < C.minReachMs || ap.closing < C.minApproach || ap.approacherSpeed < C.minApproacherSpeed || p.separation > INTERACTION_CONFIG.reach) return null;
  const observations = [`#${ap.approacher} moved quickly toward the other person`, 'Now within reach of each other'];
  if (!p.armActions) {
    // Kept as a provisional observation: no body pose is not evidence that nothing happened.
    return { strength: 0.5, confirmable: false, usesPose: true, observations, missing: ['Body pose unavailable — can’t see arm movement'] };
  }
  const arm = p.armActions.strikes + p.armActions.shoves;
  if (arm === 0) return null; // the bodies were seen and no one reached at the other person
  return {
    strength: 0.55 + 0.2 * clamp((ap.closing - C.minApproach) / 0.8) + 0.25 * clamp(arm / 2),
    confirmable: true,
    usesPose: true,
    observations: [...observations, `Arm movement toward the other person (${arm}×)`],
    missing: [],
  };
}

export type ArmCounts = { strikes: number; shoves: number };

// `recent`: distinct arm actions toward each other over armMemoryMs (the engine accumulates them).
export function struggleEvidence(p: PairObservation, recent: ArmCounts = p.armActions ?? { strikes: 0, shoves: 0 }): Evidence | null {
  const C = BEHAVIOR_CONFIG.struggle;
  if (p.withinReachMs < C.minReachMs) return null;
  if (p.armActions) {
    if (recent.strikes < C.minStrikes && recent.shoves < C.minShoves) return null;
    const arm = recent.strikes + recent.shoves;
    const parts = [recent.strikes ? `${recent.strikes} strike-like` : '', recent.shoves ? `${recent.shoves} push` : ''].filter(Boolean).join(', ');
    return {
      strength: clamp(0.55 + 0.1 * Math.min(arm, 4)),
      confirmable: true,
      usesPose: true,
      observations: [`Close together for ${(p.withinReachMs / 1000).toFixed(1)} s`, `Arm movements toward the other person (${parts})`],
      missing: [],
    };
  }
  // No pose: abrupt close-range movement is worth noting, never confirming.
  if (p.suddenChanges < C.minSuddenChanges) return null;
  return {
    strength: 0.45,
    confirmable: false,
    usesPose: true,
    observations: [`Close together for ${(p.withinReachMs / 1000).toFixed(1)} s`, 'Abrupt movements at close range'],
    missing: ['Body pose unavailable — can’t confirm'],
  };
}

const EVIDENCE: Record<BehaviorKind, (p: PairObservation, recent: ArmCounts) => Evidence | null> = {
  PURSUIT_LIKE_MOVEMENT: pursuitEvidence,
  UNUSUAL_PHYSICAL_INTERACTION: interactionEvidence,
  POSSIBLE_STRUGGLE: struggleEvidence,
};
const SUSTAIN_MS: Record<BehaviorKind, number> = {
  PURSUIT_LIKE_MOVEMENT: BEHAVIOR_CONFIG.pursuit.sustainMs,
  UNUSUAL_PHYSICAL_INTERACTION: BEHAVIOR_CONFIG.interaction.sustainMs,
  POSSIBLE_STRUGGLE: BEHAVIOR_CONFIG.struggle.sustainMs,
};

type Tracked = BehaviorEvent & { evidenceSince: number; streak: number; alerted: boolean; endedAt: number | null };

export class BehaviorEventEngine {
  private frames: MonitorFrame[] = [];
  private events = new Map<string, Tracked>();
  // Distinct arm-action times per pair (ms), kept for armMemoryMs.
  private armTimes = new Map<string, { strikes: number[]; shoves: number[] }>();
  private lastAlertAt = -Infinity;
  private seq = 0;

  reset() {
    this.frames = [];
    this.events.clear();
    this.armTimes.clear();
    this.lastAlertAt = -Infinity;
  }

  private rememberArmActions(p: PairObservation, now: number): ArmCounts {
    if (!p.armActions) return { strikes: 0, shoves: 0 };
    const mem = this.armTimes.get(p.key) ?? { strikes: [], shoves: [] };
    const merge = (known: number[], fresh: number[]) =>
      [...known, ...fresh.filter((t) => !known.some((x) => Math.abs(x - t) <= SAME_ACTION_MS))].filter((t) => now - t <= BEHAVIOR_CONFIG.struggle.armMemoryMs);
    const next = { strikes: merge(mem.strikes, p.armActions.strikeTimes), shoves: merge(mem.shoves, p.armActions.shoveTimes) };
    this.armTimes.set(p.key, next);
    return { strikes: next.strikes.length, shoves: next.shoves.length };
  }

  update(frame: MonitorFrame): BehaviorSnapshot {
    const C = BEHAVIOR_CONFIG;
    const now = frame.timestamp;
    this.frames.push(frame);
    while (this.frames.length > C.maxFrames || (this.frames.length && now - this.frames[0].timestamp > C.frameWindowMs)) this.frames.shift();

    const { pairs, abstain } = observePairs(this.frames);
    const seen = new Set<string>();
    let alert: BehaviorEvent | null = null;

    for (const p of pairs) {
      if (p.quality.insufficient) continue;
      const recentArm = this.rememberArmActions(p, now);
      for (const kind of Object.keys(EVIDENCE) as BehaviorKind[]) {
        const ev = EVIDENCE[kind](p, recentArm);
        if (!ev) continue;
        const key = `${kind}:${p.key}`;
        seen.add(key);
        const confidence = clamp(ev.strength * p.quality.factor);
        const uncertainty = [...ev.missing, ...p.quality.reasons.filter((r) => ev.usesPose || r !== 'Body pose unavailable')];
        let e = this.events.get(key);
        if (e?.status === 'ended' && e.endedAt != null && now - e.endedAt > C.cooldownMs) e = undefined;
        if (!e) {
          e = {
            id: `${key}#${(this.seq += 1)}`,
            kind,
            trackIds: [...p.trackIds],
            status: 'emerging',
            confidence,
            observations: ev.observations,
            uncertainty,
            firstSeenAt: now,
            lastSeenAt: now,
            recurrences: 0,
            evidenceSince: now,
            streak: 0,
            alerted: false,
            endedAt: null,
          };
          this.events.set(key, e);
        } else if (e.status === 'ended') {
          // Same pair and kind back within the cooldown: the same occurrence.
          e.recurrences += 1;
          e.endedAt = null;
          e.evidenceSince = now;
          e.streak = 0;
          e.status = 'emerging';
        }
        if (now - e.lastSeenAt > C.evidenceGapMs) {
          e.evidenceSince = now;
          e.streak = 0;
        }
        e.lastSeenAt = now;
        e.confidence = confidence;
        e.observations = ev.observations;
        e.uncertainty = uncertainty;
        const okNow = ev.confirmable && confidence >= C.activeConfidence && now - e.evidenceSince >= SUSTAIN_MS[kind];
        e.streak = okNow ? e.streak + 1 : 0;
        if (e.status !== 'active') {
          if (e.streak >= C.confirmEvaluations) e.status = 'active';
          else e.status = ev.confirmable && confidence >= C.activeConfidence ? 'emerging' : 'uncertain';
        }
        if (e.status === 'active' && !e.alerted && !alert && now - this.lastAlertAt >= C.alertGapMs) {
          e.alerted = true;
          this.lastAlertAt = now;
          alert = publicEvent(e);
        }
      }
    }

    for (const [key, e] of this.events) {
      if (seen.has(key) || e.status === 'ended') {
        if (e.status === 'ended' && e.endedAt != null && now - e.endedAt > C.cooldownMs) this.events.delete(key);
        continue;
      }
      if (now - e.lastSeenAt > C.endAfterMs) {
        e.status = 'ended';
        e.endedAt = now;
      }
    }

    for (const [key, mem] of this.armTimes) {
      if (![...mem.strikes, ...mem.shoves].some((t) => now - t <= C.struggle.armMemoryMs)) this.armTimes.delete(key);
    }
    const all = [...this.events.values()].map(publicEvent);
    return {
      events: all.filter((e) => e.status !== 'ended').sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      recentlyEnded: all.filter((e) => e.status === 'ended'),
      abstaining: abstain,
      alert,
    };
  }
}

// Same action seen again in a later window counts once.
const SAME_ACTION_MS = 150;

function publicEvent(e: Tracked): BehaviorEvent {
  const { evidenceSince: _s, streak: _k, alerted: _a, endedAt: _e, ...rest } = e;
  return { ...rest, trackIds: [...rest.trackIds], observations: [...rest.observations], uncertainty: [...rest.uncertainty] };
}

export const BEHAVIOR_LABEL: Record<BehaviorKind, string> = {
  PURSUIT_LIKE_MOVEMENT: 'Fast movement after another person',
  UNUSUAL_PHYSICAL_INTERACTION: 'Close, sudden interaction',
  POSSIBLE_STRUGGLE: 'Possible struggle',
};
