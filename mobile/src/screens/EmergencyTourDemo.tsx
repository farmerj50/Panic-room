import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTourTarget } from '../context/TourContext';
import { contentColumn } from '../config/layout';

// Deliberately imports nothing from EmergencyContext, camera, location, or
// notification code. The tour's Emergency walkthrough renders this instead of
// the live screen, so no activation path can run from it.
export default function EmergencyTourDemo() {
  const cameraRef = useTourTarget<View>('emergency-camera');
  const locationRef = useTourTarget<View>('emergency-location');
  const callRef = useTourTarget<View>('emergency-911');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.column}>
        <View style={styles.banner} testID="emergency-tour-banner">
          <Text style={styles.bannerTitle}>Tour demo</Text>
          <Text style={styles.bannerText}>Nothing is being activated.</Text>
        </View>

        <View ref={cameraRef} style={styles.cameraPanel} testID="emergency-camera">
          <Text style={styles.panelLabel}>Evidence capture</Text>
          <Text style={styles.panelText}>Camera preview appears here during a real emergency.</Text>
        </View>

        <View ref={locationRef} style={styles.locationPanel} testID="emergency-location">
          <Text style={styles.panelLabel}>Live location</Text>
          <Text style={styles.panelText}>Your location is shared with trusted contacts during a real emergency.</Text>
        </View>

        <View style={styles.callPanel}>
          <View ref={callRef} style={styles.disabledCallBtn} testID="emergency-911">
            <Text style={styles.disabledCallText}>Demo: 911 is not called</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050715',
  },
  column: {
    flex: 1,
    gap: 16,
    padding: 20,
    ...contentColumn,
  },
  banner: {
    backgroundColor: 'rgba(124,58,237,0.18)',
    borderColor: 'rgba(199,140,255,0.4)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  bannerTitle: { color: '#d7b4ff', fontSize: 14, fontWeight: '800' },
  bannerText: { color: '#d8d2e8', fontSize: 13, marginTop: 4 },
  cameraPanel: {
    backgroundColor: '#0d1231',
    borderRadius: 20,
    minHeight: 180,
    padding: 18,
    justifyContent: 'center',
  },
  locationPanel: {
    backgroundColor: '#0d1231',
    borderRadius: 20,
    padding: 18,
  },
  panelLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
  panelText: { color: '#aaa', fontSize: 13, lineHeight: 19, marginTop: 6 },
  callPanel: { marginTop: 'auto' },
  disabledCallBtn: {
    alignItems: 'center',
    backgroundColor: '#3a1d24',
    borderRadius: 24,
    paddingVertical: 16,
    opacity: 0.6,
  },
  disabledCallText: { color: '#f4b6c0', fontSize: 15, fontWeight: '800' },
});
