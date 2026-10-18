import type { MonitorFrame } from '../models/types';
import { THREAT_DETECTORS } from '../threat/detectors';
import { POOR_INPUT_REASON, ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';
import type { ThreatAssessment } from '../threat/types';
import { CROWD_SCENARIOS, POSE_SCENARIOS } from '../threat/validation/scenarios';

// Unreliable or insufficient camera input must never produce a new threat
// judgment. Train-split seeds that do raise the threat on clean input.
const fallClip = () => POSE_SCENARIOS.find((s) => s.id === 'fall-forward')!.build(1);
const panicClip = () => CROWD_SCENARIOS.find((s) => s.id === 'panic-flee-one-way')!.build(1);

function run(frames: MonitorFrame[]): ThreatAssessment[] {
  const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
  return frames.map((f) => engine.update(f));
}
const shown = (out: ThreatAssessment[]) => out.flatMap((a) => a.candidates.map((c) => c.type));
const phoneMoving = (f: MonitorFrame): MonitorFrame => ({
  ...f,
  crowdMetrics: { ...f.crowdMetrics, motionReliable: false, cameraMoving: true, deviceRotationRate: 0.8 },
});

describe('input gating', () => {
  it('raises the threats on clean input (baseline for the checks below)', () => {
    expect(shown(run(fallClip()))).toContain('fall');
    expect(shown(run(panicClip()))).toContain('crowd_panic');
  });

  it('raises nothing while the phone is moving, and says why', () => {
    for (const clip of [fallClip(), panicClip()]) {
      const out = run(clip.map(phoneMoving));
      expect(shown(out)).toEqual([]);
      const reasons = new Set(out[out.length - 1].unavailable.map((u) => u.reason));
      expect([...reasons].some((r) => r === 'Phone is moving' || r === POOR_INPUT_REASON)).toBe(true);
    }
  });

  it('raises nothing when too few frames are analyzed (poor input)', () => {
    // ~1.5 analyzed frames per second.
    const sparse = (clip: MonitorFrame[]) => clip.filter((_, i) => i % 5 === 0);
    for (const clip of [fallClip(), panicClip()]) {
      const out = run(sparse(clip));
      expect(shown(out)).toEqual([]);
      expect(out[out.length - 1].sourceReliability.level).toBe('poor');
      expect(out[out.length - 1].unavailable.every((u) => u.reason === POOR_INPUT_REASON)).toBe(true);
    }
  });

  it('raises no fall without body pose', () => {
    const out = run(fallClip().map((f) => ({ ...f, detections: f.detections.map(({ pose: _pose, ...d }) => d) })));
    expect(shown(out)).toEqual([]);
    expect(out[out.length - 1].unavailable).toContainEqual({ type: 'fall', reason: 'Body pose is not available' });
  });

  it('never shows or escalates a candidate once input turns unusable mid-event', () => {
    const clip = fallClip();
    const clean = run(clip);
    const firstShown = clean.findIndex((a) => a.candidates.length > 0);
    expect(firstShown).toBeGreaterThan(0);
    // The phone starts moving just before the fall would have been shown.
    const cut = firstShown - 1;
    const out = run(clip.map((f, i) => (i >= cut ? phoneMoving(f) : f)));
    expect(out.slice(cut).flatMap((a) => a.candidates)).toEqual([]);
  });

  it('does not escalate an already-shown candidate without fresh evidence', () => {
    const clip = fallClip();
    const clean = run(clip);
    const firstShown = clean.findIndex((a) => a.candidates.length > 0);
    const out = run(clip.map((f, i) => (i > firstShown ? phoneMoving(f) : f)));
    const statuses = out.slice(firstShown).flatMap((a) => a.candidates.map((c) => c.status));
    expect(statuses.every((s) => s === 'emerging')).toBe(true);
    expect(out[out.length - 1].candidates).toHaveLength(0); // evidence decayed away
  });
});
