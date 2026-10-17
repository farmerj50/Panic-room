import { StyleSheet, Text, View } from 'react-native';

import type { MonitorFrame } from '../models/types';

const DENSITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;

// Phase 1 measurements only — no threat labels.
export default function CrowdMetricsPanel({ frame }: { frame: MonitorFrame | null }) {
  const m = frame?.crowdMetrics;
  return (
    <View style={styles.panel} testID="ai-monitor-metrics">
      <Metric label="People" value={frame ? String(frame.peopleCount) : '—'} testID="ai-monitor-people-count" />
      <Metric label="Estimated density" value={m ? DENSITY_LABEL[m.estimatedVisualDensity] : '—'} />
      <Metric
        label="Fast movement"
        value={!m ? '—' : m.motionReliable ? String(m.rapidMovementCount) : 'Phone moving'}
      />
      <Metric label="Analysis" value={frame ? `${frame.inferenceMs} ms` : '—'} />
    </View>
  );
}

function Metric({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.value} testID={testID} accessibilityLabel={testID ? `${testID}-${value}` : undefined}>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    paddingVertical: 10,
  },
  metric: { alignItems: 'center', flex: 1, gap: 2 },
  value: { color: '#fff', fontSize: 17, fontWeight: '900' },
  label: { color: '#a8a0bf', fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
