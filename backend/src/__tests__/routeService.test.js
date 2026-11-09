const { buildRoute, cleanPoints, detectStops, freshnessOf, simplify } = require("../services/routeService");

// ~1 m of latitude = 1 / 111_320 degrees.
const M = 1 / 111_320;
const T0 = Date.parse("2026-11-09T12:00:00Z");
const p = (northM, minutes, extra = {}) => ({
  latitude: 40 + northM * M,
  longitude: -74,
  recordedAt: new Date(T0 + minutes * 60_000).toISOString(),
  ...extra,
});

// Moving north at ~10 m/s, sampled every 15 s.
function drive(fromM, toM, startMin) {
  const out = [];
  const steps = Math.max(1, Math.round(Math.abs(toM - fromM) / 150));
  for (let i = 1; i <= steps; i += 1) out.push(p(fromM + ((toM - fromM) * i) / steps, startMin + i * 0.25));
  return out;
}

describe("stop detection", () => {
  test("finds two stops of 3+ minutes on a drive, with arrival and duration", () => {
    const points = [
      p(0, 0),
      ...drive(0, 1500, 0),
      // Stop 1: 5 minutes within ~15 m (GPS jitter)
      p(1500, 4), p(1510, 5), p(1495, 6), p(1505, 7), p(1500, 9),
      ...drive(1500, 3000, 9),
      // Stop 2: 4 minutes
      p(3000, 14), p(3008, 16), p(2996, 18),
      ...drive(3000, 4000, 18),
    ];
    const stops = detectStops(cleanPoints(points));
    expect(stops).toHaveLength(2);
    expect(stops[0].arrivedAt).toBe(new Date(T0 + 2.5 * 60_000).toISOString());
    expect(stops[0].durationSeconds).toBeGreaterThanOrEqual(5 * 60);
    expect(Math.abs(stops[0].latitude - (40 + 1500 * M))).toBeLessThan(20 * M);
    expect(stops[1].durationSeconds).toBeGreaterThanOrEqual(4 * 60);
    expect(stops.every((s) => s.ongoing === false && s.departedAt)).toBe(true);
  });

  test("a pause under 3 minutes (traffic light) is not a stop", () => {
    const points = [p(0, 0), p(5, 1), p(3, 2.5), ...drive(0, 1000, 2.5)];
    expect(detectStops(cleanPoints(points))).toEqual([]);
  });

  test("gaps in updates while parked still count (distance-filtered GPS sends nothing while still)", () => {
    // Arrive, nothing for 20 minutes, the first point after moving off is 20 m away.
    const points = [...drive(-1000, 0, 0), p(20, 22), ...drive(20, 1500, 22)];
    const [stop] = detectStops(cleanPoints(points));
    expect(stop.durationSeconds).toBeGreaterThanOrEqual(20 * 60);
    expect(stop.longestGapSeconds).toBeGreaterThanOrEqual(19 * 60);
  });

  test("the last stop is ongoing only while tracking is still running", () => {
    const points = [...drive(-1000, 0, 0), p(2, 2), p(4, 5), p(1, 8)];
    expect(detectStops(cleanPoints(points), { trackingActive: true })[0]).toMatchObject({ ongoing: true, departedAt: null });
    expect(detectStops(cleanPoints(points), { trackingActive: false })[0].ongoing).toBe(false);
  });

  test("one drifting fix inside a stop doesn't split it", () => {
    const points = [p(0, 0), p(3, 1), p(120, 2), p(2, 3), p(4, 4), p(1, 6)];
    expect(detectStops(cleanPoints(points))).toHaveLength(1);
  });
});

describe("cleaning", () => {
  test("drops poor-accuracy fixes, duplicate timestamps and lone spikes; sorts by observation time", () => {
    const points = [
      p(100, 2),
      p(0, 0),
      p(0, 0, { latitude: 41 }), // duplicate timestamp: first one wins
      p(50, 1, { accuracy: 500 }), // too imprecise
      p(5000, 3), // spike: far from both neighbours, which are close together
      p(110, 4),
    ];
    const clean = cleanPoints(points);
    expect(clean.map((x) => x.recordedAt)).toEqual([p(0, 0), p(100, 2), p(110, 4)].map((x) => x.recordedAt));
  });
});

describe("buildRoute", () => {
  test("keeps the newest fix as the last known location even when imprecise, with its accuracy", () => {
    const route = buildRoute([p(0, 0), p(100, 1), p(150, 2, { accuracy: 400, batteryLevel: 41 })]);
    expect(route.latest).toMatchObject({ accuracy: 400, batteryLevel: 41 });
    expect(route.points).toHaveLength(2); // the imprecise fix isn't drawn
    expect(route.batteryLevel).toBe(41);
    expect(route.start.recordedAt).toBe(p(0, 0).recordedAt);
  });

  test("simplify keeps first and last and caps the count", () => {
    const many = Array.from({ length: 5000 }, (_, i) => p(i, i / 10));
    const out = simplify(many, 1000);
    expect(out).toHaveLength(1000);
    expect(out[0]).toBe(many[0]);
    expect(out[999]).toBe(many[4999]);
  });

  test("freshness: live, delayed, stale while tracking; final once closed", () => {
    const now = T0 + 60 * 60_000;
    const at = (minAgo) => ({ recordedAt: new Date(now - minAgo * 60_000).toISOString() });
    expect(freshnessOf(at(1), { trackingActive: true, now }).status).toBe("live");
    expect(freshnessOf(at(5), { trackingActive: true, now }).status).toBe("delayed");
    expect(freshnessOf(at(30), { trackingActive: true, now }).status).toBe("stale");
    expect(freshnessOf(at(1), { trackingActive: false, now }).status).toBe("final");
    expect(freshnessOf(null, { trackingActive: true, now }).status).toBe("none");
  });
});
