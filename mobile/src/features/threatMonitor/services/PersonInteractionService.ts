import type { MonitorFrame } from '../models/types';
import { shovesBy, strikesBy } from '../threat/detectors/confrontationDetector';
import { poseHistory, typicalTorso } from '../threat/pose/poseFeatures';
import { PROXIMITY_CONFIG } from './ProximityEstimator';

// Pairwise observations between confirmed tracked people: how far apart they
// are (in body heights), whether one is closing on the other, how fast each
// moves, and — when both bodies were seen — arm actions aimed at the other
// person (the existing strike/shove primitives). These are measurements with
// their quality attached, never a classification. Overlapping boxes are
// reported only as a small separation, never as "contact".
//
// All thresholds are first guesses: UNVALIDATED on real footage.
export const INTERACTION_CONFIG = {
  windowMs: 4000,
  fitMs: 1000, // velocity / closing-rate fit
  reach: 0.8, // separation (body heights) within which people can touch
  maxPeople: 6, // more than this: too crowded to pair reliably
  minTrackAgeMs: 1000,
  minConfidence: 0.45,
  maxOccludedShare: 0.3,
  idSwitchJump: 0.8, // body heights between consecutive frames: a track jumped to someone else
  maxSampleGapMs: 400,
  poseLookbackMs: 3000,
  // Phone motion is a quality limit, not a stop: between-people geometry
  // (separation, closing, arms aimed at the other person) survives a moving
  // phone; only severe motion makes it unusable.
  severeRotationRadPerSec: 0.6,
  movingPhoneFactor: 0.7,
  lowConfidenceFactor: 0.7,
  clippedFactor: 0.75,
  occludedFactor: 0.7,
};

export type PhoneState = 'steady' | 'moving' | 'unusable';

export type InteractionQuality = {
  phone: PhoneState;
  poseAvailable: boolean;
  factor: number; // 0..1 multiplier on any evidence from this pair
  insufficient: boolean; // too little to judge anything
  reasons: string[];
};

export type ApproachWindow = { closing: number; approacher: number; approacherSpeed: number };

export type PairObservation = {
  key: string;
  trackIds: [number, number];
  separation: number; // centre distance / mean body height
  closingRate: number | null; // separations per second, + = getting closer
  approach: ApproachWindow | null; // strongest closing over the last ~2 s
  speeds: [number | null, number | null]; // body heights per second
  headingCos: number | null;
  follower: number | null; // the one behind, when both move the same way
  withinReachMs: number;
  suddenChanges: number; // frames in the last 2 s where either track changed velocity abruptly
  armActions: { strikes: number; shoves: number; strikeTimes: number[]; shoveTimes: number[] } | null; // null: body pose unavailable
  quality: InteractionQuality;
};

type Sample = { t: number; x: number; y: number; h: number; conf: number; clipped: boolean; sudden: boolean };
type Series = { samples: Sample[]; switched: boolean; firstSeen: number };

function fit(points: Array<{ t: number; v: number }>): number | null {
  if (points.length < 3) return null;
  const tm = points.reduce((a, p) => a + p.t, 0) / points.length;
  const vm = points.reduce((a, p) => a + p.v, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - tm) * (p.v - vm);
    den += (p.t - tm) ** 2;
  }
  return den > 0 ? num / den : null;
}

function seriesFor(window: readonly MonitorFrame[], trackId: number): Series {
  const C = INTERACTION_CONFIG;
  const m = PROXIMITY_CONFIG.edgeMargin;
  let samples: Sample[] = [];
  let switched = false;
  let firstSeen = Infinity;
  for (const f of window) {
    const d = f.detections.find((p) => p.trackId === trackId);
    if (!d) continue;
    const b = d.boundingBox;
    const aspect = f.frameAspect ?? 4 / 3;
    const s: Sample = {
      t: f.timestamp / 1000,
      x: (b.x + b.width / 2) / aspect, // frame heights, like y
      y: b.y + b.height / 2,
      h: Math.max(b.height, 1e-3),
      conf: d.confidence,
      clipped: b.x <= m || b.y <= m || b.x + b.width >= 1 - m || b.y + b.height >= 1 - m,
      sudden: d.motion.suddenChange,
    };
    const prev = samples[samples.length - 1];
    // A track that jumps across the frame between two close frames has
    // switched to someone else: forget what came before.
    if (prev && (s.t - prev.t) * 1000 <= C.maxSampleGapMs && Math.hypot(s.x - prev.x, s.y - prev.y) / ((s.h + prev.h) / 2) > C.idSwitchJump) {
      samples = [];
      switched = true;
      firstSeen = Infinity;
    }
    samples.push(s);
    firstSeen = Math.min(firstSeen, d.firstSeenAt != null ? d.firstSeenAt / 1000 : s.t);
  }
  return { samples, switched, firstSeen };
}

function velocity(samples: Sample[], from: number, to: number): { vx: number; vy: number; speed: number } | null {
  const pts = samples.filter((s) => s.t >= from && s.t <= to);
  const vx = fit(pts.map((s) => ({ t: s.t, v: s.x })));
  const vy = fit(pts.map((s) => ({ t: s.t, v: s.y })));
  if (vx == null || vy == null) return null;
  const h = pts.reduce((a, s) => a + s.h, 0) / pts.length;
  return { vx: vx / h, vy: vy / h, speed: Math.hypot(vx, vy) / h };
}

function phoneState(frame: MonitorFrame): PhoneState {
  const rotation = frame.crowdMetrics.deviceRotationRate ?? 0;
  if (rotation >= INTERACTION_CONFIG.severeRotationRadPerSec) return 'unusable';
  if (!frame.crowdMetrics.motionReliable || rotation > PROXIMITY_CONFIG.maxRotationRadPerSec) return 'moving';
  return 'steady';
}

// Observations for every pair of people in the latest frame of `window`.
export function observePairs(window: readonly MonitorFrame[]): { pairs: PairObservation[]; abstain: string | null } {
  const C = INTERACTION_CONFIG;
  const latest = window[window.length - 1];
  if (!latest || latest.detections.length < 2) return { pairs: [], abstain: null };
  if (latest.detections.length > C.maxPeople) return { pairs: [], abstain: 'Too many people to follow pairs' };
  const phone = phoneState(latest);
  if (phone === 'unusable') return { pairs: [], abstain: 'Phone moving too much' };

  const now = latest.timestamp / 1000;
  const ids = latest.detections.map((d) => d.trackId);
  const series = new Map(ids.map((id) => [id, seriesFor(window, id)]));
  const pairs: PairObservation[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      const sa = series.get(a)!;
      const sb = series.get(b)!;
      pairs.push(observePair(window, a, b, sa, sb, now, phone));
    }
  }
  return { pairs, abstain: null };
}

function observePair(window: readonly MonitorFrame[], a: number, b: number, sa: Series, sb: Series, now: number, phone: PhoneState): PairObservation {
  const C = INTERACTION_CONFIG;
  const byT = new Map(sb.samples.map((s) => [s.t, s]));
  // Separation over time, on frames where both were seen.
  const sep = sa.samples
    .filter((s) => byT.has(s.t))
    .map((s) => {
      const o = byT.get(s.t)!;
      return { t: s.t, v: Math.hypot(s.x - o.x, s.y - o.y) / ((s.h + o.h) / 2) };
    });
  const lastA = sa.samples[sa.samples.length - 1];
  const lastB = sb.samples[sb.samples.length - 1];
  const separation = sep.length ? sep[sep.length - 1].v : Math.hypot(lastA.x - lastB.x, lastA.y - lastB.y) / ((lastA.h + lastB.h) / 2);
  const closingSlope = fit(sep.filter((p) => now - p.t <= C.fitMs / 1000));
  const closingRate = closingSlope == null ? null : -closingSlope;

  // Strongest approach over the last ~2 s (1 s windows), and who did it.
  let approach: ApproachWindow | null = null;
  for (const end of [now - 1, now - 0.5, now]) {
    const s = fit(sep.filter((p) => p.t > end - 1 && p.t <= end));
    if (s == null) continue;
    const va = velocity(sa.samples, end - 1, end);
    const vb = velocity(sb.samples, end - 1, end);
    if (!va || !vb) continue;
    const pa = sa.samples.filter((x) => x.t <= end).pop()!;
    const pb = sb.samples.filter((x) => x.t <= end).pop()!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    // Each person's speed toward the other.
    const towardA = (va.vx * dx + va.vy * dy) / len;
    const towardB = -(vb.vx * dx + vb.vy * dy) / len;
    const w: ApproachWindow = towardA >= towardB ? { closing: -s, approacher: a, approacherSpeed: va.speed } : { closing: -s, approacher: b, approacherSpeed: vb.speed };
    if (!approach || w.closing > approach.closing) approach = w;
  }

  const va = velocity(sa.samples, now - C.fitMs / 1000, now);
  const vb = velocity(sb.samples, now - C.fitMs / 1000, now);
  let headingCos: number | null = null;
  let follower: number | null = null;
  if (va && vb && va.speed > 0 && vb.speed > 0) {
    headingCos = (va.vx * vb.vx + va.vy * vb.vy) / (va.speed * vb.speed);
    // Along the shared heading, who is behind?
    const hx = (va.vx + vb.vx) / 2;
    const hy = (va.vy + vb.vy) / 2;
    const ahead = (lastB.x - lastA.x) * hx + (lastB.y - lastA.y) * hy;
    follower = ahead > 0 ? a : b;
  }

  let withinReachMs = 0;
  for (let k = sep.length - 1; k >= 0 && sep[k].v <= C.reach; k -= 1) withinReachMs = (now - sep[k].t) * 1000;
  const suddenChanges = [...sa.samples, ...sb.samples].filter((s) => now - s.t <= 2 && s.sudden).length;

  // Arm actions aimed at the other person, when both bodies were seen.
  const ha = poseHistory(window, a, C.poseLookbackMs);
  const hb = poseHistory(window, b, C.poseLookbackMs);
  const recentPose = (h: typeof ha) => h.length >= 3 && now - h[h.length - 1].t / 1000 <= 0.6;
  const ta = typicalTorso(ha);
  const tb = typicalTorso(hb);
  const poseAvailable = recentPose(ha) && recentPose(hb) && ta != null && tb != null;
  let armActions: PairObservation['armActions'] = null;
  if (poseAvailable) {
    const strikes = [...strikesBy(ha, hb, ta!), ...strikesBy(hb, ha, tb!)];
    const shoves = [...shovesBy(ha, hb, ta!), ...shovesBy(hb, ha, tb!)];
    armActions = { strikes: strikes.length, shoves: shoves.length, strikeTimes: strikes.map((x) => x.t), shoveTimes: shoves.map((x) => x.t) };
  }

  // Quality: every limit lowers confidence and is named; only too little
  // history makes the pair unusable.
  const reasons: string[] = [];
  let factor = 1;
  let insufficient = false;
  if (phone === 'moving') {
    factor *= C.movingPhoneFactor;
    reasons.push('Phone moving: speeds are approximate');
  }
  const age = (now - Math.max(sa.firstSeen, sb.firstSeen)) * 1000;
  if (sep.length < 3 || age < C.minTrackAgeMs) {
    insufficient = true;
    reasons.push(sa.switched || sb.switched ? 'Tracking was interrupted' : 'People only just appeared');
  } else if (sa.switched || sb.switched) {
    reasons.push('Tracking was interrupted');
  }
  const recent = [...sa.samples, ...sb.samples].filter((s) => now - s.t <= 1);
  if (recent.length && recent.reduce((x, s) => x + s.conf, 0) / recent.length < C.minConfidence) {
    factor *= C.lowConfidenceFactor;
    reasons.push('Low detection confidence');
  }
  if (lastA.clipped || lastB.clipped) {
    factor *= C.clippedFactor;
    reasons.push('Someone is partly out of frame');
  }
  const since = Math.max(sa.samples[0]?.t ?? now, sb.samples[0]?.t ?? now);
  const span = window.filter((f) => f.timestamp / 1000 >= since);
  const missing = span.filter((f) => !f.detections.some((d) => d.trackId === a) || !f.detections.some((d) => d.trackId === b)).length;
  if (span.length && missing / span.length > C.maxOccludedShare) {
    factor *= C.occludedFactor;
    reasons.push('People partly hidden');
  }
  if (!poseAvailable) reasons.push('Body pose unavailable');

  return {
    key: `${a}-${b}`,
    trackIds: [a, b],
    separation,
    closingRate,
    approach,
    speeds: [va?.speed ?? null, vb?.speed ?? null],
    headingCos,
    follower,
    withinReachMs,
    suddenChanges,
    armActions,
    quality: { phone, poseAvailable, factor, insufficient, reasons },
  };
}
