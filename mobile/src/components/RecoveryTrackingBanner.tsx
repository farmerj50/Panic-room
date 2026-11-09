import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  getRecoveryTracking,
  markPhoneRecovered,
  subscribeToRecoveryTracking,
  type RecoveryState,
} from '../services/recoveryTracking';

// Shown on this phone while it is in recovery tracking, with the one control
// that ends it here: "Phone recovered".
export default function RecoveryTrackingBanner() {
  const [state, setState] = useState<RecoveryState | null>(null);

  useEffect(() => {
    let alive = true;
    getRecoveryTracking().then((s) => alive && setState(s));
    const unsubscribe = subscribeToRecoveryTracking((s) => setState(s));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!state) return null;

  const confirm = () =>
    Alert.alert('Phone recovered?', "Recovery tracking stops and can't be restarted for this emergency.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Phone recovered', style: 'destructive', onPress: () => void markPhoneRecovered() },
    ]);

  return (
    <View style={styles.banner} testID="recovery-tracking-banner" accessible={false}>
      <Text style={styles.title}>Recovery tracking is on</Text>
      <Text style={styles.body}>
        This phone's location is shared with your trusted contacts until you mark it recovered. Stops automatically{' '}
        {new Date(state.expiresAt).toLocaleString()}.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={confirm}
        testID="phone-recovered-btn"
        accessibilityLabel="phone-recovered-btn"
      >
        <Text style={styles.buttonText}>Phone recovered</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#3a2a0a', borderColor: '#f5c542', borderRadius: 14, borderWidth: 1, gap: 6, margin: 16, padding: 14 },
  title: { color: '#f5c542', fontSize: 15, fontWeight: '800' },
  body: { color: '#f3e7c4', fontSize: 13 },
  button: { alignSelf: 'flex-start', backgroundColor: '#f5c542', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  buttonText: { color: '#2a1e05', fontWeight: '800' },
});
