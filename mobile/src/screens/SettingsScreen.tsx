import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { TourStepKey, useTour, useTourTarget, useTourTargetPress } from '../context/TourContext';
import { ANDROID_PACKAGE_NAME, PREMIUM_PRODUCT_ID } from '../config/purchasesConfig';

type RowProps = {
  label: string;
  desc: string;
  icon: string;
  color: string;
  onPress: () => void;
  testID: string;
  stepKey: TourStepKey;
};

// Each row owns its target ref and tour press, so hooks run unconditionally.
function SettingsRow({ label, desc, icon, color, onPress, testID, stepKey }: RowProps) {
  const ref = useTourTarget<View>(stepKey);
  const press = useTourTargetPress(stepKey, onPress);
  return (
    <TouchableOpacity
      ref={ref as never}
      activeOpacity={0.84}
      style={styles.row}
      onPress={press}
      testID={testID}
      accessibilityLabel={testID}
    >
      <View style={[styles.icon, { backgroundColor: `${color}24` }]}>
        <Text style={[styles.iconText, { color }]}>{icon}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.desc}>{desc}</Text>
      </View>
      <Text style={styles.arrow}>{'>'}</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { restart: restartTour } = useTour();

  const openPlaySubscriptions = () =>
    Linking.openURL(
      `https://play.google.com/store/account/subscriptions?sku=${PREMIUM_PRODUCT_ID}&package=${ANDROID_PACKAGE_NAME}`,
    );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.8}>
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <SettingsRow
          testID="settings-permissions"
          stepKey="settings-permissions"
          label="Permissions"
          desc="Review camera, microphone, and location access."
          icon="P"
          color="#4ee1d5"
          onPress={() => navigation.navigate('Setup')}
        />
        <SettingsRow
          testID="settings-emergency"
          stepKey="settings-emergency"
          label="Emergency Settings"
          desc="Choose how Bes records and calls during an emergency."
          icon="E"
          color="#ef445b"
          onPress={() => navigation.navigate('EmergencySettings')}
        />
        <SettingsRow
          testID="settings-pro"
          stepKey="settings-pro"
          label="Manage Bes Pro"
          desc="Change plan or cancel through Google Play."
          icon="G"
          color="#4aa8ff"
          onPress={openPlaySubscriptions}
        />
        <SettingsRow
          testID="settings-tour"
          stepKey="settings-tour"
          label="Take a Tour"
          desc="Repeat the walkthrough of Bes."
          icon="T"
          color="#7c3aed"
          onPress={restartTour}
        />
        <SettingsRow
          testID="settings-delete"
          stepKey="settings-delete"
          label="Delete Account"
          desc="Manage account deletion from here."
          icon="D"
          color="#e74c3c"
          onPress={() => navigation.navigate('Main', { screen: 'Profile' })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  back: { padding: 8 },
  backText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  list: { padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1231',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(122,87,214,0.28)',
    padding: 16,
    gap: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 16, fontWeight: '800' },
  copy: { flex: 1 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
  desc: { color: '#aaa', fontSize: 13, marginTop: 2 },
  arrow: { color: '#9e8fc2', fontSize: 18 },
});
