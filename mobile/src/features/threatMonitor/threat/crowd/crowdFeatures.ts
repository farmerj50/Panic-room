import type { MonitorFrame } from '../../models/types';

// Crowd movement measured on an estimated ground plane, in body heights, so
// people far from the camera are judged like people close to it.
//
// A person's box height h shrinks with distance: distance ≈ focal / h body
// heights, and sideways position ≈ (image x from center) / h. That turns
// boxes into rough floor positions, which (unlike raw image motion) also
// show people walking toward or away from the camera, and ignore jumping in
// place. `focal` is a typical phone camera held upright; a different lens
// scales distances toward/away from the camera, not sideways ones.
export const CROWD_FEATURES = {
  focal: 0.8, // frame heights
  runningSpeed: 1.6, // body heights / second (~2.7 m/s)
  movingSpeed: 0.6,
  minSamples: 3,
  minPathFraction: 0.6, // a track must cover this share of a sub-window to count
  edgeMargin: 0.01, // boxes touching the frame edge give a wrong height
  minBoxHeight: 0.03,
  subWindowMs: 1000,
  stepMs: 500,
  nearCenter: 0.5, // body heights; too close to the group's center to have an "outward"
  // Even slow phone turns make distant people appear to sprint, so crowd
  // motion is only measured while the phone is this steady (hand tremor is
  // below it). Stricter than the Phase 1 camera-moving threshold.
  maxRotationRadPerSec: 0.1,
  // A fit this far off a straight line is a tracking glitch (two people's
  // IDs swapped), not movement. Body heights, or a share of the distance.
  maxFitResidual: 0.5,
  maxFitResidualShare: 0.1,
  minSlowMs: 300, // "standing" must last this long before an onset counts
};

// `segment` changes whenever the phone moved: movement is never measured across it.
type Sample = { t: number; gx: number; gz: number; ix: number; segment: number };

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function samplesByTrack(frames: readonly MonitorFrame[]): Map<number, Sample[]> {
  const out = new Map<number, Sample[]>();
  const e = CROWD_FEATURES.edgeMargin;
  let segment = 0;
  for (const f of frames) {
    // While the phone moves, image motion isn't the crowd's: skip those
    // frames and start a fresh segment after them.
    if (!f.crowdMetrics.motionReliable || (f.crowdMetrics.deviceRotationRate ?? 0) > CROWD_FEATURES.maxRotationRadPerSec) {
      segment += 1;
      continue;
    }
    const aspect = f.frameAspect ?? 4 / 3;
    for (const d of f.detections) {
      const b = d.boundingBox;
      if (b.height < CROWD_FEATURES.minBoxHeight) continue;
      if (b.y <= e || b.y + b.height >= 1 - e || b.x <= e || b.x + b.width >= 1 - e) continue;
      const ix = (b.x + b.width / 2 - 0.5) / aspect; // frame heights from center
      const list = out.get(d.trackId) ?? [];
      list.push({ t: f.timestamp / 1000, gx: ix / b.height, gz: CROWD_FEATURES.focal / b.height, ix, segment });
      out.set(d.trackId, list);
    }
  }
  return out;
}

// Least-squares line through (t, value): slope per second and value at the middle.
function fit(samples: Sample[], key: 'gx' | 'gz' | 'ix') {
  const tm = mean(samples.map((s) => s.t));
  const vm = mean(samples.map((s) => s[key]));
  let num = 0;
  let den = 0;
  for (const s of samples) {
    num += (s.t - tm) * (s[key] - vm);
    den += (s.t - tm) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const rms = Math.sqrt(mean(samples.map((s) => (s[key] - (vm + slope * (s.t - tm))) ** 2)));
  return { slope, mid: vm, rms };
}

export type CrowdSnapshot = {
  start: number;
  end: number;
  people: number; // typical number visible
  tracked: number; // people followed long enough to measure movement
  meanSpeed: number; // body heights / second
  runningShare: number;
  movingShare: number;
  // How aligned the movers are: 1 = all the same way, ~0 = random.
  coherence: number;
  // Movers heading away from the group's center: 1 = straight out.
  outwardness: number;
  spreadRatio: number; // group spread at the end / at the start
  spacing: number; // median nearest-neighbor distance on the floor, body heights
  // 1 = everyone shifts identically on screen, the signature of the phone turning.
  uniformImageMotion: number;
};

export function snapshot(frames: readonly MonitorFrame[], start: number, end: number): CrowdSnapshot {
  const duration = (end - start) / 1000;
  const people = median(frames.map((f) => f.peopleCount));
  const motions = [...samplesByTrack(frames).values()]
    .map((s) => s.filter((x) => x.segment === s[s.length - 1].segment))
    .filter((s) => s.length >= CROWD_FEATURES.minSamples && s[s.length - 1].t - s[0].t >= CROWD_FEATURES.minPathFraction * duration)
    .map((s) => {
      const x = fit(s, 'gx');
      const z = fit(s, 'gz');
      return { vx: x.slope, vz: z.slope, px: x.mid, pz: z.mid, ivx: fit(s, 'ix').slope, speed: Math.hypot(x.slope, z.slope) };
    });
  const n = motions.length;
  const empty: CrowdSnapshot = {
    start,
    end,
    people,
    tracked: n,
    meanSpeed: 0,
    runningShare: 0,
    movingShare: 0,
    coherence: 0,
    outwardness: 0,
    spreadRatio: 1,
    spacing: Infinity,
    uniformImageMotion: 0,
  };
  if (!n) return empty;

  const movers = motions.filter((m) => m.speed >= CROWD_FEATURES.movingSpeed);
  const ux = mean(movers.map((m) => m.vx / m.speed));
  const uz = mean(movers.map((m) => m.vz / m.speed));

  // Positions at the start and end of the sub-window, from the fitted lines.
  const half = duration / 2;
  const startPos = motions.map((m) => ({ x: m.px - m.vx * half, z: m.pz - m.vz * half }));
  const endPos = motions.map((m) => ({ x: m.px + m.vx * half, z: m.pz + m.vz * half }));
  const centerOf = (ps: { x: number; z: number }[]) => ({ x: mean(ps.map((p) => p.x)), z: mean(ps.map((p) => p.z)) });
  const spreadOf = (ps: { x: number; z: number }[]) => {
    const c = centerOf(ps);
    return mean(ps.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
  };
  const c0 = centerOf(startPos);
  const outward = motions
    .map((m, i) => ({ m, dx: startPos[i].x - c0.x, dz: startPos[i].z - c0.z }))
    .filter(({ m, dx, dz }) => m.speed >= CROWD_FEATURES.movingSpeed && Math.hypot(dx, dz) >= CROWD_FEATURES.nearCenter)
    .map(({ m, dx, dz }) => (m.vx * dx + m.vz * dz) / (m.speed * Math.hypot(dx, dz)));

  const spacing =
    n >= 2
      ? median(motions.map((a) => Math.min(...motions.filter((b) => b !== a).map((b) => Math.hypot(a.px - b.px, a.pz - b.pz)))))
      : Infinity;

  let uniformImageMotion = 0;
  if (n >= 3) {
    const m = mean(motions.map((v) => v.ivx));
    if (Math.abs(m) >= 0.03) {
      const residual = mean(motions.map((v) => Math.abs(v.ivx - m))) / Math.abs(m);
      uniformImageMotion = clamp01(1 - residual / 0.4);
    }
  }

  return {
    start,
    end,
    people,
    tracked: n,
    meanSpeed: mean(motions.map((m) => m.speed)),
    runningShare: motions.filter((m) => m.speed >= CROWD_FEATURES.runningSpeed).length / n,
    movingShare: movers.length / n,
    coherence: movers.length >= 2 ? Math.hypot(ux, uz) : 0,
    outwardness: outward.length >= 2 ? mean(outward) : 0,
    spreadRatio: spreadOf(endPos) / Math.max(spreadOf(startPos), 0.3),
    spacing,
    uniformImageMotion,
  };
}

// Overlapping 1 s sub-windows across the window, oldest first. Cached per
// window state: every crowd detector reads the same snapshots each frame.
let cache: { key: string; value: CrowdSnapshot[] } | null = null;

export function crowdSnapshots(window: readonly MonitorFrame[]): CrowdSnapshot[] {
  if (!window.length) return [];
  const first = window[0];
  const last = window[window.length - 1];
  const key = `${last.sessionId}|${window.length}|${first.timestamp}|${last.timestamp}`;
  if (cache?.key === key) return cache.value;
  const out: CrowdSnapshot[] = [];
  for (let end = last.timestamp; end - CROWD_FEATURES.subWindowMs >= first.timestamp - 1; end -= CROWD_FEATURES.stepMs) {
    const start = end - CROWD_FEATURES.subWindowMs;
    out.unshift(snapshot(window.filter((f) => f.timestamp > start && f.timestamp <= end), start, end));
  }
  cache = { key, value: out };
  return out;
}

// The latest sub-window, and the earlier ones that don't overlap the
// current event (ending at least `gapMs` before now).
export function nowAndBefore(window: readonly MonitorFrame[], gapMs = 1500) {
  const snaps = crowdSnapshots(window);
  const now = snaps[snaps.length - 1];
  const before = now ? snaps.filter((s) => s.end <= now.end - gapMs && s.tracked >= 4) : [];
  return { now, before };
}

// ── Movement onsets: when each person started moving fast ──────────────────
// People who start running often leave the view within a second, so crowd
// events are judged by when each person *started* moving fast, remembered
// for a few seconds, rather than by who is still on screen.

export type Onset = {
  trackId: number;
  t: number; // when the person first moved fast (ms)
  vx: number; // body heights / second, at their fastest in the second after
  vz: number;
  speed: number;
  from: { x: number; z: number }; // where they were while still slow
};

type SpeedPoint = { t: number; vx: number; vz: number; speed: number; x: number; z: number };

function speedSeries(samples: Sample[]): SpeedPoint[] {
  const fitSec = CROWD_FEATURES.subWindowMs / 1000;
  const out: SpeedPoint[] = [];
  let from = 0;
  for (let i = 0; i < samples.length; i += 1) {
    while (samples[i].t - samples[from].t > fitSec || samples[from].segment !== samples[i].segment) from += 1;
    const part = samples.slice(from, i + 1);
    if (part.length < 4 || samples[i].t - samples[from].t < CROWD_FEATURES.minPathFraction * fitSec) continue;
    const x = fit(part, 'gx');
    const z = fit(part, 'gz');
    if (Math.hypot(x.rms, z.rms) > Math.max(CROWD_FEATURES.maxFitResidual, CROWD_FEATURES.maxFitResidualShare * z.mid)) continue;
    out.push({ t: samples[i].t * 1000, vx: x.slope, vz: z.slope, speed: Math.hypot(x.slope, z.slope), x: x.mid, z: z.mid });
  }
  return out;
}

type TrackSpeeds = { series: Map<number, SpeedPoint[]>; lastMeasured: Map<number, number> };
let speedCache: { key: string; value: TrackSpeeds } | null = null;

// Speed over time for every track in the window, and when each was last measured.
function trackSpeeds(window: readonly MonitorFrame[]): TrackSpeeds {
  const first = window[0];
  const last = window[window.length - 1];
  const key = `${last.sessionId}|${window.length}|${first.timestamp}|${last.timestamp}`;
  if (speedCache?.key === key) return speedCache.value;
  const series = new Map<number, SpeedPoint[]>();
  for (const [id, samples] of samplesByTrack(window)) series.set(id, speedSeries(samples));
  const lastMeasured = new Map<number, number>();
  for (const [id, pts] of series) if (pts.length) lastMeasured.set(id, pts[pts.length - 1].t);
  speedCache = { key, value: { series, lastMeasured } };
  return speedCache.value;
}

// How many people were being measured in the `ms` before time t: the crowd
// present when something started. Tracks that appear later (newcomers, or a
// runner the tracker re-identified) don't dilute it.
export function presentBefore(window: readonly MonitorFrame[], t: number, ms = 1500): number {
  if (!window.length) return 0;
  let n = 0;
  for (const pts of trackSpeeds(window).series.values()) if (pts.some((p) => p.t <= t && p.t >= t - ms)) n += 1;
  return n;
}

// Each track's first change, within the last `sinceMs`, from slower than
// `slowBelow` to at least `fastAbove`; and how many tracks were measured then.
export function onsets(window: readonly MonitorFrame[], slowBelow: number, fastAbove: number, sinceMs: number) {
  if (!window.length) return { onsets: [] as Onset[], recentTracks: 0 };
  const now = window[window.length - 1].timestamp;
  const all = trackSpeeds(window);
  const found: Onset[] = [];
  for (const [trackId, pts] of all.series) {
    // The most recent onset: an earlier blip (box noise while standing in
    // a tight group) must not hide the real one that follows.
    let slow: SpeedPoint | null = null;
    let slowSince: number | null = null;
    let latest: Onset | null = null;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      if (p.speed < slowBelow) {
        slowSince ??= p.t;
        if (p.t - slowSince >= CROWD_FEATURES.minSlowMs) slow = p;
        continue;
      }
      slowSince = null;
      if (slow && p.speed >= fastAbove) {
        // Direction from the fastest moment just after, when movement
        // dominates measurement noise.
        let peak = p;
        for (let j = i + 1; j < pts.length && pts[j].t - p.t <= 1000; j += 1) if (pts[j].speed > peak.speed) peak = pts[j];
        latest = { trackId, t: p.t, vx: peak.vx, vz: peak.vz, speed: peak.speed, from: { x: slow.x, z: slow.z } };
        slow = null; // must slow down again before another onset
      }
    }
    if (latest && now - latest.t <= sinceMs) found.push(latest);
  }
  let recentTracks = 0;
  for (const t of all.lastMeasured.values()) if (now - t <= sinceMs) recentTracks += 1;
  return { onsets: found, recentTracks };
}

// The largest group of onsets that happened within `spanMs` of each other.
export function synchronized(list: Onset[], spanMs: number): Onset[] {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  let best: Onset[] = [];
  for (let i = 0, j = 0; j < sorted.length; j += 1) {
    while (sorted[j].t - sorted[i].t > spanMs) i += 1;
    if (j - i + 1 > best.length) best = sorted.slice(i, j + 1);
  }
  return best;
}

// Movement that's identical for everyone on screen is the phone turning
// slowly (below the gyroscope threshold), not the crowd.
export const looksLikePhoneTurning = (s: CrowdSnapshot) => s.uniformImageMotion >= 0.7 && s.movingShare >= 0.8;
