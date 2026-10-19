import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { MonitorStatus } from '../hooks/useThreatMonitor';

type Props = {
  status: MonitorStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  // Camera flip, when that feature is on.
  onFlip?: (() => void) | null;
  flipping?: boolean;
  facing?: 'back' | 'front';
};

export default function MonitorControls({ status, onStart, onPause, onResume, onStop, onFlip, flipping, facing }: Props) {
  const on = status === 'starting' || status === 'running' || status === 'paused';
  // Flipping waits while the camera starts, while paused and during a flip.
  const flipDisabled = flipping || (status !== 'running' && status !== 'idle');
  const flipButton = onFlip ? (
    <TouchableOpacity
      style={[styles.btn, flipDisabled && styles.disabled]}
      onPress={onFlip}
      disabled={flipDisabled}
      testID="ai-monitor-flip-btn"
      accessibilityLabel={`ai-monitor-flip-btn-${facing ?? 'back'}`}
    >
      <Text style={styles.text}>{facing === 'front' ? 'Back camera' : 'Front camera'}</Text>
    </TouchableOpacity>
  ) : null;
  if (!on) {
    return (
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={onStart} testID="ai-monitor-start-btn" accessibilityLabel="ai-monitor-start-btn">
          <Text style={styles.primaryText}>Start monitoring</Text>
        </TouchableOpacity>
        {flipButton}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {status === 'paused' ? (
        <TouchableOpacity style={styles.btn} onPress={onResume} testID="ai-monitor-resume-btn" accessibilityLabel="ai-monitor-resume-btn">
          <Text style={styles.text}>Resume</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.btn, status !== 'running' && styles.disabled]}
          onPress={onPause}
          disabled={status !== 'running'}
          testID="ai-monitor-pause-btn"
          accessibilityLabel="ai-monitor-pause-btn"
        >
          <Text style={styles.text}>Pause</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.btn} onPress={onStop} testID="ai-monitor-stop-btn" accessibilityLabel="ai-monitor-stop-btn">
        <Text style={styles.text}>Stop</Text>
      </TouchableOpacity>
      {flipButton}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  btn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  primary: { backgroundColor: '#7a57d6', borderColor: '#7a57d6' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  text: { color: '#fff', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
