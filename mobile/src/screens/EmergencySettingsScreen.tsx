import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';

import { type EmergencySettings, useEmergencyContext } from '../context/EmergencyContext';
import {
  disableLockScreenButton,
  enableLockScreenButton,
  isLockScreenButtonEnabled,
  requestNotificationPermission,
} from '../services/lockScreenService';
import {
  isBackgroundLocationRunning,
  startBackgroundLocationMonitoring,
  stopBackgroundLocationMonitoring,
} from '../services/locationService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const heroBg = require('../../assets/images/hero-bg.png');

type CallMode = EmergencySettings['emergencyCallMode'];
type FollowUpAction = EmergencySettings['contactFollowUpAction'];

const CALL_MODE_OPTIONS: Array<{ value: CallMode; title: string; description: string }> = [
  { value: 'emergency', title: 'Call 911', description: 'Open the emergency-number dialer automatically.' },
  { value: 'priority', title: 'Call Primary', description: 'Open your priority contact instead of 911.' },
  { value: 'contacts', title: 'Call Contacts', description: 'Start voice calls to all trusted contacts.' },
  { value: 'ask', title: 'Ask Me', description: 'Show call choices during emergency mode.' },
  { value: 'none', title: 'Alerts Only', description: 'Notify contacts and record without opening a dialer.' },
];

const FOLLOW_UP_OPTIONS: Array<{ value: FollowUpAction; title: string; description: string }> = [
  { value: 'none', title: 'None', description: 'Do not open a second call action.' },
  { value: 'call', title: 'Call Primary', description: 'After 911, open the primary contact dialer.' },
  { value: 'callAll', title: 'Call Contacts', description: 'After 911, start voice calls to all trusted contacts.' },
  { value: 'facetime', title: 'FaceTime Primary', description: 'After 911, open FaceTime for the primary contact.' },
];

export default function EmergencySettingsScreen() {
  const navigation = useNavigation();
  const { emergencySettings, updateEmergencySettings } = useEmergencyContext();

  const [lockScreenActive, setLockScreenActive] = useState(false);
  const [bgLocActive, setBgLocActive] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [lock, bgLoc] = await Promise.all([
      isLockScreenButtonEnabled(),
      isBackgroundLocationRunning(),
    ]);
    setLockScreenActive(lock);
    setBgLocActive(bgLoc);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Lock screen button ────────────────────────────────────────────────────

  const toggleLockScreen = async (value: boolean) => {
    setSaving('lock');
    try {
      if (value) {
        // Check/request notification permission first
        const notifGranted = await requestNotificationPermission();
        if (!notifGranted) {
          Alert.alert(
            'Notification Permission Required',
            'PanicRoom needs notification access to show the lock screen SOS button. Open Settings to enable it.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }
        const ok = await enableLockScreenButton();
        if (!ok) {
          Alert.alert('Error', 'Could not enable the lock screen button. Please try again.');
          return;
        }
        setLockScreenActive(true);
        await updateEmergencySettings({ lockScreenEnabled: true });
        Alert.alert(
          'Lock Screen Button Enabled',
          'You\'ll see a "ACTIVATE SOS" button on your lock screen. Tap it to trigger emergency mode without unlocking your phone.',
        );
      } else {
        await disableLockScreenButton();
        setLockScreenActive(false);
        await updateEmergencySettings({ lockScreenEnabled: false });
      }
    } finally {
      setSaving(null);
    }
  };

  // ── Background location ───────────────────────────────────────────────────

  const toggleBgLocation = async (value: boolean) => {
    setSaving('bgLoc');
    try {
      if (value) {
        const { status } = await Location.getBackgroundPermissionsAsync();
        if (status !== 'granted') {
          // Android: show rationale before the system prompt appears.
          // doStartBgLoc owns setSaving(null) here — don't let finally fire early.
          Alert.alert(
            'Background Location',
            'Select "Allow all the time" on the next screen so PanicRoom can share your GPS even when the app is closed.',
            [{ text: 'Continue', onPress: () => doStartBgLoc() }],
          );
          return; // saving cleared by doStartBgLoc after the alert is dismissed
        }
        await doStartBgLoc();
      } else {
        await stopBackgroundLocationMonitoring();
        setBgLocActive(false);
        await updateEmergencySettings({ backgroundLocationEnabled: false });
        setSaving(null);
      }
    } catch {
      setSaving(null);
    }
  };

  const doStartBgLoc = async () => {
    setSaving('bgLoc'); // re-assert in case finally already cleared it via Alert path
    try {
      const ok = await startBackgroundLocationMonitoring();
      if (!ok) {
        Alert.alert(
          '"Always" Location Required',
          'PanicRoom needs "Allow all the time" location access for background GPS. Open Settings to change it.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      setBgLocActive(true);
      await updateEmergencySettings({ backgroundLocationEnabled: true });
    } finally {
      setSaving(null);
    }
  };

  // ── Camera / audio / contact toggles (stored in context only) ────────────

  const toggleSetting = async (
    key: 'cameraAutoRecord' | 'audioAutoRecord',
    value: boolean,
  ) => {
    await updateEmergencySettings({ [key]: value });
  };

  const setCallMode = async (value: CallMode) => {
    await updateEmergencySettings({ emergencyCallMode: value });
  };

  const setFollowUpAction = async (value: FollowUpAction) => {
    await updateEmergencySettings({
      contactFollowUpAction: value,
      autoCallContact: value === 'call' || value === 'callAll',
    });
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <ImageBackground source={heroBg} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImg}>
          <LinearGradient
            colors={['rgba(8,9,31,0.97)', 'rgba(13,13,45,0.62)', 'rgba(13,13,45,0.12)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Emergency{'\n'}<Text style={styles.heroAccent}>Settings</Text></Text>
            <Text style={styles.heroSub}>
              Control how PanicRoom activates and what runs in the background to keep you safe.
            </Text>
          </View>
        </ImageBackground>

        {/* ── Lock screen ── */}
        <SectionCard title="Lock Screen" icon="L" iconColor="#ef445b">
          <SettingRow
            title="Lock Screen SOS Button"
            description={
              'Shows a persistent "ACTIVATE SOS" button in your notification shade and on your lock screen. ' +
              'Tapping it opens the emergency screen without requiring Face ID, Touch ID, or PIN.'
            }
            value={lockScreenActive}
            onToggle={toggleLockScreen}
            loading={saving === 'lock'}
            platform="iOS & Android"
          />
        </SectionCard>

        {/* ── Background location ── */}
        <SectionCard title="Location" icon="G" iconColor="#4ee1d5">
          <SettingRow
            title="Background Location Monitoring"
            description={
              'Continuously tracks your GPS in the background, even when the app is closed. ' +
              'Ensures emergency contacts receive your accurate location the moment an emergency is triggered. ' +
              'Requires "Always" location permission.'
            }
            value={bgLocActive}
            onToggle={toggleBgLocation}
            loading={saving === 'bgLoc'}
            platform="iOS & Android"
          />
        </SectionCard>

        {/* ── Recording ── */}
        <SectionCard title="Call Action" icon="!" iconColor="#ef445b">
          <OptionGroup
            title="Emergency Call Mode"
            description="Choose what happens after recording, GPS, and trusted-contact alerts start."
            options={CALL_MODE_OPTIONS}
            value={emergencySettings.emergencyCallMode}
            onSelect={setCallMode}
          />
          <View style={styles.rowDivider} />
          <OptionGroup
            title="After 911"
            description="Optional second action after opening the 911 dialer. Phone and FaceTime apps may require user confirmation."
            options={FOLLOW_UP_OPTIONS}
            value={
              emergencySettings.contactFollowUpAction ??
              (emergencySettings.autoCallContact ? 'call' : 'none')
            }
            onSelect={setFollowUpAction}
          />
        </SectionCard>

        <SectionCard title="Emergency Activation" icon="R" iconColor="#b777ff">
          <SettingRow
            title="Auto-Record Camera"
            description="Starts video recording automatically when the emergency countdown completes. On by default."
            value={emergencySettings.cameraAutoRecord}
            onToggle={(v) => toggleSetting('cameraAutoRecord', v)}
            platform="iOS & Android"
          />
          <View style={styles.rowDivider} />
          <SettingRow
            title="Auto-Record Audio"
            description="Starts audio recording automatically when the emergency countdown completes. On by default."
            value={emergencySettings.audioAutoRecord}
            onToggle={(v) => toggleSetting('audioAutoRecord', v)}
            platform="iOS & Android"
          />
        </SectionCard>

        {/* Footer note */}
        <LinearGradient
          colors={['rgba(91,42,173,0.32)', 'rgba(23,26,74,0.88)']}
          style={styles.noteCard}
        >
          <Text style={styles.noteTitle}>Platform Notes</Text>
          <Text style={styles.noteText}>
            <Text style={styles.noteBold}>iOS:</Text>{' '}
            The lock screen button uses a notification action. Apple requires the Critical Alerts
            entitlement for notifications that override silent mode — PanicRoom will apply for this
            entitlement. Until approved, the button still works but respects your silent mode setting.{'\n\n'}
            <Text style={styles.noteBold}>Android:</Text>{' '}
            The lock screen button uses a high-priority notification visible on the lock screen.
            Tapping "ACTIVATE SOS" opens PanicRoom without unlocking the device when the
            action is set to not require authentication.{'\n\n'}
            You can revoke any permission at any time in Settings › PanicRoom.
          </Text>
        </LinearGradient>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({
  title, icon, iconColor, children,
}: {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: `${iconColor}22` }]}>
          <Text style={[styles.sectionIconText, { color: iconColor }]}>{icon}</Text>
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function SettingRow({
  title, description, value, onToggle, loading, platform,
}: {
  title: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  loading?: boolean;
  platform?: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <View style={styles.settingTitleRow}>
          <Text style={styles.settingTitle}>{title}</Text>
          {platform && <Text style={styles.platformBadge}>{platform}</Text>}
        </View>
        <Text style={styles.settingDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={loading ? undefined : onToggle}
        disabled={loading}
        trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(147,76,255,0.7)' }}
        thumbColor={value ? '#d4abff' : '#6b6388'}
        ios_backgroundColor="rgba(255,255,255,0.12)"
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function OptionGroup<T extends string>({
  title, description, options, value, onSelect,
}: {
  title: string;
  description: string;
  options: Array<{ value: T; title: string; description: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View>
      <Text style={styles.settingTitle}>{title}</Text>
      <Text style={[styles.settingDesc, styles.optionGroupDesc]}>{description}</Text>
      <View style={styles.optionGrid}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <TouchableOpacity
              key={option.value}
              activeOpacity={0.84}
              style={[styles.optionButton, active && styles.optionButtonActive]}
              onPress={() => onSelect(option.value)}
            >
              <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                {option.title}
              </Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: { paddingBottom: 120 },
  hero: {
    height: 220,
    justifyContent: 'flex-end',
    marginBottom: 20,
    overflow: 'hidden',
  },
  heroImg: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  backBtn: {
    left: 18,
    position: 'absolute',
    top: 18,
  },
  backText: { color: '#fff', fontSize: 26, fontWeight: '900' },
  heroCopy: { padding: 24, paddingTop: 0 },
  heroTitle: { color: '#fff', fontSize: 34, fontWeight: '900', lineHeight: 40, marginBottom: 8 },
  heroAccent: { color: '#ef445b' },
  heroSub: { color: '#d8d3e8', fontSize: 14, lineHeight: 21 },
  section: {
    backgroundColor: 'rgba(10,17,49,0.88)',
    borderColor: 'rgba(90,78,148,0.32)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    marginHorizontal: 18,
    overflow: 'hidden',
  },
  sectionHeader: {
    alignItems: 'center',
    borderBottomColor: 'rgba(90,78,148,0.22)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  sectionIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  sectionIconText: { fontSize: 14, fontWeight: '900' },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  sectionBody: { padding: 16 },
  rowDivider: {
    backgroundColor: 'rgba(90,78,148,0.18)',
    height: 1,
    marginVertical: 14,
  },
  settingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  settingCopy: { flex: 1 },
  settingTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 5 },
  settingTitle: { color: '#f0ecfb', fontSize: 14, fontWeight: '800' },
  platformBadge: {
    backgroundColor: 'rgba(90,78,148,0.28)',
    borderRadius: 8,
    color: '#9b91bb',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  settingDesc: { color: '#8b84aa', fontSize: 12, lineHeight: 18 },
  optionGroupDesc: { marginBottom: 12 },
  optionGrid: { gap: 10 },
  optionButton: {
    backgroundColor: 'rgba(5, 7, 21, 0.48)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  optionButtonActive: {
    backgroundColor: 'rgba(124,58,237,0.24)',
    borderColor: 'rgba(212,171,255,0.62)',
  },
  optionTitle: { color: '#d8d3e8', fontSize: 13, fontWeight: '900', marginBottom: 4 },
  optionTitleActive: { color: '#fff' },
  optionDescription: { color: '#8b84aa', fontSize: 11, lineHeight: 16 },
  noteCard: {
    borderColor: 'rgba(149,110,255,0.28)',
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 18,
    marginTop: 6,
    padding: 20,
  },
  noteTitle: { color: '#d9bcff', fontSize: 15, fontWeight: '800', marginBottom: 10 },
  noteText: { color: '#9b91bb', fontSize: 12, lineHeight: 20 },
  noteBold: { color: '#c4b0f0', fontWeight: '700' },
});
