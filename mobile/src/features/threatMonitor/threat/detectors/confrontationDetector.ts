import type { MonitorFrame } from '../../models/types';
import { KP, visible } from '../pose/skeleton';
import { poseHistory, strikeTarget, torsoAngle, torsoCenter, typicalTorso, uni, wrists, type PoseSample } from '../pose/poseFeatures';
import type { DetectorObservation, ThreatDetector } from '../types';

export const CONFRONTATION_CONFIG = {
  lookbackMs: 3000,
  maxSampleGapMs: 350,
  // A strike: a wrist moving fast, aimed at the other person's head/chest,
  // and ending within reach of it. All in torso lengths of the striker.
  // Low frame rates hide a punch's peak speed, so the shape matters most:
  // a real move toward the head/chest that ends in contact.
  minStrikeSpeed: 1.5, // torso lengths per second (floor, not the main signal)
  minStrikeTravel: 0.3,
  minAimCosine: 0.6,
  maxEndDistance: 0.6, // ends at the head/chest (contact), not just near it
  minStrikeGapMs: 200, // separate strikes, not one motion counted twice
  minRetraction: 0.2, // the hand pulls back this far between counted strikes
  handContact: 0.35, // the other person's hand is here too: a high-five or handshake
  // Two people this close (torso centers, in torso lengths) can reach each other.
  maxPairDistance: 3,
  downAboveDeg: 55,
};

type Strike = { t: number };

export function strikesBy(attacker: PoseSample[], target: PoseSample[], torso: number): Strike[] {
  const byTime = new Map(target.map((s) => [s.t, s]));
  const strikes: Strike[] = [];
  // Per wrist: where its last strike ended, and the farthest the hand has
  // been from the target since then (it must pull back before striking again).
  const lastEnd = new Map<number, number>();
  const farthestSince = new Map<number, number>();
  for (let i = 1; i < attacker.length; i += 1) {
    const a0 = attacker[i - 1];
    const a1 = attacker[i];
    const dt = (a1.t - a0.t) / 1000;
    if (dt <= 0 || a1.t - a0.t > CONFRONTATION_CONFIG.maxSampleGapMs) continue;
    const victim = byTime.get(a1.t);
    const aim = victim && strikeTarget(victim);
    if (!victim || !aim) continue;
    const victimHands = wrists(victim);
    for (const k of [KP.leftWrist, KP.rightWrist]) {
      const w0k = a0.pose.keypoints[k];
      const w1k = a1.pose.keypoints[k];
      if (!visible(w0k) || !visible(w1k)) continue;
      const w0 = uni(w0k, a0.aspect);
      const w1 = uni(w1k, a1.aspect);
      const dx = w1.x - w0.x;
      const dy = w1.y - w0.y;
      const travel = Math.hypot(dx, dy) / torso;
      const speed = travel / dt;
      const tx = aim.x - w0.x;
      const ty = aim.y - w0.y;
      const cos = (dx * tx + dy * ty) / (Math.hypot(dx, dy) * Math.hypot(tx, ty) || 1);
      const end = Math.hypot(aim.x - w1.x, aim.y - w1.y) / torso;
      const startDist = Math.hypot(tx, ty) / torso;
      farthestSince.set(k, Math.max(farthestSince.get(k) ?? startDist, startDist));
      const retracted = !lastEnd.has(k) || (farthestSince.get(k) ?? 0) - (lastEnd.get(k) ?? 0) >= CONFRONTATION_CONFIG.minRetraction;
      // Meeting the other person's hand in mid-air (a high-five, a handshake),
      // away from their body — not a fist landing on a guard at their face.
      const handToHand = victimHands.some(
        (h) =>
          Math.hypot(h.x - w1.x, h.y - w1.y) / torso <= CONFRONTATION_CONFIG.handContact &&
          Math.hypot(h.x - aim.x, h.y - aim.y) / torso >= CONFRONTATION_CONFIG.handContact + 0.2,
      );
      if (
        retracted &&
        !handToHand &&
        speed >= CONFRONTATION_CONFIG.minStrikeSpeed &&
        travel >= CONFRONTATION_CONFIG.minStrikeTravel &&
        cos >= CONFRONTATION_CONFIG.minAimCosine &&
        end <= CONFRONTATION_CONFIG.maxEndDistance
      ) {
        const last = strikes[strikes.length - 1];
        if (!last || a1.t - last.t >= CONFRONTATION_CONFIG.minStrikeGapMs) {
          strikes.push({ t: a1.t });
          lastEnd.set(k, end);
          farthestSince.set(k, end);
        }
      }
    }
  }
  return strikes;
}

function isDown(samples: PoseSample[]): boolean {
  const last = samples[samples.length - 1];
  const angle = last && torsoAngle(last.pose);
  return angle != null && angle >= CONFRONTATION_CONFIG.downAboveDeg;
}

// Physical confrontations (mutual strikes) and assaults (one-sided strikes,
// stronger if the other person goes down), from body pose over several
// seconds. Hugs, dancing, high-fives and sport at a distance produce no
// aimed, repeated strikes and so no observation. Pose-based only.
export const confrontationDetector: ThreatDetector = {
  id: 'confrontation-pose',
  types: ['physical_confrontation', 'assault'],
  requires: ['pose', 'multiplePeople'],
  evaluate({ window }) {
    const latest: MonitorFrame | undefined = window[window.length - 1];
    if (!latest) return [];
    const people = latest.detections.filter((d) => d.pose);
    const history = new Map(people.map((p) => [p.trackId, poseHistory(window, p.trackId, CONFRONTATION_CONFIG.lookbackMs)]));
    const out: DetectorObservation[] = [];

    for (let i = 0; i < people.length; i += 1) {
      for (let j = i + 1; j < people.length; j += 1) {
        const a = people[i].trackId;
        const b = people[j].trackId;
        const ha = history.get(a)!;
        const hb = history.get(b)!;
        if (ha.length < 3 || hb.length < 3) continue;
        const ta = typicalTorso(ha);
        const tb = typicalTorso(hb);
        const ca = torsoCenter(ha[ha.length - 1]);
        const cb = torsoCenter(hb[hb.length - 1]);
        if (!ta || !tb || !ca || !cb) continue;
        const distance = Math.hypot(ca.x - cb.x, ca.y - cb.y) / ((ta + tb) / 2);
        if (distance > CONFRONTATION_CONFIG.maxPairDistance) continue;
        const closeness = Math.min(1, (CONFRONTATION_CONFIG.maxPairDistance - distance) / 1.5);

        const sa = strikesBy(ha, hb, ta).length;
        const sb = strikesBy(hb, ha, tb).length;
        if (sa + sb === 0) continue;
        const proximity = 0.6 + 0.4 * closeness;
        const closeIndicator = {
          id: 'close',
          label: `Within reach of each other (${distance.toFixed(1)} torso lengths apart)`,
          value: distance,
          weight: 0.2 * proximity,
        };

        if (sa >= 1 && sb >= 1 && sa + sb >= 2) {
          const strength = Math.min(1, (0.45 + 0.12 * Math.min(sa + sb, 5)) * proximity);
          out.push({
            type: 'physical_confrontation',
            subjectKey: `pair:${Math.min(a, b)}-${Math.max(a, b)}`,
            trackIds: [a, b],
            strength,
            indicators: [
              { id: 'mutual-strikes', label: `Both people striking at each other (${sa + sb} strikes in 3 s)`, value: sa + sb, weight: 0.6 },
              closeIndicator,
            ],
          });
          continue;
        }

        const [attacker, victim, strikes, victimHistory] = sa >= sb ? [a, b, sa, hb] : [b, a, sb, ha];
        if (strikes < 2) continue; // a single contact (a push, a high-five) is not enough
        const down = isDown(victimHistory);
        const strength = Math.min(1, (0.45 + 0.13 * Math.min(strikes, 4) + (down ? 0.25 : 0)) * proximity);
        out.push({
          type: 'assault',
          subjectKey: `assault:${attacker}-${victim}`,
          trackIds: [attacker, victim],
          strength,
          indicators: [
            { id: 'one-sided-strikes', label: `One person striking another who is not striking back (${strikes} strikes in 3 s)`, value: strikes, weight: 0.6 },
            ...(down ? [{ id: 'victim-down', label: 'The person being struck is on the ground', weight: 0.3 }] : []),
            closeIndicator,
          ],
        });
      }
    }
    return out;
  },
};
