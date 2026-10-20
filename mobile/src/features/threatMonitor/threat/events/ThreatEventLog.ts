import { THREAT_EVENT_CONFIG } from '../../config/threatMonitorConfig';
import { evidenceStrength, type EvidenceStrength } from '../presentation';
import type { Severity, ThreatAssessment, ThreatIndicator, ThreatType } from '../types';

// What the dashboard lists: one event per real-world occurrence, built from
// the engine's candidates. Events outlive the candidates (so a brief one
// isn't missed), are merged when the same kind recurs within a cooldown (so
// the user isn't alerted again and again), end when the evidence stops or
// goes stale, and expire after a while. Held in memory only: nothing is
// written to disk or uploaded.

export type ThreatEventStatus = 'ongoing' | 'ended';
export type ThreatEventEndReason = 'resolved' | 'stale' | 'stopped';

export type ThreatEvent = {
  id: string;
  type: ThreatType;
  sessionId: string; // the monitoring session it was seen in
  trackIds: number[]; // session-scoped temporary IDs (no identity)
  status: ThreatEventStatus;
  endReason?: ThreatEventEndReason;
  severity: Severity; // highest seen
  evidence: EvidenceStrength; // highest seen, from uncalibrated confidence
  calibrated: false;
  firstSeenAt: number; // wall clock, ms
  lastSeenAt: number;
  endedAt?: number;
  // Times this kind of event came back within the cooldown and was merged
  // into this one instead of raising a new alert.
  repeats: number;
  indicators: ThreatIndicator[];
  recommendedActions: string[];
  candidateIds: string[];
};

type Config = {
  staleMs: number;
  cooldownMs: number;
  expireMs: number;
  maxEvents: number;
};

const SEVERITY_RANK: Record<Severity, number> = { low: 1, moderate: 2, high: 3 };
const EVIDENCE_RANK: Record<EvidenceStrength, number> = { weak: 1, moderate: 2, strong: 3 };

let nextEventId = 1;

// Crowd types describe the whole scene; the others are about specific people.
const SCENE_TYPES: ReadonlySet<ThreatType> = new Set(['crowd_panic', 'sudden_dispersal', 'crowd_surge']);

export class ThreatEventLog {
  private events: ThreatEvent[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly config: Config = THREAT_EVENT_CONFIG) {}

  // Feed one engine assessment from monitoring session `sessionId`. `now`
  // is wall-clock time.
  ingest(assessment: ThreatAssessment, now: number, sessionId = 'default') {
    const seen = new Set<string>();
    for (const c of assessment.candidates) {
      let event =
        this.events.find((e) => e.sessionId === sessionId && e.candidateIds.includes(c.id)) ??
        // The same occurrence coming back within the cooldown (not a new
        // alert): same session, same kind, and for person-level events the
        // same person. Unrelated events of the same kind stay separate.
        this.events.find(
          (e) =>
            e.sessionId === sessionId &&
            e.type === c.type &&
            now - e.lastSeenAt <= this.config.cooldownMs &&
            (SCENE_TYPES.has(c.type) || c.trackIds.some((id) => e.trackIds.includes(id))),
        );
      if (!event) {
        event = {
          id: `event-${nextEventId++}`,
          type: c.type,
          sessionId,
          trackIds: [],
          status: 'ongoing',
          severity: c.severity,
          evidence: evidenceStrength(c.confidence),
          calibrated: false,
          firstSeenAt: now,
          lastSeenAt: now,
          repeats: 0,
          indicators: [],
          recommendedActions: c.recommendedActions,
          candidateIds: [],
        };
        this.events.unshift(event);
      } else if (event.status === 'ended') {
        event.status = 'ongoing';
        event.endReason = undefined;
        event.endedAt = undefined;
        event.repeats += 1;
      }
      if (!event.candidateIds.includes(c.id)) event.candidateIds.push(c.id);
      event.trackIds = [...new Set([...event.trackIds, ...c.trackIds])].sort((a, b) => a - b);
      seen.add(event.id);
      event.lastSeenAt = now;
      if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[event.severity]) {
        event.severity = c.severity;
        event.recommendedActions = c.recommendedActions;
      }
      const strength = evidenceStrength(c.confidence);
      if (EVIDENCE_RANK[strength] > EVIDENCE_RANK[event.evidence]) event.evidence = strength;
      event.indicators = mergeIndicators(event.indicators, c.indicators);
    }

    // Ongoing events whose candidate the engine has resolved are over.
    const resolved = new Set(assessment.recentlyResolved.map((c) => c.id));
    for (const e of this.events) {
      if (e.status === 'ongoing' && !seen.has(e.id) && e.candidateIds.some((id) => resolved.has(id))) {
        this.end(e, now, 'resolved');
      }
    }
    this.sweep(now, false);
    this.emit();
  }

  // Ends events with no fresh evidence and drops expired ones. Call it
  // regularly, also while no frames arrive (paused, camera lost).
  sweep(now: number, notify = true) {
    let changed = false;
    for (const e of this.events) {
      if (e.status === 'ongoing' && now - e.lastSeenAt > this.config.staleMs) {
        this.end(e, e.lastSeenAt, 'stale');
        changed = true;
      }
    }
    const before = this.events.length;
    this.events = this.events
      .filter((e) => e.status === 'ongoing' || now - (e.endedAt ?? e.lastSeenAt) <= this.config.expireMs)
      .slice(0, this.config.maxEvents);
    if (notify && (changed || this.events.length !== before)) this.emit();
  }

  // Monitoring stopped: nothing can be ongoing any more.
  endAll(now: number, reason: ThreatEventEndReason = 'stopped') {
    let changed = false;
    for (const e of this.events) {
      if (e.status === 'ongoing') {
        this.end(e, now, reason);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  clear() {
    this.events = [];
    this.emit();
  }

  // Ongoing first, then most recent.
  list(): ThreatEvent[] {
    return [...this.events]
      .sort((a, b) => (a.status === b.status ? b.lastSeenAt - a.lastSeenAt : a.status === 'ongoing' ? -1 : 1))
      .map((e) => ({ ...e, indicators: [...e.indicators], candidateIds: [...e.candidateIds], trackIds: [...e.trackIds] }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private end(e: ThreatEvent, at: number, reason: ThreatEventEndReason) {
    e.status = 'ended';
    e.endReason = reason;
    e.endedAt = at;
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

function mergeIndicators(existing: ThreatIndicator[], incoming: ThreatIndicator[]): ThreatIndicator[] {
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const i of incoming) {
    const prev = byId.get(i.id);
    byId.set(i.id, prev && prev.weight > i.weight ? { ...prev, label: i.label } : i);
  }
  return [...byId.values()].sort((a, b) => b.weight - a.weight).slice(0, 5);
}

// One log for the app's lifetime, so events survive leaving and reopening
// the monitor screen. Cleared when the app process ends.
export const sessionThreatEvents = new ThreatEventLog();
