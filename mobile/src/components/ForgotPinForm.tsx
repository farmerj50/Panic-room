import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { loginRequest } from '../services/authService';

interface Props {
  defaultEmail?: string;
  onRecovered: () => void;
  onCancel: () => void;
}

export default function ForgotPinForm({ defaultEmail, onRecovered, onCancel }: Props) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleVerify = async () => {
    if (!email.trim() || !password) return;

    setSubmitting(true);
    try {
      // Purely an identity check — the returned tokens/session are
      // intentionally discarded, this never touches AuthContext.
      await loginRequest({ email: email.trim(), password });
      onRecovered();
    } catch (error) {
      Alert.alert(
        'Could not verify',
        error instanceof Error ? error.message : 'Check your email and password and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form} testID="forgot-pin-form">
      <Text style={styles.title}>Confirm your account to reset your PIN</Text>
      <Text style={styles.sub}>
        Enter your account email and password. This does not need your old PIN.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#7f7899"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        testID="forgot-pin-email-input"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#7f7899"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        testID="forgot-pin-password-input"
      />

      <TouchableOpacity
        activeOpacity={0.84}
        style={[styles.submitBtn, submitting && styles.disabledBtn]}
        onPress={handleVerify}
        disabled={submitting}
        testID="forgot-pin-submit-btn"
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Verify & Reset PIN</Text>}
      </TouchableOpacity>

      <TouchableOpacity activeOpacity={0.82} style={styles.cancelBtn} onPress={onCancel} disabled={submitting}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, width: '100%' },
  title: { color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  sub: { color: '#a9a1bd', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  input: {
    backgroundColor: 'rgba(5, 7, 21, 0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  submitBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 4,
  },
  disabledBtn: { opacity: 0.62 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: '#a99cc5', fontSize: 13, fontWeight: '700' },
});
