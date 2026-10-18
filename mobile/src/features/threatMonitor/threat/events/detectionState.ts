import type { MonitorFrame } from '../../models/types';
import { THREAT_LABEL, THREAT_ORDER } from '../presentation';
import type { ThreatAssessment, ThreatType } from '../types';

// What the dashboard says about threat detection right now. Each state is
// distinct on purpose: "nothing detected" is only claimed when detection is
// actually running on usable input.
export type DetectionStateKind =
  | 'off' // monitoring isn't running
  | 'disabled' // threat detection isn't part of this build
  | 'failed' // threat analysis crashed; people detection may continue
  | 'warming_up' // not enough video yet to judge anything
  | 'unreliable_input' // phone moving or poor footage
  | 'detector_unavailable' // no enabled detector can run (e.g. no pose, phone moving)
  | 'candidates' // at least one possible threat is shown
  | 'insufficient_evidence' // something may be happening, not enough to show
  | 'no_threat'; // detectors running on usable input, nothing seen

export type DetectionState = { kind: DetectionStateKind; title: string; detail: string };

export type DetectorStatus = {
  type: ThreatType;
  label: string;
  state: 'active' | 'paused' | 'disabled' | 'off';
  reason?: string;
};

export function detectorStatuses(
  assessment: ThreatAssessment | null,
  options: { running: boolean; threatsEnabled: boolean; notYetSupported: Partial<Record<ThreatType, string>> },
): DetectorStatus[] {
  return THREAT_ORDER.map((type) => {
    const label = THREAT_LABEL[type].replace(/^Possible /, '');
    const capital = label.charAt(0).toUpperCase() + label.slice(1);
    const notSupported = options.notYetSupported[type];
    if (notSupported) return { type, label: capital, state: 'disabled', reason: notSupported };
    if (!options.threatsEnabled) return { type, label: capital, state: 'disabled', reason: 'Not enabled in this build' };
    if (!options.running || !assessment) return { type, label: capital, state: 'off' };
    const paused = assessment.unavailable.find((u) => u.type === type);
    return paused ? { type, label: capital, state: 'paused', reason: paused.reason } : { type, label: capital, state: 'active' };
  });
}

export function detectionState(input: {
  running: boolean;
  threatsEnabled: boolean;
  failed: boolean;
  assessment: ThreatAssessment | null;
  frame: MonitorFrame | null;
  watchedMs: number; // how long this session has been analyzing
  warmUpMs: number;
  notYetSupported: Partial<Record<ThreatType, string>>;
}): DetectionState {
  if (!input.threatsEnabled) {
    return { kind: 'disabled', title: 'Threat detection is off', detail: 'This build only counts people. It does not look for threats.' };
  }
  if (!input.running) return { kind: 'off', title: 'Not monitoring', detail: 'Start the monitor to look for falls and crowd events.' };
  if (input.failed) {
    return { kind: 'failed', title: 'Threat analysis stopped', detail: 'Something went wrong analyzing the video. People are still counted. Restart the monitor to try again.' };
  }
  const { assessment, frame } = input;
  if (!assessment || !frame || input.watchedMs < input.warmUpMs) {
    return { kind: 'warming_up', title: 'Getting started', detail: 'Watching for a few seconds before judging anything.' };
  }
  // Something already shown stays the headline, whatever the input does now.
  if (assessment.candidates.length) {
    return { kind: 'candidates', title: 'Possible threat seen', detail: 'Check the events below and what you see around you.' };
  }
  if (!frame.crowdMetrics.motionReliable) {
    return { kind: 'unreliable_input', title: 'Hold the phone steady', detail: 'The phone is moving, so movement around you can’t be judged.' };
  }
  if (assessment.sourceReliability.level === 'poor') {
    return {
      kind: 'unreliable_input',
      title: 'Camera input is unreliable',
      detail: assessment.sourceReliability.reasons[0] ?? 'The video is too poor to judge movement.',
    };
  }
  const enabled = THREAT_ORDER.filter((t) => !input.notYetSupported[t]);
  const unavailable = new Set(assessment.unavailable.map((u) => u.type));
  if (enabled.every((t) => unavailable.has(t))) {
    return { kind: 'detector_unavailable', title: 'Detection unavailable', detail: assessment.unavailable[0]?.reason ?? 'No detector can run right now.' };
  }
  if (assessment.building.length) {
    return {
      kind: 'insufficient_evidence',
      title: 'Not enough evidence',
      detail: 'Something may be happening, but there isn’t enough evidence to show it.',
    };
  }
  return {
    kind: 'no_threat',
    title: 'No threat detected',
    detail: 'Nothing recognized right now. Bes only looks for falls and some crowd events, and can miss things.',
  };
}
