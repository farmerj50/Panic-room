import {
  CROWD_FEATURES,
  crowdSnapshots,
  looksLikePhoneTurning,
  nowAndBefore,
  onsets,
  presentBefore,
  synchronized,
  type CrowdSnapshot,
  type Onset,
} from '../crowd/crowdFeatures';
import type { DetectorObservation, ThreatDetector } from '../types';

// Indicator labels describe what the image shows, never physical distance,
// pressure or real-world speed (all of these are estimated from boxes).
//
// Crowd-level threats from how many people move together over several
// seconds. They check crowd size themselves, over the last few seconds:
// after a scatter the view may already be empty, and that must not cut the
// evidence short (so no engine-level 'multiplePeople' requirement). Movement-based by design (no pose): these describe what a crowd
// is doing, never what any one person is doing. Each needs a sudden change
// shared by many people at once, so a crowd that is already running (a
// jog), packed (a concert) or moving at random (sport) isn't flagged.
export const CROWD_THREAT_CONFIG = {
  panic: {
    slowBelow: 0.6, // body heights / second: standing or milling...
    fastAbove: 1.6, // ...to running
    sinceMs: 3000,
    withinMs: 1200, // starts this close together count as "at once"
    minPeople: 4,
    minShare: 0.4, // of the people seen in the last few seconds
    maxEarlierRunningShare: 0.3, // the crowd wasn't already running (a race, a jog)
  },
  dispersal: {
    slowBelow: 0.6, // standing...
    fastAbove: 1.2, // ...to moving briskly: faster than friends walking off
    sinceMs: 3000,
    withinMs: 1200,
    minPeople: 4,
    minShare: 0.5,
    minOutwardness: 0.5, // headings point away from a common point
    maxSameWay: 0.8, // and spread out, rather than one stream
  },
  surge: {
    minTracked: 6,
    maxSpacing: 0.4, // body heights between neighbors (~0.7 m): packed
    minCoherence: 0.7,
    // A lurch: most of the crowd moves together, faster than walking.
    lurchMovingShare: 0.6,
    minSpeed: 1.0, // body heights / second (~1.7 m/s): pushed, not strolling
    minSpeedRatio: 2,
    // Compression: part of the crowd pushes into the rest and spacing shrinks.
    compressMovingShare: 0.4,
    compressMinSpeed: 0.7,
    maxCompression: 0.8, // spacing shrinks to this share of what it typically was
    pushWithinMs: 2000,
  },
};

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const calmest = (before: CrowdSnapshot[], key: 'runningShare' | 'movingShare' | 'meanSpeed') =>
  before.reduce<CrowdSnapshot | null>((best, s) => (!best || s[key] < best[key] ? s : best), null);

// The point people's headings radiate from: where their lines of travel
// come closest to meeting (least squares). Null when they're near parallel
// (a race, a flow) or the point is far from the group.
export function radiatingFrom(group: Onset[]): { x: number; z: number } | null {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const o of group) {
    const ux = o.vx / (o.speed || 1);
    const uz = o.vz / (o.speed || 1);
    // Projection onto the normal of this line of travel.
    const m11 = 1 - ux * ux;
    const m12 = -ux * uz;
    const m22 = 1 - uz * uz;
    a11 += m11;
    a12 += m12;
    a22 += m22;
    b1 += m11 * o.from.x + m12 * o.from.z;
    b2 += m12 * o.from.x + m22 * o.from.z;
  }
  const det = a11 * a22 - a12 * a12;
  if (det < 0.05 * group.length * group.length) return null;
  const p = { x: (a22 * b1 - a12 * b2) / det, z: (a11 * b2 - a12 * b1) / det };
  const cx = group.reduce((a, o) => a + o.from.x, 0) / group.length;
  const cz = group.reduce((a, o) => a + o.from.z, 0) / group.length;
  const spread = group.reduce((a, o) => a + Math.hypot(o.from.x - cx, o.from.z - cz), 0) / group.length;
  return Math.hypot(p.x - cx, p.z - cz) <= 1.5 * spread + 1 ? p : null;
}

// How much a group's movement points away from a center (1 = straight out).
function outwardness(group: Onset[], center: { x: number; z: number }): number {
  const cos = group
    .map((o) => ({ o, dx: o.from.x - center.x, dz: o.from.z - center.z }))
    .filter(({ dx, dz }) => Math.hypot(dx, dz) >= CROWD_FEATURES.nearCenter)
    .map(({ o, dx, dz }) => (o.vx * dx + o.vz * dz) / (o.speed * Math.hypot(dx, dz) || 1));
  return cos.length >= 2 ? cos.reduce((a, b) => a + b, 0) / cos.length : 0;
}

function sameWay(group: Onset[]): number {
  const ux = group.reduce((a, o) => a + o.vx / (o.speed || 1), 0) / group.length;
  const uz = group.reduce((a, o) => a + o.vz / (o.speed || 1), 0) / group.length;
  return Math.hypot(ux, uz);
}

export const crowdPanicDetector: ThreatDetector = {
  id: 'crowd-panic',
  types: ['crowd_panic'],
  requires: ['reliableMotion'],
  evaluate({ window }) {
    const C = CROWD_THREAT_CONFIG.panic;
    const { now } = nowAndBefore(window);
    if (!now || looksLikePhoneTurning(now)) return [];
    const group = synchronized(onsets(window, C.slowBelow, C.fastAbove, C.sinceMs).onsets, C.withinMs);
    if (!group.length) return [];
    const present = Math.max(presentBefore(window, group[0].t), group.length);
    const share = group.length / present;
    if (group.length < C.minPeople || share < C.minShare) return [];
    const earlier = crowdSnapshots(window).filter((s) => s.end <= group[0].t && s.tracked >= 4);
    if (!earlier.length || Math.min(...earlier.map((s) => s.runningShare)) > C.maxEarlierRunningShare) return [];

    const source = radiatingFrom(group);
    const out = source ? outwardness(group, source) : 0;
    const aligned = sameWay(group);
    const direction = out >= 0.5 ? 'Running away from the same area' : aligned >= 0.7 ? 'Running the same way' : null;
    const strength = 0.45 + 0.3 * Math.min(1, (share - C.minShare) / 0.4) + 0.15 * Math.min(1, (group.length - C.minPeople) / 6) + (direction ? 0.1 : 0);
    return [
      {
        type: 'crowd_panic',
        subjectKey: 'scene',
        trackIds: group.map((o) => o.trackId),
        strength,
        indicators: [
          { id: 'panic-running', label: `${group.length} of ${present} people broke into a run within ${(C.withinMs / 1000).toFixed(1)} s`, value: share, weight: 0.55 },
          { id: 'panic-calm-before', label: 'The crowd was not running a few seconds earlier', weight: 0.2 },
          ...(direction ? [{ id: 'panic-direction', label: direction, weight: 0.15 }] : []),
        ],
      },
    ];
  },
};

export const suddenDispersalDetector: ThreatDetector = {
  id: 'crowd-dispersal',
  types: ['sudden_dispersal'],
  requires: ['reliableMotion'],
  evaluate({ window }) {
    const C = CROWD_THREAT_CONFIG.dispersal;
    const { now } = nowAndBefore(window);
    if (!now || looksLikePhoneTurning(now)) return [];
    const group = synchronized(onsets(window, C.slowBelow, C.fastAbove, C.sinceMs).onsets, C.withinMs);
    if (!group.length) return [];
    const present = Math.max(presentBefore(window, group[0].t), group.length);
    const share = group.length / present;
    if (group.length < C.minPeople || share < C.minShare) return [];
    // Outward from a common point, in different directions (not one flow).
    const source = radiatingFrom(group);
    if (!source || sameWay(group) > C.maxSameWay) return [];
    const out = outwardness(group, source);
    if (out < C.minOutwardness) return [];

    const strength = 0.45 + 0.25 * Math.min(1, (out - C.minOutwardness) / 0.4) + 0.2 * Math.min(1, (share - C.minShare) / 0.4) + 0.1 * Math.min(1, (group.length - C.minPeople) / 6);
    return [
      {
        type: 'sudden_dispersal',
        subjectKey: 'scene',
        trackIds: group.map((o) => o.trackId),
        strength,
        indicators: [
          { id: 'dispersal-outward', label: `${group.length} people moved sharply outward from where they stood`, value: out, weight: 0.5 },
          { id: 'dispersal-at-once', label: `All within ${(C.withinMs / 1000).toFixed(1)} s of each other`, value: share, weight: 0.3 },
        ],
      },
    ];
  },
};

export const crowdSurgeDetector: ThreatDetector = {
  id: 'crowd-surge',
  types: ['crowd_surge'],
  requires: ['reliableMotion'],
  evaluate({ window }) {
    const C = CROWD_THREAT_CONFIG.surge;
    const { now, before } = nowAndBefore(window);
    if (!now || now.tracked < C.minTracked || looksLikePhoneTurning(now)) return [];
    if (now.spacing > C.maxSpacing || !before.length) return [];
    const typicalSpacing = median(before.map((s) => s.spacing).filter(Number.isFinite));
    const compression = typicalSpacing > 0 ? now.spacing / typicalSpacing : 1;
    const calm = calmest(before, 'meanSpeed');
    const ratio = calm ? now.meanSpeed / Math.max(calm.meanSpeed, 0.3) : 1;
    const lurch = now.coherence >= C.minCoherence && now.movingShare >= C.lurchMovingShare && now.meanSpeed >= C.minSpeed && ratio >= C.minSpeedRatio;
    // Packed tighter than a few seconds ago, right after a push in one
    // direction (the push itself may be over by the time spacing shrinks).
    const pushed = crowdSnapshots(window).some(
      (s) =>
        s.end >= now.end - C.pushWithinMs &&
        s.tracked >= C.minTracked &&
        s.coherence >= C.minCoherence &&
        s.movingShare >= C.compressMovingShare &&
        s.meanSpeed >= C.compressMinSpeed,
    );
    const compressing = compression <= C.maxCompression && pushed;
    if (!compressing && !lurch) return [];

    const strength =
      0.5 + 0.2 * Math.min(1, (C.maxSpacing - now.spacing) / 0.3) + (compressing ? 0.15 : 0) + (lurch ? 0.15 : 0);
    return [
      {
        type: 'crowd_surge',
        subjectKey: 'scene',
        trackIds: [],
        strength,
        indicators: [
          { id: 'surge-packed', label: 'People appear tightly packed (estimated from the image)', value: now.spacing, weight: 0.35 },
          { id: 'surge-flow', label: 'Many people pushed the same way at once', value: now.coherence, weight: 0.3 },
          ...(compressing ? [{ id: 'surge-compress', label: 'Gaps between people appear to have closed up', value: compression, weight: 0.25 }] : []),
          ...(lurch ? [{ id: 'surge-lurch', label: 'The crowd suddenly moved together, faster than walking pace', value: ratio, weight: 0.25 }] : []),
        ],
      },
    ];
  },
};

export const CROWD_DETECTORS: readonly ThreatDetector[] = [crowdPanicDetector, suddenDispersalDetector, crowdSurgeDetector];
