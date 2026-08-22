import { useState } from 'react';
import {
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { forgotPasswordRequest, resetPasswordRequest } from '../services/authService';
import type { UnauthStackParamList } from '../navigation/types';
import heroBg from '../../assets/images/hero-bg.png';

type Step = 'request' | 'confirm';

const GENERIC_SENT_MESSAGE =
  'If this account has SMS recovery set up, a 6-digit reset code was just sent to the phone on file.';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<UnauthStackParamList>>();
  const { width } = useWindowDimensions();
  const isWide = width >= 820;

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const requestCode = async () => {
    if (!email.trim()) {
      setFormError('Enter your email.');
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      // Deliberately generic: the backend never reveals whether the account
      // or a phone number on file actually exists, so neither does this UI.
      await forgotPasswordRequest(email.trim());
      Alert.alert('Check your phone', GENERIC_SENT_MESSAGE);
      setStep('confirm');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resendCode = async () => {
    setFormError('');
    setSubmitting(true);
    try {
      await forgotPasswordRequest(email.trim());
      Alert.alert('Code resent', GENERIC_SENT_MESSAGE);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (!code.trim() || !newPassword) {
      setFormError('Enter the code and a new password.');
      return;
    }
    if (newPassword.length < 12) {
      setFormError('Use a password with at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setFormError('');
    setSubmitting(true);
    try {
      await resetPasswordRequest({ email: email.trim(), code: code.trim(), newPassword });
      Alert.alert('Password updated', 'Sign in with your new password.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

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
                <Text style={styles.heroTitle}>Reset your password.</Text>
                <Text style={styles.heroText}>
                  We&apos;ll text a 6-digit code to the phone number on your account.
                </Text>
              </View>

              <View style={styles.formCard}>
                {formError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{formError}</Text>
                  </View>
                ) : null}

                <View style={styles.field}>
                  <Text style={styles.label}>Email</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={step === 'request'}
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#7f7899"
                    style={[styles.input, step !== 'request' && styles.inputDisabled]}
                    value={email}
                    testID="forgot-email-input"
                    accessibilityLabel="forgot-email-input"
                  />
                </View>

                {step === 'request' ? (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    disabled={submitting}
                    onPress={requestCode}
                    style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                    testID="forgot-submit-btn"
                    accessibilityLabel="forgot-submit-btn"
                    accessibilityRole="button"
                  >
                    <Text style={styles.submitText}>
                      {submitting ? 'Please wait...' : 'Send reset code'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={styles.field}>
                      <Text style={styles.label}>6-digit code</Text>
                      <TextInput
                        autoComplete="one-time-code"
                        keyboardType="number-pad"
                        maxLength={6}
                        onChangeText={setCode}
                        placeholder="123456"
                        placeholderTextColor="#7f7899"
                        style={styles.input}
                        value={code}
                        testID="forgot-code-input"
                        accessibilityLabel="forgot-code-input"
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>New password</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoComplete="password-new"
                        onChangeText={setNewPassword}
                        placeholder="At least 12 characters"
                        placeholderTextColor="#7f7899"
                        secureTextEntry
                        style={styles.input}
                        value={newPassword}
                        testID="forgot-new-password-input"
                        accessibilityLabel="forgot-new-password-input"
                      />
                      <Text style={styles.helperText}>{newPassword.length}/12 characters minimum</Text>
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>Confirm new password</Text>
                      <TextInput
                        autoCapitalize="none"
                        autoComplete="password-new"
                        onChangeText={setConfirmPassword}
                        placeholder="Re-enter new password"
                        placeholderTextColor="#7f7899"
                        secureTextEntry
                        style={styles.input}
                        value={confirmPassword}
                        testID="forgot-confirm-password-input"
                        accessibilityLabel="forgot-confirm-password-input"
                      />
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.86}
                      disabled={submitting}
                      onPress={resetPassword}
                      style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                      testID="forgot-reset-submit-btn"
                      accessibilityLabel="forgot-reset-submit-btn"
                      accessibilityRole="button"
                    >
                      <Text style={styles.submitText}>
                        {submitting ? 'Please wait...' : 'Reset Password'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.82}
                      disabled={submitting}
                      onPress={resendCode}
                      style={styles.secondaryButton}
                      testID="forgot-resend-btn"
                      accessibilityLabel="forgot-resend-btn"
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryText}>Resend code</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => navigation.navigate('Login')}
                  style={styles.backStepButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.backStepText}>Back to sign in</Text>
                </TouchableOpacity>
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
    minHeight: 480,
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
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 44,
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
  inputDisabled: { opacity: 0.5 },
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
  secondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(199,140,255,0.28)',
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryText: { color: '#d9bcff', fontSize: 13, fontWeight: '900' },
  backStepButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  backStepText: { color: '#aaa3bd', fontSize: 13, fontWeight: '900' },
});
