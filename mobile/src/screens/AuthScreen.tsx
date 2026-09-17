import { useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../context/AuthContext';
import { saveContactToBackend } from '../services/contactService';
import { API_URL } from '../config/emergencyConfig';
import type { UnauthStackParamList } from '../navigation/types';
import heroBg from '../../assets/images/hero-bg.png';

type AuthMode = 'login' | 'register';
type AuthRouteName = 'Auth' | 'Login' | 'Register';
type RegisterStep = 'account' | 'contact';

const REGISTER_STEPS: Array<{ id: RegisterStep; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'contact', label: 'Contact' },
];

function getInitialAuthMode(route: RouteProp<UnauthStackParamList, AuthRouteName>): AuthMode {
  if (route.params?.mode === 'register' || route.name === 'Register') return 'register';
  return 'login';
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<UnauthStackParamList>>();
  const route = useRoute<RouteProp<UnauthStackParamList, AuthRouteName>>();
  const [mode, setMode] = useState<AuthMode>(() => getInitialAuthMode(route));
  const [registerStep, setRegisterStep] = useState<RegisterStep>('account');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [trustedName, setTrustedName] = useState('');
  const [trustedPhone, setTrustedPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const isWide = width >= 820;

  const contactStarted = Boolean(trustedName.trim() || trustedPhone.trim());
  const contactComplete = Boolean(trustedName.trim() && trustedPhone.trim());
  const stepNumber = useMemo(
    () => REGISTER_STEPS.findIndex((step) => step.id === registerStep) + 1,
    [registerStep],
  );

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setRegisterStep('account');
    setFormError('');
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
  };

  const primaryText =
    mode === 'login'
      ? 'Sign In'
      : registerStep === 'contact'
        ? 'Create Account'
        : 'Continue to Contact';

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
                <Text style={styles.brand}>Bes</Text>
                <Text style={styles.heroTitle}>
                  Private access for your safety data.
                </Text>
                <Text style={styles.heroText}>
                  Create an account and add a trusted contact — we'll walk you through emergency access next.
                </Text>
              </View>

              <View style={styles.formCard}>
                <View style={styles.modeSwitch}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.modeButton, mode === 'login' && styles.modeButtonActive]}
                    onPress={() => switchMode('login')}
                    testID="auth-mode-login-btn"
                    accessibilityLabel="auth-mode-login-btn"
                    accessibilityRole="button"
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
                    accessibilityRole="button"
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
                      {mode === 'login' && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => navigation.navigate('ForgotPassword')}
                          style={styles.forgotPasswordLink}
                          testID="auth-forgot-password-link"
                          accessibilityLabel="auth-forgot-password-link"
                          accessibilityRole="button"
                        >
                          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                        </TouchableOpacity>
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
                    <TouchableOpacity activeOpacity={0.82} style={styles.secondaryButton} onPress={skipContact} testID="auth-skip-contact-btn" accessibilityLabel="auth-skip-contact-btn" accessibilityRole="button">
                      <Text style={styles.secondaryText}>Skip contact for now</Text>
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
                  accessibilityRole="button"
                >
                  <Text style={styles.submitText}>
                    {submitting ? 'Please wait...' : primaryText}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.legalText}>
                  {mode === 'register' ? 'By creating an account, you agree to our ' : ''}
                  <Text
                    style={styles.legalLink}
                    onPress={() => Linking.openURL(`${API_URL}/legal/terms`)}
                    testID="auth-terms-link"
                    accessibilityLabel="auth-terms-link"
                  >
                    Terms of Service
                  </Text>
                  {', '}
                  <Text
                    style={styles.legalLink}
                    onPress={() => Linking.openURL(`${API_URL}/legal/privacy`)}
                    testID="auth-privacy-link"
                    accessibilityLabel="auth-privacy-link"
                  >
                    Privacy Policy
                  </Text>
                  {', and '}
                  <Text
                    style={styles.legalLink}
                    onPress={() => Linking.openURL(`${API_URL}/legal/data-deletion`)}
                    testID="auth-data-deletion-link"
                    accessibilityLabel="auth-data-deletion-link"
                  >
                    Data Deletion
                  </Text>
                  {'.'}
                </Text>

                {mode === 'register' && registerStep !== 'account' && (
                  <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => setRegisterStep('account')}
                    style={styles.backStepButton}
                    accessibilityRole="button"
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
  forgotPasswordLink: { alignSelf: 'flex-end', marginTop: 6 },
  forgotPasswordText: { color: '#d9bcff', fontSize: 12, fontWeight: '900' },
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
  legalText: {
    color: '#9e96b6',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  legalLink: { color: '#d9bcff', fontWeight: '900' },
  backStepButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  backStepText: { color: '#aaa3bd', fontSize: 13, fontWeight: '900' },
});
