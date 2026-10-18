import type { MonitorFrame } from '../models/types';
import { NOT_YET_SUPPORTED, THREAT_DETECTORS } from '../threat/detectors';
import { detectionState, detectorStatuses } from '../threat/events/detectionState';
import { ThreatEventLog } from '../threat/events/ThreatEventLog';
import { evidenceStrength } from '../threat/presentation';
import type { Severity, SourceReliability, ThreatAssessment, ThreatCandidate, ThreatType } from '../threat/types';
import { syntheticFrame } from '../threat/validation/syntheticFrames';

const reliability = (level: SourceReliability['level'] = 'good'): SourceReliability => ({
  level,
  analyzedFps: 8,
  motionReliableShare: 1,
  meanDetectionScore: 0.8,
  poseCoverage: 1,
  reasons: level === 'good' ? [] : ['Few frames analyzed'],
});

const candidate = (id: string, type: ThreatType, opts: { severity?: Severity; confidence?: number; indicator?: string } = {}): ThreatCandidate => ({
  id,
  type,
  status: 'emerging',
  severity: opts.severity ?? 'moderate',
  confidence: opts.confidence ?? 0.5,
  calibrated: false,
  firstSeenAt: 0,
  lastSeenAt: 0,
  trackIds: [1],
  indicators: [{ id: opts.indicator ?? 'i1', label: `${opts.indicator ?? 'i1'} label`, weight: 0.5 }],
  sourceReliability: reliability(),
  recommendedActions: [`advice for ${type}`],
});

const assessment = (candidates: ThreatCandidate[] = [], extra: Partial<ThreatAssessment> = {}): ThreatAssessment => ({
  timestamp: 0,
  candidates,
  recentlyResolved: [],
  sourceReliability: reliability(),
  unavailable: [],
  building: [],
  ...extra,
});

const CONFIG = { staleMs: 5_000, cooldownMs: 60_000, expireMs: 600_000, maxEvents: 20 };
const T0 = 1_700_000_000_000;

describe('ThreatEventLog', () => {
  it('turns a candidate into one event and keeps updating it', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall')]), T0);
    log.ingest(assessment([candidate('c1', 'fall', { indicator: 'i2' })]), T0 + 500);
    const [e] = log.list();
    expect(log.list()).toHaveLength(1);
    expect(e).toEqual(expect.objectContaining({ type: 'fall', status: 'ongoing', firstSeenAt: T0, lastSeenAt: T0 + 500, repeats: 0, calibrated: false }));
    expect(e.indicators.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('deduplicates: a new candidate of the same kind within the cooldown joins the event', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'crowd_panic')]), T0);
    log.ingest(assessment([], { recentlyResolved: [candidate('c1', 'crowd_panic')] }), T0 + 1_000);
    expect(log.list()[0].status).toBe('ended');
    log.ingest(assessment([candidate('c2', 'crowd_panic')]), T0 + 30_000);
    const events = log.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ status: 'ongoing', repeats: 1, candidateIds: ['c1', 'c2'] }));
  });

  it('raises a new event once the cooldown has passed', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'crowd_panic')]), T0);
    log.ingest(assessment([candidate('c2', 'crowd_panic')]), T0 + 61_000);
    expect(log.list()).toHaveLength(2);
  });

  it('keeps different kinds of events separate', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'crowd_panic'), candidate('c2', 'sudden_dispersal')]), T0);
    expect(log.list().map((e) => e.type).sort()).toEqual(['crowd_panic', 'sudden_dispersal']);
  });

  it('ends an event when the engine resolves its candidate', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall')]), T0);
    log.ingest(assessment([], { recentlyResolved: [candidate('c1', 'fall')] }), T0 + 2_000);
    expect(log.list()[0]).toEqual(expect.objectContaining({ status: 'ended', endReason: 'resolved', endedAt: T0 + 2_000 }));
  });

  it('marks an event stale when no fresh evidence arrives (e.g. paused, camera lost)', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall')]), T0);
    log.sweep(T0 + 4_000);
    expect(log.list()[0].status).toBe('ongoing');
    log.sweep(T0 + 6_000);
    expect(log.list()[0]).toEqual(expect.objectContaining({ status: 'ended', endReason: 'stale', endedAt: T0 }));
  });

  it('expires ended events after a while', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall')]), T0);
    log.endAll(T0 + 1_000);
    log.sweep(T0 + 1_000 + 599_000);
    expect(log.list()).toHaveLength(1);
    log.sweep(T0 + 1_000 + 601_000);
    expect(log.list()).toHaveLength(0);
  });

  it('ends everything when monitoring stops', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall'), candidate('c2', 'crowd_surge')]), T0);
    log.endAll(T0 + 100);
    expect(log.list().every((e) => e.status === 'ended' && e.endReason === 'stopped')).toBe(true);
  });

  it('only escalates severity and evidence, with matching advice', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall', { severity: 'moderate', confidence: 0.5 })]), T0);
    const high = { ...candidate('c1', 'fall', { severity: 'high', confidence: 0.8 }), recommendedActions: ['high advice'] };
    log.ingest(assessment([high]), T0 + 200);
    log.ingest(assessment([candidate('c1', 'fall', { severity: 'low', confidence: 0.2 })]), T0 + 400);
    expect(log.list()[0]).toEqual(expect.objectContaining({ severity: 'high', evidence: 'strong', recommendedActions: ['high advice'] }));
  });

  it('never exposes confidence as a number', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('c1', 'fall', { confidence: 0.62 })]), T0);
    const e = log.list()[0] as Record<string, unknown>;
    expect(e).not.toHaveProperty('confidence');
    expect(e.evidence).toBe('moderate');
  });

  it('lists ongoing events first, then the most recent', () => {
    const log = new ThreatEventLog(CONFIG);
    log.ingest(assessment([candidate('a', 'fall')]), T0);
    log.endAll(T0 + 10);
    log.ingest(assessment([candidate('b', 'crowd_surge')]), T0 + 20);
    expect(log.list().map((e) => e.type)).toEqual(['crowd_surge', 'fall']);
  });

  it('caps how many events it keeps and notifies listeners', () => {
    const log = new ThreatEventLog({ ...CONFIG, maxEvents: 2, cooldownMs: 0 });
    const listener = jest.fn();
    log.subscribe(listener);
    ['fall', 'crowd_panic', 'crowd_surge'].forEach((t, i) => log.ingest(assessment([candidate(`c${i}`, t as ThreatType)]), T0 + i));
    expect(log.list()).toHaveLength(2);
    expect(listener).toHaveBeenCalled();
    log.clear();
    expect(log.list()).toHaveLength(0);
  });
});

describe('evidence strength', () => {
  it('is qualitative', () => {
    expect([0.2, 0.5, 0.8].map(evidenceStrength)).toEqual(['weak', 'moderate', 'strong']);
  });
});

describe('detection state', () => {
  const frame = (motionReliable = true): MonitorFrame => syntheticFrame(T0, [{ id: 1, x: 0.4, y: 0.3 }], { motionReliable });
  const base = {
    running: true,
    threatsEnabled: true,
    failed: false,
    assessment: assessment(),
    frame: frame(),
    watchedMs: 10_000,
    warmUpMs: 3_000,
    notYetSupported: NOT_YET_SUPPORTED,
  };

  it.each([
    ['disabled', { threatsEnabled: false }],
    ['off', { running: false }],
    ['failed', { failed: true }],
    ['warming_up', { watchedMs: 1_000 }],
    ['warming_up', { assessment: null }],
    ['unreliable_input', { frame: frame(false) }],
    ['unreliable_input', { assessment: assessment([], { sourceReliability: reliability('poor') }) }],
    [
      'detector_unavailable',
      {
        assessment: assessment([], {
          unavailable: (['fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge'] as ThreatType[]).map((type) => ({ type, reason: 'Body pose is not available' })),
        }),
      },
    ],
    ['insufficient_evidence', { assessment: assessment([], { building: ['fall'] }) }],
    ['candidates', { assessment: assessment([candidate('c1', 'fall')]) }],
    ['no_threat', {}],
  ])('reports %s', (kind, overrides) => {
    expect(detectionState({ ...base, ...overrides }).kind).toBe(kind);
  });

  it('keeps a shown candidate as the headline even if the phone starts moving', () => {
    expect(detectionState({ ...base, frame: frame(false), assessment: assessment([candidate('c1', 'fall')]) }).kind).toBe('candidates');
  });

  it('never claims "no threat" while some detectors are paused without saying which', () => {
    const a = assessment([], { unavailable: [{ type: 'fall', reason: 'Body pose is not available' }] });
    expect(detectionState({ ...base, assessment: a }).kind).toBe('no_threat');
    const fall = detectorStatuses(a, { running: true, threatsEnabled: true, notYetSupported: NOT_YET_SUPPORTED }).find((d) => d.type === 'fall');
    expect(fall).toEqual(expect.objectContaining({ state: 'paused', reason: 'Body pose is not available' }));
  });
});

describe('detector availability', () => {
  const opts = { running: true, threatsEnabled: true, notYetSupported: NOT_YET_SUPPORTED };

  it('shows fight and assault detection as not enabled, always', () => {
    for (const o of [opts, { ...opts, running: false }, { ...opts, threatsEnabled: false }]) {
      const s = detectorStatuses(assessment(), o);
      expect(s.find((d) => d.type === 'physical_confrontation')?.state).toBe('disabled');
      expect(s.find((d) => d.type === 'assault')?.state).toBe('disabled');
    }
  });

  it('lists the enabled detectors as watching, off, or not enabled in this build', () => {
    const states = (o: typeof opts, a: ThreatAssessment | null = assessment()) =>
      detectorStatuses(a, o).filter((d) => !NOT_YET_SUPPORTED[d.type]).map((d) => d.state);
    expect(states(opts)).toEqual(['active', 'active', 'active', 'active']);
    expect(states({ ...opts, running: false })).toEqual(['off', 'off', 'off', 'off']);
    expect(states({ ...opts, threatsEnabled: false })).toEqual(['disabled', 'disabled', 'disabled', 'disabled']);
  });
});

describe('enabled detectors', () => {
  it('never include fight or assault detection', () => {
    const types = THREAT_DETECTORS.flatMap((d) => d.types);
    expect(types).not.toContain('physical_confrontation');
    expect(types).not.toContain('assault');
    expect([...new Set(types)].sort()).toEqual(['crowd_panic', 'crowd_surge', 'fall', 'sudden_dispersal']);
  });
});

describe('threat detection flag', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.resetModules();
  });

  const load = (monitor: string | undefined, threats: string | undefined) => {
    process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED = monitor;
    process.env.EXPO_PUBLIC_AI_THREATS_ENABLED = threats;
    let fn: () => boolean = () => false;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      jest.doMock('../services/besVision', () => ({ isBesVisionAvailable: true }));
      fn = require('../config/threatMonitorConfig').isThreatDetectionEnabled;
    });
    return fn();
  };

  it('is on only when both the AI Monitor and threat flags are set', () => {
    expect(load('1', '1')).toBe(true);
    expect(load('1', undefined)).toBe(false);
    expect(load(undefined, '1')).toBe(false);
    expect(load(undefined, undefined)).toBe(false);
  });
});
