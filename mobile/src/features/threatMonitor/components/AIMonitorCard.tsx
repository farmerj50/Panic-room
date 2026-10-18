import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { isAiMonitorEnabled } from '../config/threatMonitorConfig';

// Home entry for the AI Monitor beta. Hidden unless the rollout flag is on.
export default function AIMonitorCard() {
  const navigation = useNavigation<any>();
  if (!isAiMonitorEnabled()) return null;
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={styles.card}
      onPress={() => navigation.navigate('AIMonitor')}
      testID="home-ai-monitor-card"
      accessibilityLabel="home-ai-monitor-card"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>AI Monitor</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Beta</Text>
        </View>
      </View>
      <Text style={styles.body}>
        Use your camera to see how many people are around you and how they're moving. Processed on this phone —
        nothing is recorded or uploaded.
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(122,87,214,0.12)',
    borderColor: 'rgba(122,87,214,0.55)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    marginTop: 18,
    padding: 18,
    width: '100%',
  },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { color: '#fff', flex: 1, fontSize: 17, fontWeight: '800' },
  badge: { backgroundColor: '#7a57d6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  body: { color: '#d8d0e8', fontSize: 14, lineHeight: 20 },
});
