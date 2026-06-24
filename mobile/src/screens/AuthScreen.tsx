import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { saveContactToBackend } from '../services/contactService';
import type { UnauthStackParamList } from '../navigation/types';
import heroBg from '../../assets/images/hero-bg.png';

type AuthMode = 'login' | 'register';
type RegisterStep = 'account' | 'contact' | 'permissions';
type PermStatus = 'unknown' | 'granted' | 'denied';

const REGISTER_STEPS: Array<{ id: RegisterStep; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'contact', label: 'Contact' },
  { id: 'permissions', label: 'Access' },
];

function toStatus(granted: boolean | undefined): PermStatus {
  if (granted === undefined) return 'unknown';
  return granted ? 'granted' : 'denied';
}

function permissionLabel(status: PermStatus) {
  if (status === 'granted') return 'Allowed';
  if (status === 'denied') return 'Retry';
  return 'Allow';
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { width } = useWindowDimensions();
  const route = useRoute<RouteProp<UnauthStackParamList, 'Auth'>>();
  const [mode, setMode] = useState<AuthMode>(route.params?.mode ?? 'login');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('account');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [trustedName, setTrustedName] = useState('');
  const [trustedPhone, setTrustedPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [permissionsApproved, setPermissionsApproved] = useState(false);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [locStatus, setLocStatus] = useState<PermStatus>('unknown');
  const isWide = width >= 820;

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ granted }) => setLocStatus(toStatus(granted)))
      .catch(() => {});
  }, []);

  const camStatus = toStatus(cameraPermission?.granted);
  const micStatus = toStatus(micPermission?.granted);
  const coreGranted = camStatus === 'granted' && micStatus === 'granted' && locStatus === 'granted';
  const contactStarted = Boolean(trustedName.trim() || trustedPhone.trim());
  const contactComplete = Boolean(trustedName.trim() && trustedPhone.trim());
  const stepNumber = useMemo(
    () => REGISTER_STEPS.findIndex((step) => step.id === registerStep) + 1,
    [registerStep],
  );

  useEffect(() => {
    if (coreGranted) setPermissionsApproved(true);
  }, [coreGranted]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setRegisterStep('account');
    setFormError('');
  };

  const openSettings = (permission: string) => {
    if (Platform.OS === 'web') {
      Alert.alert(
        `${permission} access`,
        `Use the site settings icon next to the address bar and allow ${permission.toLowerCase()} for this site.`,
      );
      return;
    }

    Alert.alert(`${permission} access`, `Open Settings to allow ${permission.toLowerCase()}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  };

  const requestLocation = async () => {
    const result = await Location.requestForegroundPermissionsAsync();
    setLocStatus(toStatus(result.granted));
    if (!result.granted) openSettings('Location');
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
      locationGranted = Boolean(result.granted);
      setLocStatus(toStatus(result.granted));
    }

    const granted = cameraGranted && micGranted && locationGranted;
    setPermissionsApproved(granted);

    if (!cameraGranted) openSettings('Camera');
    else if (!micGranted) openSettings('Microphone');
    else if (!locationGranted) openSettings('Location');

    return granted;
  };

  const validateAccount = () => {
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return false;
    }

    if (mode === 'register' && password.length < 12) {
      setFormError('Use a password with at least 12 characters.');
      return false;
    }

    setFormError('');
    return true;
  };

  const continueRegister = async () => {
    if (registerStep === 'account') {
      if (!validateAccount()) return;
      setRegisterStep('contact');
      return;
    }

    if (registerStep === 'contact') {
      if (contactStarted && !contactComplete) {
        setFormError('Enter both a trusted contact name and phone number, or skip this step.');
        return;
      }
      setFormError('');
      setRegisterStep('permissions');
      return;
    }

    await createAccount();
  };

  const createAccount = async () => {
    if (!validateAccount()) return;

    if (contactStarted && !contactComplete) {
      setFormError('Enter both a trusted contact name and phone number, or skip this step.');
      return;
    }

    setFormError('');
    let contactSaveFailed = false;
    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password, async () => {
        if (contactComplete) {
          try {
            await saveContactToBackend({
              name: trustedName.trim(),
              phoneNumber: trustedPhone.trim(),
              isPriority: true,
            });
          } catch {
            contactSaveFailed = true;
          }
        }

        if (permissionsApproved || coreGranted) {
          await AsyncStorage.setItem('setupDone', 'true');
        }
      });

      if (contactSaveFailed) {
        Alert.alert('Contact not saved', 'Your account was created, but the trusted contact could not be saved.');
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Try again.');
      Alert.alert('Authentication failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (mode === 'register') {
      await continueRegister();
      return;
    }

    if (!validateAccount()) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Try again.');
      Alert.alert('Authentication failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const skipContact = () => {
    setTrustedName('');
    setTrustedPhone('');
    setFormError('');
    setRegisterStep('permissions');
  };

  const primaryText =
    mode === 'login'
      ? 'Sign In'
      : registerStep === 'permissions'
        ? 'Create Account'
        : registerStep === 'contact'
          ? 'Continue to Access'
          : 'Continue to Contact';
  const heroPrimaryText =
    mode === 'register'
      ? registerStep === 'permissions'
        ? 'Create Account'
        : 'Continue Setup'
      : 'Create Account';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { maxWidth: isWide ? 1040 : 620 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ImageBackground source={heroBg} resizeMode="cover" imageStyle={styles.heroImage} style={styles.hero}>
            <LinearGradient
              colors={['rgba(5,7,24,0.98)', 'rgba(15,17,50,0.86)', 'rgba(18,14,46,0.32)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.heroLayout, !isWide && styles.heroLayoutNarrow]}>
              <View style={styles.heroCopy}>
                <Text style={styles.brand}>PanicRoom</Text>
                <Text style={styles.heroTitle}>
                  Private access for your safety data.
                </Text>
                <Text style={styles.heroText}>
                  Create an account, add a trusted contact, and prepare emergency access in one setup flow.
                </Text>
                <View style={styles.heroActions}>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={() => {
                      if (mode === 'register') {
                        submit();
                        return;
                      }
                      switchMode('register');
                    }}
                    style={styles.heroPrimaryButton}
                  >
                    <Text style={styles.heroPrimaryText}>{heroPrimaryText}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => switchMode('login')}
                    style={styles.heroSecondaryButton}
                  >
                    <Text style={styles.heroSecondaryText}>Sign In</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formCard}>
                <View style={styles.modeSwitch}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.modeButton, mode === 'login' && styles.modeButtonActive]}
                    onPress={() => switchMode('login')}
                  >
                    <Text style={[styles.modeText, mode === 'login' && styles.modeTextActive]}>
                      Sign In
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.modeButton, mode === 'register' && styles.modeButtonActive]}
                    onPress={() => switchMode('register')}
                    testID="auth-mode-register-btn"
                    accessibilityLabel="auth-mode-register-btn"
                  >
                    <Text style={[styles.modeText, mode === 'register' && styles.modeTextActive]}>
                      Create Account
                    </Text>
                  </TouchableOpacity>
                </View>

                {mode === 'register' && (
                  <View style={styles.stepper}>
                    {REGISTER_STEPS.map((step, index) => {
                      const active = step.id === registerStep;
                      const done = index + 1 < stepNumber;
                      return (
                        <View key={step.id} style={styles.stepItem}>
                          <View style={[styles.stepDot, (active || done) && styles.stepDotActive]}>
                            <Text style={[styles.stepDotText, (active || done) && styles.stepDotTextActive]}>
                              {index + 1}
                            </Text>
                          </View>
                          <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{step.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {formError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{formError}</Text>
                  </View>
                ) : null}

                {(mode === 'login' || registerStep === 'account') && (
                  <>
                    {mode === 'register' && (
                      <View style={styles.field}>
                        <Text style={styles.label}>Name</Text>
                        <TextInput
                          autoCapitalize="words"
                          onChangeText={setName}
                          placeholder="Your name"
                          placeholderTextColor="#7f7899"
                          style={styles.input}
                          value={name}
                        />
                      </View>
                    )}

                    <View style={styles.field}>
                      <Text style={styles.label}>Email</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoComplete="email"
                        keyboardType="email-address"
                        onChangeText={setEmail}
                        placeholder="you@example.com"
                        placeholderTextColor="#7f7899"
                        style={styles.input}
                        value={email}
                        testID="auth-email-input"
                        accessibilityLabel="auth-email-input"
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>Password</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoComplete="password"
                        onChangeText={setPassword}
                        placeholder={mode === 'register' ? 'At least 12 characters' : 'Password'}
                        placeholderTextColor="#7f7899"
                        secureTextEntry
                        style={styles.input}
                        value={password}
                        testID="auth-password-input"
                        accessibilityLabel="auth-password-input"
                      />
                      {mode === 'register' && (
                        <Text style={styles.helperText}>
                          {password.length}/12 characters minimum
                        </Text>
                      )}
                    </View>
                  </>
                )}

                {mode === 'register' && registerStep === 'contact' && (
                  <View style={styles.stepPanel}>
                    <Text style={styles.panelTitle}>Trusted Contact</Text>
                    <Text style={styles.panelText}>
                      Add one person who should be available during an emergency. You can skip this now.
                    </Text>
                    <View style={styles.field}>
                      <Text style={styles.label}>Contact Name</Text>
                      <TextInput
                        autoCapitalize="words"
                        onChangeText={setTrustedName}
                        placeholder="Trusted person"
                        placeholderTextColor="#7f7899"
                        style={styles.input}
                        value={trustedName}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Phone Number</Text>
                      <TextInput
                        keyboardType="phone-pad"
                        onChangeText={setTrustedPhone}
                        placeholder="+1 555 555 0123"
                        placeholderTextColor="#7f7899"
                        style={styles.input}
                        value={trustedPhone}
                      />
                    </View>
                    <TouchableOpacity activeOpacity={0.82} style={styles.secondaryButton} onPress={skipContact} testID="auth-skip-contact-btn" accessibilityLabel="auth-skip-contact-btn">
                      <Text style={styles.secondaryText}>Skip contact for now</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {mode === 'register' && registerStep === 'permissions' && (
                  <View style={styles.stepPanel}>
                    <Text style={styles.panelTitle}>Emergency Access</Text>
                    <Text style={styles.panelText}>
                      Allow camera, microphone, and location so emergency mode can work immediately.
                    </Text>
                    <PermissionRow
                      color="#4aa8ff"
                      label="Camera"
                      status={camStatus}
                      onPress={async () => {
                        const result = await requestCamera();
                        if (!result?.granted) openSettings('Camera');
                      }}
                    />
                    <PermissionRow
                      color="#b777ff"
                      label="Microphone"
                      status={micStatus}
                      onPress={async () => {
                        const result = await requestMic();
                        if (!result?.granted) openSettings('Microphone');
                      }}
                    />
                    <PermissionRow
                      color="#ff6b9a"
                      label="Location"
                      status={locStatus}
                      onPress={requestLocation}
                    />
                    <TouchableOpacity activeOpacity={0.82} style={styles.secondaryButton} onPress={requestCorePermissions} testID="auth-allow-permissions-btn" accessibilityLabel="auth-allow-permissions-btn">
                      <Text style={styles.secondaryText}>
                        {coreGranted ? 'Required access allowed' : 'Allow required access'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={submitting}
                  onPress={submit}
                  style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                  testID="auth-submit-btn"
                  accessibilityLabel="auth-submit-btn"
                >
                  <Text style={styles.submitText}>
                    {submitting ? 'Please wait...' : primaryText}
                  </Text>
                </TouchableOpacity>

                {mode === 'register' && registerStep !== 'account' && (
                  <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => setRegisterStep(registerStep === 'permissions' ? 'contact' : 'account')}
                    style={styles.backStepButton}
                  >
                    <Text style={styles.backStepText}>Back</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ImageBackground>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PermissionRow({
  color,
  label,
  status,
  onPress,
}: {
  color: string;
  label: string;
  status: PermStatus;
  onPress: () => void;
}) {
  const granted = status === 'granted';
  return (
    <View style={styles.permissionRow}>
      <View style={[styles.permissionIcon, { backgroundColor: `${color}24` }]}>
        <Text style={[styles.permissionIconText, { color }]}>{label.charAt(0)}</Text>
      </View>
      <View style={styles.permissionCopy}>
        <Text style={styles.permissionTitle}>{label}</Text>
        <Text style={styles.permissionStatus}>{granted ? 'Ready' : 'Needed for emergency mode'}</Text>
      </View>
      <TouchableOpacity
        activeOpacity={0.82}
        disabled={granted}
        onPress={onPress}
        style={[styles.permissionButton, granted && styles.permissionButtonGranted]}
      >
        <Text style={[styles.permissionButtonText, granted && styles.permissionButtonTextGranted]}>
          {permissionLabel(status)}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#050715', flex: 1 },
  keyboard: { flex: 1 },
  scroll: {
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: 18,
    width: '100%',
  },
  hero: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 640,
    overflow: 'hidden',
  },
  heroImage: { borderRadius: 22 },
  heroLayout: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 36,
    justifyContent: 'space-between',
    padding: 34,
  },
  heroLayoutNarrow: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 24,
    justifyContent: 'center',
    padding: 22,
  },
  heroCopy: { flex: 1, maxWidth: 470, zIndex: 2 },
  brand: { color: '#d9bcff', fontSize: 18, fontWeight: '900', marginBottom: 14 },
  heroTitle: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 48,
    marginBottom: 16,
  },
  heroText: { color: '#e8e1f5', fontSize: 17, lineHeight: 26 },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 22,
  },
  heroPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#ef445b',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 20,
  },
  heroSecondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(217, 188, 255, 0.42)',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 20,
  },
  heroPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  heroSecondaryText: { color: '#d9bcff', fontSize: 14, fontWeight: '900' },
  formCard: {
    backgroundColor: 'rgba(10, 14, 40, 0.94)',
    borderColor: 'rgba(199,140,255,0.26)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    maxWidth: 430,
    padding: 18,
    width: '100%',
    zIndex: 2,
  },
  modeSwitch: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
    padding: 5,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  modeButtonActive: { backgroundColor: '#7c3aed' },
  modeText: { color: '#b9b0cd', fontSize: 13, fontWeight: '900' },
  modeTextActive: { color: '#fff' },
  stepper: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  stepDot: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(149,110,255,0.25)',
    borderRadius: 14,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepDotActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#d7b4ff',
  },
  stepDotText: { color: '#aaa3bd', fontSize: 12, fontWeight: '900' },
  stepDotTextActive: { color: '#fff' },
  stepLabel: { color: '#918aaa', fontSize: 11, fontWeight: '900' },
  stepLabelActive: { color: '#d9bcff' },
  stepPanel: { gap: 12 },
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  panelText: { color: '#cfc8dd', fontSize: 13, lineHeight: 19 },
  errorBox: {
    backgroundColor: 'rgba(239,68,91,0.14)',
    borderColor: 'rgba(239,68,91,0.42)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { color: '#ff8fa0', fontSize: 13, fontWeight: '900', lineHeight: 18 },
  field: { gap: 8 },
  label: { color: '#d8d1e8', fontSize: 13, fontWeight: '900' },
  helperText: { color: '#9e96b6', fontSize: 12, fontWeight: '800' },
  input: {
    backgroundColor: 'rgba(5, 7, 21, 0.84)',
    borderColor: 'rgba(149,110,255,0.25)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 50,
    outlineStyle: 'none' as never,
    paddingHorizontal: 14,
  },
  permissionRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    padding: 12,
  },
  permissionIcon: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  permissionIconText: { fontSize: 16, fontWeight: '900' },
  permissionCopy: { flex: 1, minWidth: 0 },
  permissionTitle: { color: '#fff', fontSize: 14, fontWeight: '900', marginBottom: 3 },
  permissionStatus: { color: '#a9a1bd', fontSize: 12 },
  permissionButton: {
    alignItems: 'center',
    borderColor: '#7c3aed',
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 78,
    paddingHorizontal: 12,
  },
  permissionButtonGranted: {
    backgroundColor: 'rgba(53,225,207,0.14)',
    borderColor: '#35e1cf',
  },
  permissionButtonText: { color: '#d9bcff', fontSize: 12, fontWeight: '900' },
  permissionButtonTextGranted: { color: '#35e1cf' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(199,140,255,0.28)',
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryText: { color: '#d9bcff', fontSize: 13, fontWeight: '900' },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#ef445b',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 52,
  },
  submitButtonDisabled: { opacity: 0.62 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  backStepButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  backStepText: { color: '#aaa3bd', fontSize: 13, fontWeight: '900' },
});
