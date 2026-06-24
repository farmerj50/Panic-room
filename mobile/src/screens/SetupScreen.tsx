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
      `PanicRoom needs ${permission.toLowerCase()} access. Open Settings to enable it.`,
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
        'Camera, microphone, and location are required for PanicRoom to protect you.',
      );
      return;
    }
    await markSetupDone();
    Alert.alert('Setup Complete', 'PanicRoom is ready to protect you.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Setup</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        <Text style={styles.sectionTitle}>Required Permissions</Text>
        <Text style={styles.sectionSub}>
          These are needed for PanicRoom to protect you during an emergency.
        </Text>

        <TouchableOpacity activeOpacity={0.82} style={styles.grantAllBtn} onPress={requestCorePermissions}>
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
        />

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Emergency Contacts</Text>
        <Text style={styles.sectionSub}>
          Add trusted contacts who will receive your GPS location during an emergency.
        </Text>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => (navigation as any).navigate('Contacts')}
        >
          <Text style={styles.navBtnText}>Manage Emergency Contacts →</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Lock Screen & Background</Text>
        <Text style={styles.sectionSub}>
          Configure the lock screen SOS button and background GPS — requires
          notification and "always" location permissions.
        </Text>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => (navigation as any).navigate('EmergencySettings')}
        >
          <Text style={styles.navBtnText}>Emergency Settings →</Text>
        </TouchableOpacity>

        <TouchableOpacity
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
          You can change permissions at any time in your phone's Settings › PanicRoom.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PermRow({
  icon, color, title, description, status, onRequest,
}: {
  icon: string;
  color: string;
  title: string;
  description: string;
  status: PermStatus;
  onRequest: () => void;
}) {
  const granted = status === 'granted';
  return (
    <View style={styles.permRow}>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  backText: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  scroll: { padding: 20, paddingBottom: 48 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  sectionSub: { color: '#8b84aa', fontSize: 13, lineHeight: 20, marginBottom: 14 },
  grantAllBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    marginBottom: 14,
    padding: 14,
  },
  grantAllText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  divider: { backgroundColor: 'rgba(90,78,148,0.28)', height: 1, marginVertical: 24 },
  permRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,17,49,0.88)',
    borderColor: 'rgba(90,78,148,0.32)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 10,
    padding: 14,
  },
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
  permDesc: { color: '#9b91bb', fontSize: 12, lineHeight: 17 },
  permBtn: {
    borderColor: '#7C3AED',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  permBtnGranted: { backgroundColor: 'rgba(53,225,207,0.14)', borderColor: '#35e1cf' },
  permBtnText: { color: '#a29bfe', fontSize: 13, fontWeight: '700' },
  permBtnTextGranted: { color: '#35e1cf' },
  navBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,17,49,0.88)',
    borderColor: 'rgba(90,78,148,0.32)',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  navBtnText: { color: '#a29bfe', fontSize: 14, fontWeight: '700' },
  finishBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    marginTop: 24,
    padding: 16,
  },
  finishBtnDone: { backgroundColor: '#10B981' },
  finishBtnDisabled: { backgroundColor: 'rgba(124,58,237,0.4)' },
  finishBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  footerNote: {
    color: '#6b6388',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 20,
    textAlign: 'center',
  },
});
