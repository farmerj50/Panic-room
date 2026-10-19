import type { MonitorFrame } from '../models/types';

// Per-person "getting closer / moving away in camera view", from how each
// tracked person's box grows or shrinks over the last ~2 seconds. Relative
// only: no distance is measured, and nothing here says anything about
// intent. If the phone itself moves toward someone, they also read as
// getting closer — that's why every state says "in camera view".

export type ProximityState = 'APPROACHING' | 'MOVING_AWAY' | 'STATIONARY' | 'UNCERTAIN';
export type ProximitySensitivity = 'normal' | 'low';

export const PROXIMITY_CONFIG = {
  windowMs: 2000,
  minHistoryMs: 1500,
  minSamples: 5,
  // Box-height growth rate (ln units per second): +0.12 ≈ +12 % per second.
  approachRate: 0.12,
  lowSensitivityRate: 0.2,
  stillRate: 0.04,
  maxStillDrift: 0.08, // frame widths per second for "still"
  sustainMs: 1000, // the last second must agree with the whole window
  minConfidence: 0.5,
  edgeMargin: 0.02, // a box this close to the frame edge is cropped
  maxResidual: 0.06, // ln units; a jumpy box isn't trusted
  // Phone steadiness (gyroscope). Configurable: walking with the phone will
  // often exceed it, which suppresses states — to be tuned on real phones.
  maxRotationRadPerSec: 0.1,
  holdEvaluations: 2, // a new state must repeat before it's shown
  forgetAfterMs: 1500,
};

export type PersonProximity = {
  trackId: number;
  state: ProximityState;
  // True only when this reading is trustworthy enough to alert on.
  reliable: boolean;
  rate: number | null;
  reason?: 'phone-moving' | 'not-enough-history' | 'cropped' | 'low-confidence' | 'unsteady' | 'changing';
};

type Sample = { t: number; lnH: number; cx: number; conf: number; clipped: boolean };
type TrackState = { samples: Sample[]; shown: ProximityState; candidate: ProximityState | null; candidateCount: number; lastSeen: number };

function slope(points: Array<{ t: number; v: number }>): { slope: number; rms: number } {
  const n = points.length;
  const tm = points.reduce((a, p) => a + p.t, 0) / n;
  const vm = points.reduce((a, p) => a + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - tm) * (p.v - vm);
    den += (p.t - tm) ** 2;
  }
  const s = den > 0 ? num / den : 0;
  const rms = Math.sqrt(points.reduce((a, p) => a + (p.v - (vm + s * (p.t - tm))) ** 2, 0) / n);
  return { slope: s, rms };
}

export class ProximityEstimator {
  private tracks = new Map<number, TrackState>();

  reset() {
    this.tracks.clear();
  }

  update(frame: MonitorFrame, sensitivity: ProximitySensitivity = 'normal'): Map<number, PersonProximity> {
    const C = PROXIMITY_CONFIG;
    const now = frame.timestamp;
    const rotation = frame.crowdMetrics.deviceRotationRate ?? 0;
    const phoneSteady = frame.crowdMetrics.motionReliable && rotation <= C.maxRotationRadPerSec;
    const threshold = sensitivity === 'low' ? C.lowSensitivityRate : C.approachRate;
    const out = new Map<number, PersonProximity>();

    for (const person of frame.detections) {
      const b = person.boundingBox;
      const m = C.edgeMargin;
      const clipped = b.x <= m || b.y <= m || b.x + b.width >= 1 - m || b.y + b.height >= 1 - m;
      const track = this.tracks.get(person.trackId) ?? { samples: [], shown: 'UNCERTAIN' as ProximityState, candidate: null, candidateCount: 0, lastSeen: now };
      track.samples.push({ t: now / 1000, lnH: Math.log(Math.max(b.height, 1e-3)), cx: b.x + b.width / 2, conf: person.confidence, clipped });
      track.samples = track.samples.filter((s) => now / 1000 - s.t <= C.windowMs / 1000);
      track.lastSeen = now;
      this.tracks.set(person.trackId, track);

      const { state: raw, rate, reason } = this.rawState(track.samples, phoneSteady, threshold);
      // Hysteresis: a new state is shown once it repeats.
      if (raw === track.shown) {
        track.candidate = null;
        track.candidateCount = 0;
      } else if (raw === track.candidate) {
        track.candidateCount += 1;
        if (track.candidateCount >= C.holdEvaluations) {
          track.shown = raw;
          track.candidate = null;
          track.candidateCount = 0;
        }
      } else {
        track.candidate = raw;
        track.candidateCount = 1;
        if (C.holdEvaluations <= 1) track.shown = raw;
      }
      out.set(person.trackId, {
        trackId: person.trackId,
        state: track.shown,
        reliable: reason === undefined && raw === track.shown,
        rate,
        ...(reason ? { reason } : {}),
      });
    }

    for (const [id, t] of this.tracks) if (now - t.lastSeen > C.forgetAfterMs) this.tracks.delete(id);
    return out;
  }

  private rawState(samples: Sample[], phoneSteady: boolean, threshold: number): { state: ProximityState; rate: number | null; reason?: PersonProximity['reason'] } {
    const C = PROXIMITY_CONFIG;
    if (!phoneSteady) return { state: 'UNCERTAIN', rate: null, reason: 'phone-moving' };
    const span = samples.length ? (samples[samples.length - 1].t - samples[0].t) * 1000 : 0;
    if (samples.length < C.minSamples || span < C.minHistoryMs) return { state: 'UNCERTAIN', rate: null, reason: 'not-enough-history' };
    if (samples.slice(-3).some((s) => s.clipped)) return { state: 'UNCERTAIN', rate: null, reason: 'cropped' };
    if (samples.reduce((a, s) => a + s.conf, 0) / samples.length < C.minConfidence) return { state: 'UNCERTAIN', rate: null, reason: 'low-confidence' };
    const whole = slope(samples.map((s) => ({ t: s.t, v: s.lnH })));
    if (whole.rms > C.maxResidual) return { state: 'UNCERTAIN', rate: whole.slope, reason: 'unsteady' };
    const lastT = samples[samples.length - 1].t;
    const recentSamples = samples.filter((s) => lastT - s.t <= C.sustainMs / 1000);
    const recent = recentSamples.length >= 3 ? slope(recentSamples.map((s) => ({ t: s.t, v: s.lnH }))).slope : whole.slope;
    if (whole.slope >= threshold && recent >= threshold * 0.75) return { state: 'APPROACHING', rate: whole.slope };
    if (whole.slope <= -threshold && recent <= -threshold * 0.75) return { state: 'MOVING_AWAY', rate: whole.slope };
    const drift = Math.abs(slope(samples.map((s) => ({ t: s.t, v: s.cx }))).slope);
    if (Math.abs(whole.slope) <= C.stillRate && drift <= C.maxStillDrift) return { state: 'STATIONARY', rate: whole.slope };
    return { state: 'UNCERTAIN', rate: whole.slope, reason: 'changing' };
  }
}

export const PROXIMITY_LABEL: Record<ProximityState, string> = {
  APPROACHING: 'Getting closer in camera view',
  MOVING_AWAY: 'Moving away in camera view',
  STATIONARY: 'Still',
  UNCERTAIN: 'Unsure',
};

export const PROXIMITY_SYMBOL: Record<ProximityState, string> = { APPROACHING: '↗', MOVING_AWAY: '↘', STATIONARY: '•', UNCERTAIN: '?' };
