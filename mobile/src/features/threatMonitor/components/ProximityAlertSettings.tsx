import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import type { ProximitySettings } from '../hooks/useThreatMonitor';

type Props = {
  settings: ProximitySettings;
  onChange: (patch: Partial<ProximitySettings>) => void;
};

// Opt-in in-app alert when someone is getting closer in camera view. It only
// shows a banner (and an optional vibration) — it never contacts anyone.
export default function ProximityAlertSettings({ settings, onChange }: Props) {
  return (
    <View style={styles.card} testID="ai-proximity-settings">
      <View style={styles.row}>
        <Text style={styles.label}>Alert when someone is getting closer</Text>
        <Switch
          value={settings.alertEnabled}
          onValueChange={(alertEnabled) => onChange({ alertEnabled })}
          testID="ai-proximity-alert-switch"
          accessibilityLabel="ai-proximity-alert-switch"
        />
      </View>
      {settings.alertEnabled && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Vibrate</Text>
            <Switch
              value={settings.vibrate}
              onValueChange={(vibrate) => onChange({ vibrate })}
              testID="ai-proximity-vibrate-switch"
              accessibilityLabel="ai-proximity-vibrate-switch"
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Sensitivity</Text>
            <View style={styles.segment}>
              {(['normal', 'low'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => onChange({ sensitivity: s })}
                  style={[styles.option, settings.sensitivity === s && styles.optionOn]}
                  testID={`ai-proximity-sensitivity-${s}`}
                  accessibilityLabel={`ai-proximity-sensitivity-${s}`}
                >
                  <Text style={styles.optionText}>{s === 'normal' ? 'Normal' : 'Low'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>
      )}
      <Text style={styles.note}>
        Based on how people move in the camera view. If you walk toward someone, they also show as getting closer.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, gap: 10, padding: 12 },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { color: '#fff', flex: 1, fontSize: 14, fontWeight: '700' },
  segment: { flexDirection: 'row', gap: 6 },
  option: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  optionOn: { backgroundColor: '#7a57d6' },
  optionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  note: { color: '#a8a0bf', fontSize: 12 },
});
