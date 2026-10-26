import { StyleSheet, Switch, Text, View } from 'react-native';

import { BEHAVIOR_LABEL, type BehaviorEvent, type BehaviorSnapshot, type BehaviorStatus } from '../services/BehaviorEventEngine';

type Props = {
  running: boolean;
  snapshot: BehaviorSnapshot | null;
  alertsOn: boolean;
  onAlertsChange: (on: boolean) => void;
};

const STATUS_TEXT: Record<BehaviorStatus, string> = {
  active: 'Seen for a few seconds',
  emerging: 'Building',
  uncertain: 'Unsure',
  ended: 'Ended',
};

// Movement between people, as candidates with their reasons and limits.
// Never contacts anyone or starts Emergency; the banner is opt-in.
export default function BehaviorEventsPanel({ running, snapshot, alertsOn, onAlertsChange }: Props) {
  const events = running ? snapshot?.events ?? [] : [];
  const ended = running ? (snapshot?.recentlyEnded ?? []).slice(-2) : [];
  const header = !running
    ? 'Starts when monitoring is on.'
    : snapshot?.abstaining
      ? `Can’t judge right now: ${snapshot.abstaining.toLowerCase()}.`
      : events.length
        ? null
        : 'Watching how people move around each other.';
  return (
    <View style={styles.card} testID="ai-behavior-panel">
      <View style={styles.row}>
        <Text style={styles.title}>Movement between people</Text>
        <Text style={styles.beta}>Beta</Text>
      </View>
      {header && (
        <Text style={styles.header} testID="ai-behavior-state">
          {header}
        </Text>
      )}
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {ended.map((e) => (
        <Text key={e.id} style={styles.ended} testID={`ai-behavior-ended-${e.kind}`}>
          {BEHAVIOR_LABEL[e.kind]} ({e.trackIds.map((id) => `#${id}`).join(', ')}) — ended
        </Text>
      ))}
      <View style={styles.row}>
        <Text style={styles.label}>Show a banner for new movement events</Text>
        <Switch value={alertsOn} onValueChange={onAlertsChange} testID="ai-behavior-alert-switch" accessibilityLabel="ai-behavior-alert-switch" />
      </View>
      <Text style={styles.note}>Based on movement in the camera view. It can be wrong, and it never contacts anyone.</Text>
    </View>
  );
}

function EventRow({ event }: { event: BehaviorEvent }) {
  const ids = event.trackIds.map((id) => `#${id}`).join(', ');
  return (
    <View style={styles.event} testID={`ai-behavior-event-${event.kind}`} accessibilityLabel={`ai-behavior-event-${event.kind}-${event.status}`}>
      <View style={styles.row}>
        <Text style={styles.eventTitle}>
          {BEHAVIOR_LABEL[event.kind]} ({ids})
        </Text>
        <Text style={[styles.pill, event.status === 'active' && styles.pillActive]}>{STATUS_TEXT[event.status]}</Text>
      </View>
      <Text style={styles.detail}>
        {event.observations.join(' · ')} · {Math.round(event.confidence * 100)}% confidence
      </Text>
      {event.uncertainty.length > 0 && <Text style={styles.limits}>Limited by: {event.uncertainty.join('; ')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, gap: 8, padding: 12 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  title: { color: '#fff', flex: 1, fontSize: 15, fontWeight: '900' },
  beta: { color: '#c9b8ff', fontSize: 12, fontWeight: '800' },
  header: { color: '#a8a0bf', fontSize: 13, fontWeight: '700' },
  event: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, gap: 4, padding: 8 },
  eventTitle: { color: '#fff', flex: 1, fontSize: 14, fontWeight: '800' },
  pill: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2 },
  pillActive: { backgroundColor: '#fbbf24', color: '#1a1300' },
  detail: { color: '#d6d0ea', fontSize: 12 },
  limits: { color: '#a8a0bf', fontSize: 12 },
  ended: { color: '#8e88a8', fontSize: 12 },
  label: { color: '#fff', flex: 1, fontSize: 13, fontWeight: '700' },
  note: { color: '#a8a0bf', fontSize: 12 },
});
