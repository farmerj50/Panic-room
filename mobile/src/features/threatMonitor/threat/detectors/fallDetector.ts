import { hipMid, poseHistory, torsoAngle, typicalTorso } from '../pose/poseFeatures';
import type { DetectorObservation, ThreatDetector } from '../types';

export const FALL_CONFIG = {
  uprightBelowDeg: 35,
  downAboveDeg: 60,
  maxTransitionMs: 1500, // faster than sitting or lying down on purpose
  minHipDropTorsos: 0.5, // the hips really go down (bending over keeps them up)
  minDownMs: 600, // and the person stays down
  minHipDropSpeed: 0.8, // torso lengths/s at the fastest moment; lying down on purpose is far slower
  lookbackMs: 6000,
};

// A fall: a body that goes from upright to horizontal quickly, with the hips
// dropping, and stays down. Pose-based only, and only while the phone is
// steady: rolling the phone tilts a standing person in the image.
export const fallDetector: ThreatDetector = {
  id: 'fall-pose',
  types: ['fall'],
  requires: ['pose', 'reliableMotion'],
  evaluate({ window }) {
    const latest = window[window.length - 1];
    if (!latest) return [];
    const out: DetectorObservation[] = [];
    for (const person of latest.detections) {
      if (!person.pose) continue;
      const samples = poseHistory(window, person.trackId, FALL_CONFIG.lookbackMs);
      if (samples.length < 4) continue;
      const torso = typicalTorso(samples);
      if (!torso) continue;
      const angles = samples.map((s) => torsoAngle(s.pose));

      // The person must be down now, and have been for a moment.
      const nowAngle = angles[angles.length - 1];
      if (nowAngle == null || nowAngle < FALL_CONFIG.downAboveDeg) continue;
      let downSince = samples[samples.length - 1].t;
      for (let i = samples.length - 1; i >= 0 && (angles[i] ?? 0) >= FALL_CONFIG.downAboveDeg; i -= 1) downSince = samples[i].t;
      const downMs = samples[samples.length - 1].t - downSince;

      // The last upright moment before going down.
      let uprightIdx = -1;
      for (let i = samples.length - 1; i >= 0; i -= 1) {
        if (samples[i].t < downSince && (angles[i] ?? 90) <= FALL_CONFIG.uprightBelowDeg) {
          uprightIdx = i;
          break;
        }
      }
      if (uprightIdx < 0) continue;
      const transitionMs = downSince - samples[uprightIdx].t;
      if (transitionMs > FALL_CONFIG.maxTransitionMs) continue;

      const hipBefore = hipMid(samples[uprightIdx].pose);
      const hipNow = hipMid(samples[samples.length - 1].pose);
      if (!hipBefore || !hipNow) continue;
      const hipDrop = (hipNow.y - hipBefore.y) / torso;
      if (hipDrop < FALL_CONFIG.minHipDropTorsos) continue;
      let peakDropSpeed = 0;
      for (let i = uprightIdx + 1; i < samples.length; i += 1) {
        const h0 = hipMid(samples[i - 1].pose);
        const h1 = hipMid(samples[i].pose);
        const dt = (samples[i].t - samples[i - 1].t) / 1000;
        if (h0 && h1 && dt > 0) peakDropSpeed = Math.max(peakDropSpeed, (h1.y - h0.y) / torso / dt);
      }
      if (peakDropSpeed < FALL_CONFIG.minHipDropSpeed) continue;
      if (downMs < FALL_CONFIG.minDownMs) continue;

      const speedScore = 1 - transitionMs / FALL_CONFIG.maxTransitionMs; // 0..1, faster = stronger
      const dropScore = Math.min(1, hipDrop / 1.2);
      const stayScore = Math.min(1, downMs / 3000);
      const strength = 0.45 + 0.25 * speedScore + 0.15 * dropScore + 0.15 * stayScore;
      out.push({
        type: 'fall',
        subjectKey: `person:${person.trackId}`,
        trackIds: [person.trackId],
        strength,
        indicators: [
          { id: 'fall-fast', label: `Went from upright to lying in ${(transitionMs / 1000).toFixed(1)} s`, value: transitionMs, weight: 0.45 + 0.25 * speedScore },
          { id: 'fall-hips', label: 'Hips dropped to the ground', value: hipDrop, weight: 0.15 * dropScore + 0.1 },
          { id: 'fall-still-down', label: `Still down after ${(downMs / 1000).toFixed(1)} s`, value: downMs, weight: 0.15 * stayScore + 0.05 },
        ],
      });
    }
    return out;
  },
};
