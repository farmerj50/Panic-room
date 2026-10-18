import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { DetectionState, DetectorStatus } from '../threat/events/detectionState';
import type { ThreatEvent } from '../threat/events/ThreatEventLog';
import {
  EVIDENCE_LABEL,
  NOT_CONFIRMED_NOTE,
  RELIABILITY_LABEL,
  SEVERITY_LABEL,
  THREAT_LABEL,
  UNCALIBRATED_NOTE,
  clockTime,
} from '../threat/presentation';
import type { SourceReliability } from '../threat/types';

type Props = {
  threatsEnabled: boolean;
  detection: DetectionState;
  detectors: DetectorStatus[];
  events: ThreatEvent[];
  reliability: SourceReliability | null;
  onClearEvents: () => void;
};

const STATE_TONE: Record<DetectionState['kind'], 'neutral' | 'ok' | 'caution' | 'alert'> = {
  off: 'neutral',
  disabled: 'neutral',
  failed: 'caution',
  warming_up: 'neutral',
  unreliable_input: 'caution',
  detector_unavailable: 'caution',
  candidates: 'alert',
  insufficient_evidence: 'neutral',
  no_threat: 'ok',
};

const DETECTOR_STATE_LABEL: Record<DetectorStatus['state'], string> = {
  active: 'Watching',
  paused: 'Paused',
  disabled: 'Not enabled',
  off: 'Off',
};

// AI Threat Monitor dashboard (Phase 2, development/test builds). Shows
// what the on-device analysis observed, with its uncertainty. It never acts:
// SOS stays a deliberate tap on the button below it.
export default function ThreatDashboard({ threatsEnabled, detection, detectors, events, reliability, onClearEvents }: Props) {
  const tone = STATE_TONE[detection.kind];
  return (
    <View style={styles.wrap} testID="threat-dashboard">
      <View
        style={[styles.banner, styles[tone]]}
        testID="threat-status"
        accessibilityLabel={`threat-status-${detection.kind}`}
      >
        <Text style={styles.bannerTitle}>{detection.title}</Text>
        <Text style={styles.bannerDetail}>{detection.detail}</Text>
      </View>

      {threatsEnabled && reliability && (
        <View style={styles.row} testID="threat-reliability" accessibilityLabel={`threat-reliability-${reliability.level}`}>
          <Text style={styles.rowLabel}>Camera input</Text>
          <Text style={styles.rowValue}>
            {RELIABILITY_LABEL[reliability.level]}
            {reliability.reasons.length ? ` — ${reliability.reasons[0]}` : ''}
          </Text>
        </View>
      )}

      {threatsEnabled && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Events</Text>
            {events.length > 0 && (
              <TouchableOpacity onPress={onClearEvents} testID="threat-events-clear">
                <Text style={styles.link}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          {events.length === 0 ? (
            <Text style={styles.muted} testID="threat-events-empty">
              No events this session.
            </Text>
          ) : (
            events.map((e) => <EventCard key={e.id} event={e} />)
          )}
        </View>
      )}

      <View style={styles.section} testID="threat-detectors">
        <Text style={styles.sectionTitle}>What Bes looks for</Text>
        {detectors.map((d) => (
          <View key={d.type} style={styles.detector} testID={`threat-detector-${d.type}`} accessibilityLabel={`threat-detector-${d.type}-${d.state}`}>
            <Text style={styles.detectorName}>{d.label}</Text>
            <Text style={[styles.detectorState, d.state === 'active' && styles.detectorOn]}>
              {DETECTOR_STATE_LABEL[d.state]}
              {d.reason ? ` — ${d.reason}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EventCard({ event }: { event: ThreatEvent }) {
  const ongoing = event.status === 'ongoing';
  const ended =
    event.endReason === 'stale'
      ? `No fresh evidence since ${clockTime(event.lastSeenAt)}`
      : event.endReason === 'stopped'
        ? `Monitoring stopped at ${clockTime(event.endedAt ?? event.lastSeenAt)}`
        : `No longer seen since ${clockTime(event.endedAt ?? event.lastSeenAt)}`;
  return (
    <View
      style={[styles.card, ongoing ? styles.cardOngoing : styles.cardEnded]}
      testID={`threat-event-${event.id}`}
      accessibilityLabel={`threat-event-${event.type}-${event.status}`}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{THREAT_LABEL[event.type]}</Text>
        <Text style={[styles.severity, styles[`sev_${event.severity}`]]} testID="threat-event-severity">
          {SEVERITY_LABEL[event.severity]}
        </Text>
      </View>
      <Text style={styles.status}>{ongoing ? 'Ongoing' : ended}</Text>
      <Text style={styles.muted}>
        First seen {clockTime(event.firstSeenAt)} · Last seen {clockTime(event.lastSeenAt)}
        {event.repeats > 0 ? ` · Seen again ${event.repeats}×` : ''}
      </Text>
      <Text style={styles.evidence} testID="threat-event-evidence">
        {EVIDENCE_LABEL[event.evidence]} · {UNCALIBRATED_NOTE}
      </Text>
      <Text style={styles.subTitle}>What was observed</Text>
      {event.indicators.map((i) => (
        <Text key={i.id} style={styles.bullet}>
          • {i.label}
        </Text>
      ))}
      <Text style={styles.subTitle}>General safety advice</Text>
      {event.recommendedActions.map((a) => (
        <Text key={a} style={styles.bullet}>
          • {a}
        </Text>
      ))}
      <Text style={styles.note} testID="threat-event-not-confirmed">
        {NOT_CONFIRMED_NOTE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  banner: { borderRadius: 14, borderWidth: 1, gap: 2, padding: 12 },
  neutral: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' },
  ok: { backgroundColor: 'rgba(52,211,153,0.10)', borderColor: 'rgba(52,211,153,0.4)' },
  caution: { backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.45)' },
  alert: { backgroundColor: 'rgba(239,68,91,0.14)', borderColor: 'rgba(239,68,91,0.55)' },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  bannerDetail: { color: '#cfc8e6', fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  rowLabel: { color: '#a8a0bf', fontSize: 13, fontWeight: '700' },
  rowValue: { color: '#fff', flex: 1, fontSize: 13, fontWeight: '700' },
  section: { gap: 8 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  link: { color: '#c9b8ff', fontSize: 13, fontWeight: '800' },
  muted: { color: '#a8a0bf', fontSize: 12, fontWeight: '600' },
  card: { borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
  cardOngoing: { backgroundColor: 'rgba(239,68,91,0.10)', borderColor: 'rgba(239,68,91,0.5)' },
  cardEnded: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)' },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
  severity: { borderRadius: 999, fontSize: 11, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2 },
  sev_low: { backgroundColor: 'rgba(255,255,255,0.12)', color: '#e6e1f5' },
  sev_moderate: { backgroundColor: 'rgba(251,191,36,0.25)', color: '#fde68a' },
  sev_high: { backgroundColor: 'rgba(239,68,91,0.35)', color: '#fecdd3' },
  status: { color: '#fff', fontSize: 13, fontWeight: '800' },
  evidence: { color: '#e6e1f5', fontSize: 12, fontWeight: '700' },
  subTitle: { color: '#c9b8ff', fontSize: 12, fontWeight: '900', marginTop: 4 },
  bullet: { color: '#e6e1f5', fontSize: 13 },
  note: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginTop: 4 },
  detector: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  detectorName: { color: '#e6e1f5', fontSize: 13, fontWeight: '700' },
  detectorState: { color: '#a8a0bf', flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  detectorOn: { color: '#34d399' },
});
