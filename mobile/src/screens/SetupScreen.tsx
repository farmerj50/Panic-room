import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';

import { useEmergencyContext } from '../context/EmergencyContext';

type PermStatus = 'unknown' | 'granted' | 'denied';

function toStatus(granted: boolean | undefined): PermStatus {
  if (granted === undefined) return 'unknown';
  return granted ? 'granted' : 'denied';
}

export default function SetupScreen() {
  const navigation = useNavigation();
  const { markSetupDone, isSetupDone } = useEmergencyContext();

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [locStatus, setLocStatus] = useState<PermStatus>('unknown');

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ granted }) => setLocStatus(toStatus(granted)))
      .catch(() => {});
  }, []);

  const camStatus = toStatus(cameraPermission?.granted);
  const micStatus = toStatus(micPermission?.granted);
  const coreGranted = camStatus === 'granted' && micStatus === 'granted' && locStatus === 'granted';

  const handleRequestCamera = async () => {
    const result = await requestCamera();
    if (!result?.granted) openSettings('Camera');
  };

  const handleRequestMic = async () => {
    const result = await requestMic();
    if (!result?.granted) openSettings('Microphone');
  };

  const handleRequestLoc = async () => {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    setLocStatus(toStatus(granted));
    if (!granted) openSettings('Location');
  };

  const openSettings = (permission: string) => {
    if (Platform.OS === 'web') {
      Alert.alert(
        `${permission} Access Required`,
        `Use the site settings icon next to the address bar and set ${permission.toLowerCase()} to Allow for this site.`,
      );
      return;
    }

    Alert.alert(
      `${permission} Access Required`,
      `Bes needs ${permission.toLowerCase()} access. Open Settings to enable it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ],
    );
  };

  const requestCorePermissions = async () => {
    let cameraGranted = camStatus === 'granted';
    let micGranted = micStatus === 'granted';
    let locationGranted = locStatus === 'granted';

    if (!cameraGranted) {
      const result = await requestCamera();
      cameraGranted = Boolean(result?.granted);
    }

    if (!micGranted) {
      const result = await requestMic();
      micGranted = Boolean(result?.granted);
    }

    if (!locationGranted) {
      const result = await Location.requestForegroundPermissionsAsync();
      locationGranted = Boolean(result?.granted);
      setLocStatus(toStatus(result?.granted));
    }

    if (!cameraGranted) openSettings('Camera');
    else if (!micGranted) openSettings('Microphone');
    else if (!locationGranted) openSettings('Location');

    return cameraGranted && micGranted && locationGranted;
  };

  const handleFinish = async () => {
    const granted = coreGranted || (await requestCorePermissions());

    if (!granted) {
      Alert.alert(
        'Permissions needed',
        'Camera, microphone, and location are required for Bes to protect you.',
      );
      return;
    }
    await markSetupDone();
    Alert.alert('Setup Complete', 'Bes is ready to protect you.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.82} onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Setup</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Required Permissions</Text>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.sectionSub}>These are needed for Bes to protect you during an emergency.</Text>

          <TouchableOpacity activeOpacity={0.84} style={styles.grantAllBtn} onPress={requestCorePermissions}>
            <Text style={styles.grantAllText}>Grant Required Access</Text>
          </TouchableOpacity>

          <PermRow
            icon="C" color="#4aa8ff" title="Camera"
            description="Records video evidence automatically when emergency is activated"
            status={camStatus} onRequest={handleRequestCamera}
          />
          <PermRow
            icon="M" color="#b777ff" title="Microphone"
            description="Records audio automatically when emergency is activated"
            status={micStatus} onRequest={handleRequestMic}
          />
          <PermRow
            icon="L" color="#ff6b9a" title="Location"
            description="Sends your GPS coordinates to emergency contacts and 911"
            status={locStatus} onRequest={handleRequestLoc}
            last
          />
        </LinearGradient>

        <Text style={styles.sectionLabel}>Emergency Contacts</Text>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.sectionSub}>
            Add trusted contacts who will receive your GPS location during an emergency.
          </Text>
          <NavRow label="Manage Emergency Contacts" onPress={() => (navigation as any).navigate('Contacts')} />
        </LinearGradient>

        <Text style={styles.sectionLabel}>App Lock</Text>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.sectionSub}>
            Set a PIN so Bes asks for it when the app opens. Emergency access (the shield icon, logo
            gestures, and "I Need Help Now") always works, even when Bes is locked.
          </Text>
          <NavRow label="App Lock Settings" onPress={() => (navigation as any).navigate('PinSetup')} />
        </LinearGradient>

        <Text style={styles.sectionLabel}>Decoy Mode</Text>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.sectionSub}>
            Show a calculator instead of Bes when triggered — Bes keeps running underneath and comes
            right back.
          </Text>
          <NavRow label="Decoy Mode Settings" onPress={() => (navigation as any).navigate('DecoySettings')} />
        </LinearGradient>

        <Text style={styles.sectionLabel}>Lock Screen & Background</Text>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.sectionSub}>
            Configure the lock screen SOS button and background GPS — requires notification and
            "always" location permissions.
          </Text>
          <NavRow label="Emergency Settings" onPress={() => (navigation as any).navigate('EmergencySettings')} />
        </LinearGradient>

        <TouchableOpacity
          activeOpacity={0.86}
          style={[
            styles.finishBtn,
            isSetupDone && styles.finishBtnDone,
            !coreGranted && styles.finishBtnDisabled,
          ]}
          onPress={handleFinish}
        >
          <Text style={styles.finishBtnText}>
            {isSetupDone ? '✓ Setup Complete' : 'Finish Setup'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          You can change permissions at any time in your phone's Settings › Bes.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.84} style={styles.navRow} onPress={onPress}>
      <Text style={styles.navRowText}>{label}</Text>
      <Text style={styles.navRowArrow}>{'>'}</Text>
    </TouchableOpacity>
  );
}

function PermRow({
  icon, color, title, description, status, onRequest, last,
}: {
  icon: string;
  color: string;
  title: string;
  description: string;
  status: PermStatus;
  onRequest: () => void;
  last?: boolean;
}) {
  const granted = status === 'granted';
  return (
    <View style={[styles.permRow, !last && styles.permRowBorder]}>
      <View style={[styles.permIcon, { backgroundColor: `${color}22` }]}>
        <Text style={[styles.permIconText, { color }]}>{icon}</Text>
      </View>
      <View style={styles.permBody}>
        <Text style={styles.permTitle}>{title}</Text>
        <Text style={styles.permDesc}>{description}</Text>
      </View>
      <TouchableOpacity
        style={[styles.permBtn, granted && styles.permBtnGranted]}
        onPress={onRequest}
        disabled={granted}
      >
        <Text style={[styles.permBtnText, granted && styles.permBtnTextGranted]}>
          {granted ? '✓' : status === 'unknown' ? 'Allow' : 'Retry'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    marginBottom: 6,
  },
  headerSpacer: { height: 38, width: 38 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(199,140,255,0.24)',
    borderRadius: 19,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconButtonText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  scroll: { padding: 18, paddingBottom: 48, maxWidth: 620, width: '100%', alignSelf: 'center' },
  sectionLabel: {
    color: '#b8afca',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 12,
    marginLeft: 4,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  card: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 22,
    padding: 18,
  },
  sectionSub: { color: '#a9a1bd', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  grantAllBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    marginBottom: 16,
    minHeight: 50,
    justifyContent: 'center',
  },
  grantAllText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  permRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 12,
  },
  permRowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  permIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  permIconText: { fontSize: 16, fontWeight: '900' },
  permBody: { flex: 1 },
  permTitle: { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 3 },
  permDesc: { color: '#a9a1bd', fontSize: 12, lineHeight: 17 },
  permBtn: {
    borderColor: '#7c3aed',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  permBtnGranted: { backgroundColor: 'rgba(53,225,207,0.14)', borderColor: '#35e1cf' },
  permBtnText: { color: '#d9bcff', fontSize: 13, fontWeight: '700' },
  permBtnTextGranted: { color: '#35e1cf' },
  navRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
  },
  navRowText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  navRowArrow: { color: '#b8aacd', fontSize: 20, fontWeight: '300' },
  finishBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 54,
  },
  finishBtnDone: { backgroundColor: '#12c48b' },
  finishBtnDisabled: { backgroundColor: 'rgba(124,58,237,0.4)' },
  finishBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  footerNote: {
    color: '#8b839f',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 18,
    textAlign: 'center',
  },
});
