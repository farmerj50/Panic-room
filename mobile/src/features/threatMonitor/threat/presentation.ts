import type { Severity, SourceReliability, ThreatType } from './types';

// User-facing wording for threat candidates. Candidates are automated
// observations, never confirmed threats, and confidence is uncalibrated, so
// it is shown only as a qualitative evidence strength, never as a number.

export const THREAT_LABEL: Record<ThreatType, string> = {
  fall: 'Possible fall',
  crowd_panic: 'Possible crowd panic',
  sudden_dispersal: 'Possible sudden dispersal',
  crowd_surge: 'Possible crowd surge',
  physical_confrontation: 'Possible fight',
  assault: 'Possible assault',
};

// Order in the detector list.
export const THREAT_ORDER: ThreatType[] = ['fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge', 'physical_confrontation', 'assault'];

export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', moderate: 'Moderate', high: 'High' };

export type EvidenceStrength = 'weak' | 'moderate' | 'strong';

export function evidenceStrength(confidence: number): EvidenceStrength {
  if (confidence >= 0.7) return 'strong';
  if (confidence >= 0.45) return 'moderate';
  return 'weak';
}

export const EVIDENCE_LABEL: Record<EvidenceStrength, string> = {
  weak: 'Weak evidence',
  moderate: 'Moderate evidence',
  strong: 'Strong evidence',
};

export const UNCALIBRATED_NOTE = 'Not calibrated — this is not a probability';
export const NOT_CONFIRMED_NOTE = 'Automated observation, not a confirmed threat. Check what you see.';

export const RELIABILITY_LABEL: Record<SourceReliability['level'], string> = {
  good: 'Good',
  limited: 'Limited',
  poor: 'Poor',
};

const pad = (n: number) => String(n).padStart(2, '0');
// Wall-clock time of day, HH:MM:SS.
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
