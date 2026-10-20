import type { MonitorFrame } from '../models/types';
import type { SourceReliability } from './types';

export const RELIABILITY_CONFIG = {
  minGoodFps: 4,
  minLimitedFps: 2,
  minMotionReliableShare: 0.7,
  minDetectionScore: 0.45,
};

// How much the recent camera input can be trusted. Low frame rate, a moving
// phone or weak detections all reduce confidence in any candidate.
export function computeSourceReliability(window: readonly MonitorFrame[], poseCoverage = 0): SourceReliability {
  const reasons: string[] = [];
  if (window.length < 2) {
    return { level: 'poor', analyzedFps: 0, motionReliableShare: 0, meanDetectionScore: 0, poseCoverage, reasons: ['Not enough frames yet'] };
  }
  const spanSec = (window[window.length - 1].timestamp - window[0].timestamp) / 1000;
  const analyzedFps = spanSec > 0 ? (window.length - 1) / spanSec : 0;
  const motionReliableShare = window.filter((f) => f.crowdMetrics.motionReliable).length / window.length;
  const scores = window.flatMap((f) => f.detections.map((d) => d.confidence));
  const meanDetectionScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  let level: SourceReliability['level'] = 'good';
  const downgrade = (to: SourceReliability['level']) => {
    if (to === 'poor' || (to === 'limited' && level === 'good')) level = to;
  };
  if (analyzedFps < RELIABILITY_CONFIG.minLimitedFps) {
    downgrade('poor');
    reasons.push(`Low analysis rate (${analyzedFps.toFixed(1)} fps)`);
  } else if (analyzedFps < RELIABILITY_CONFIG.minGoodFps) {
    downgrade('limited');
    reasons.push(`Reduced analysis rate (${analyzedFps.toFixed(1)} fps)`);
  }
  if (motionReliableShare < RELIABILITY_CONFIG.minMotionReliableShare) {
    downgrade(motionReliableShare < 0.4 ? 'poor' : 'limited');
    reasons.push('Phone is moving');
  }
  if (scores.length && meanDetectionScore < RELIABILITY_CONFIG.minDetectionScore) {
    downgrade('limited');
    reasons.push('People are hard to see (low light, distance or blur)');
  }
  return { level, analyzedFps, motionReliableShare, meanDetectionScore, poseCoverage, reasons };
}

export const RELIABILITY_FACTOR: Record<SourceReliability['level'], number> = { good: 1, limited: 0.75, poor: 0.4 };
