// GPS route history for one emergency: cleans the stored points, detects
// stops and builds the compact route the owner's Evidence screen and the
// trusted contacts' Live View both draw. Pure functions (no database), so
// both views always agree and the rules are testable on their own.
//
// A stop is the phone staying within STOP_RADIUS_M of one place for at least
// STOP_MIN_DURATION_MS, measured with the points' own recordedAt times (when
// the phone observed them, not when they arrived). Gaps in updates don't
// break a stop: a stationary phone often sends nothing (location updates are
// distance-filtered), so arriving and the first point after leaving can be
// minutes apart while both are within the radius.

const STOP_RADIUS_M = 50;
const STOP_MIN_DURATION_MS = 3 * 60 * 1000;
// Fixes less precise than this aren't used for the route or stops (the
// latest one is still reported, with its accuracy, as the last known spot).
const MAX_USABLE_ACCURACY_M = 100;
// A single fix this far from both neighbours, whose neighbours are close to
// each other, is GPS drift — dropped.
const SPIKE_DISTANCE_M = 250;
const MAX_ROUTE_POINTS = 1000;
// Location freshness, from the latest point's observation time.
const LIVE_MAX_AGE_MS = 2 * 60 * 1000;
const DELAYED_MAX_AGE_MS = 10 * 60 * 1000;

function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const timeOf = (point) => new Date(point.recordedAt).getTime();

// Chronological, one point per timestamp, no poor-accuracy fixes, no spikes.
function cleanPoints(points) {
  const sorted = points
    .filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude) && Number.isFinite(timeOf(p)))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const unique = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && timeOf(previous) === timeOf(point)) continue;
    if (point.accuracy != null && point.accuracy > MAX_USABLE_ACCURACY_M) continue;
    unique.push(point);
  }
  return unique.filter((point, i) => {
    const before = unique[i - 1];
    const after = unique[i + 1];
    if (!before || !after) return true;
    return !(
      distanceMeters(point, before) > SPIKE_DISTANCE_M &&
      distanceMeters(point, after) > SPIKE_DISTANCE_M &&
      distanceMeters(before, after) < SPIKE_DISTANCE_M
    );
  });
}

// `ongoing` marks the last stop when the phone is still there (tracking is
// still running and no later point has left it).
function detectStops(points, { trackingActive = false } = {}) {
  const stops = [];
  let i = 0;
  while (i < points.length) {
    let latSum = points[i].latitude;
    let lngSum = points[i].longitude;
    let count = 1;
    let j = i;
    let maxGapMs = 0;
    while (j + 1 < points.length) {
      const centre = { latitude: latSum / count, longitude: lngSum / count };
      const next = points[j + 1];
      if (distanceMeters(centre, next) <= STOP_RADIUS_M) {
        maxGapMs = Math.max(maxGapMs, timeOf(next) - timeOf(points[j]));
        latSum += next.latitude;
        lngSum += next.longitude;
        count += 1;
        j += 1;
        continue;
      }
      // One stray fix inside an otherwise steady stop (drift that survived
      // cleaning): skip it if the point after it is back in the cluster.
      const afterNext = points[j + 2];
      if (afterNext && distanceMeters(centre, afterNext) <= STOP_RADIUS_M) {
        maxGapMs = Math.max(maxGapMs, timeOf(afterNext) - timeOf(points[j]));
        latSum += afterNext.latitude;
        lngSum += afterNext.longitude;
        count += 1;
        j += 2;
        continue;
      }
      break;
    }
    const durationMs = timeOf(points[j]) - timeOf(points[i]);
    if (durationMs >= STOP_MIN_DURATION_MS) {
      const isLast = j === points.length - 1;
      stops.push({
        latitude: Number((latSum / count).toFixed(6)),
        longitude: Number((lngSum / count).toFixed(6)),
        arrivedAt: new Date(timeOf(points[i])).toISOString(),
        departedAt: isLast && trackingActive ? null : new Date(timeOf(points[j])).toISOString(),
        durationSeconds: Math.round(durationMs / 1000),
        ongoing: isLast && trackingActive,
        pointCount: count,
        // Longest stretch without an update during the stop.
        longestGapSeconds: Math.round(maxGapMs / 1000),
      });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return stops;
}

// At most `max` points: evenly spaced, always keeping the first and last.
function simplify(points, max = MAX_ROUTE_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const kept = [];
  for (let k = 0; k < max; k += 1) kept.push(points[Math.round(k * step)]);
  return kept;
}

function freshnessOf(latest, { trackingActive, now = Date.now() }) {
  if (!latest) return { status: "none", ageSeconds: null };
  const ageMs = Math.max(0, now - timeOf(latest));
  if (!trackingActive) return { status: "final", ageSeconds: Math.round(ageMs / 1000) };
  const status = ageMs <= LIVE_MAX_AGE_MS ? "live" : ageMs <= DELAYED_MAX_AGE_MS ? "delayed" : "stale";
  return { status, ageSeconds: Math.round(ageMs / 1000) };
}

const toWire = (p) => ({
  latitude: p.latitude,
  longitude: p.longitude,
  accuracy: p.accuracy ?? null,
  batteryLevel: p.batteryLevel ?? null,
  recordedAt: new Date(timeOf(p)).toISOString(),
});

// points: decrypted { latitude, longitude, accuracy?, batteryLevel?, recordedAt }.
// trackingActive: the phone is still expected to send points (SOS active or
// recovery tracking on) — decides "ongoing" stops and live/stale freshness.
function buildRoute(points, { trackingActive = false, now = Date.now(), maxPoints = MAX_ROUTE_POINTS } = {}) {
  const all = points
    .filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude) && Number.isFinite(timeOf(p)))
    .sort((a, b) => timeOf(a) - timeOf(b));
  const clean = cleanPoints(all);
  // The last known spot is the newest fix even if it's imprecise — shown
  // with its accuracy so it's never presented as more exact than it is.
  const latest = all[all.length - 1] || null;
  const latestBattery = [...all].reverse().find((p) => p.batteryLevel != null)?.batteryLevel ?? null;
  return {
    points: simplify(clean, maxPoints).map(toWire),
    start: clean[0] ? toWire(clean[0]) : all[0] ? toWire(all[0]) : null,
    latest: latest ? toWire(latest) : null,
    batteryLevel: latestBattery,
    stops: detectStops(clean, { trackingActive }),
    freshness: freshnessOf(latest, { trackingActive, now }),
    pointCount: all.length,
    usedPointCount: clean.length,
  };
}

module.exports = {
  STOP_RADIUS_M,
  STOP_MIN_DURATION_MS,
  MAX_USABLE_ACCURACY_M,
  LIVE_MAX_AGE_MS,
  DELAYED_MAX_AGE_MS,
  distanceMeters,
  cleanPoints,
  detectStops,
  simplify,
  freshnessOf,
  buildRoute,
};
