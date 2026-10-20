import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ThreatEvent } from '../events/ThreatEventLog';
import type { ThreatType } from '../types';

// Opt-in user feedback on AI Monitor events: confirm, correct the type, flag
// a false warning, or report a missed event. Stored on this phone only. It
// never changes the live detectors — nothing in threat/ reads it — and it
// leaves the phone only if the user shares it themselves.

export type FeedbackKind = 'confirmed' | 'wrong_type' | 'false_warning' | 'missed';
export type FeedbackType = ThreatType | 'other';

export type FeedbackEntry = {
  id: string;
  createdAt: number;
  kind: FeedbackKind;
  eventId?: string;
  eventType?: ThreatType; // what Bes said
  correctedType?: FeedbackType; // what the user says it was (wrong_type, missed)
  eventFirstSeenAt?: number;
  eventLastSeenAt?: number;
  severity?: string;
  evidence?: string;
  indicators?: string[]; // the "what was observed" text shown, nothing more
  missedWhen?: 'just_now' | 'last_5_min' | 'earlier';
};

const OPT_IN_KEY = 'bes_ai_feedback_optin';
const ENTRIES_KEY = 'bes_ai_feedback_v1';
export const MAX_FEEDBACK = 500;

export async function getFeedbackOptIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(OPT_IN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setFeedbackOptIn(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(OPT_IN_KEY, on ? '1' : '0');
  } catch {}
}

export async function listFeedback(): Promise<FeedbackEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(ENTRIES_KEY);
    return raw ? (JSON.parse(raw) as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

let nextId = 1;

// Saves feedback only when the user has opted in. Returns the saved entry.
export async function addFeedback(entry: Omit<FeedbackEntry, 'id' | 'createdAt'>, now = Date.now()): Promise<FeedbackEntry | null> {
  if (!(await getFeedbackOptIn())) return null;
  const saved: FeedbackEntry = { ...entry, id: `fb-${now}-${nextId++}`, createdAt: now };
  const all = [saved, ...(await listFeedback())].slice(0, MAX_FEEDBACK);
  try {
    await AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(all));
  } catch {
    return null;
  }
  return saved;
}

export function feedbackForEvent(event: ThreatEvent, kind: Exclude<FeedbackKind, 'missed'>, correctedType?: FeedbackType): Omit<FeedbackEntry, 'id' | 'createdAt'> {
  return {
    kind,
    eventId: event.id,
    eventType: event.type,
    ...(correctedType ? { correctedType } : {}),
    eventFirstSeenAt: event.firstSeenAt,
    eventLastSeenAt: event.lastSeenAt,
    severity: event.severity,
    evidence: event.evidence,
    indicators: event.indicators.map((i) => i.label),
  };
}

export async function clearFeedback(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ENTRIES_KEY);
  } catch {}
}

// Plain-text export the user can share themselves (no images, no location).
export function feedbackExport(entries: FeedbackEntry[]): string {
  return JSON.stringify({ format: 'bes-ai-feedback', version: 1, entries }, null, 2);
}
