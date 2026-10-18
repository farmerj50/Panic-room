import type { Severity, ThreatType } from './types';

// Suggested safety actions shown with a candidate. Advice only: nothing here
// is ever performed automatically. SOS stays a deliberate tap by the user.
const BASE: Record<ThreatType, string[]> = {
  physical_confrontation: ['Keep your distance', 'Move toward other people or a staffed area'],
  assault: ['Keep your distance', 'Move to safety before helping', 'Call 911 if someone is hurt'],
  fall: ['Check whether the person needs help, if it is safe', 'Call 911 if they are hurt or unresponsive'],
  crowd_panic: ['Move away from the source of the panic', 'Head for an open exit, not the nearest one everyone is using'],
  sudden_dispersal: ['Look around for what people are moving away from', 'Move calmly in the same direction'],
  crowd_surge: ['Move diagonally toward the edge of the crowd', 'Keep your arms up in front of your chest', 'Avoid walls and barriers'],
};

export function recommendedActions(type: ThreatType, severity: Severity): string[] {
  const actions = [...BASE[type]];
  if (severity === 'high') actions.push('If you are in danger, tap SOS to start Emergency');
  return actions;
}
