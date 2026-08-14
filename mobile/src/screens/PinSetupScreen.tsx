import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { usePinLock } from '../context/PinLockContext';
import ForgotPinForm from '../components/ForgotPinForm';

function isValidPin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}

export default function PinSetupScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { hasPin, setPin: savePin, changePin, removePin, forceClearPin } = usePinLock();

  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'remove' | 'forgot'>('idle');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setMode('idle');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  };

  const handleSetPin = async () => {
    if (!isValidPin(newPin)) {
      Alert.alert('Invalid PIN', 'Use 4 to 6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert("PINs don't match", 'Enter the same PIN in both fields.');
      return;
    }

    Alert.alert('Set this PIN?', "You'll need it every time you open Bes.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set PIN',
        onPress: async () => {
          setSubmitting(true);
          try {
            await savePin(newPin);
            resetForm();
            Alert.alert('PIN set', 'Bes will ask for this PIN the next time it opens.');
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  const handleChangePin = async () => {
    if (!isValidPin(newPin)) {
      Alert.alert('Invalid PIN', 'Use 4 to 6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      Alert.alert("PINs don't match", 'Enter the same PIN in both fields.');
      return;
    }

    setSubmitting(true);
    try {
      const ok = await changePin(currentPin, newPin);
      if (!ok) {
        Alert.alert('Incorrect PIN', 'Your current PIN was not correct.');
        return;
      }
      resetForm();
      Alert.alert('PIN changed', 'Your PIN was updated.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemovePin = () => {
    Alert.alert(
      'Remove your PIN?',
      'Bes will open without asking for a PIN until you set a new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove PIN',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              const ok = await removePin(currentPin);
              if (!ok) {
                Alert.alert('Incorrect PIN', 'Your current PIN was not correct.');
                return;
              }
              resetForm();
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.82} onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>App Lock</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.scroll}>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.hint}>
            Emergency access (the shield icon, logo gestures, and "I Need Help Now") never asks for
            this PIN — it always works, even if Bes is locked.
          </Text>

          {mode === 'forgot' ? (
            <ForgotPinForm
              defaultEmail={user?.email}
              onRecovered={() => {
                forceClearPin();
                resetForm();
                Alert.alert('PIN removed', 'You can set a new PIN below.');
              }}
              onCancel={resetForm}
            />
          ) : !hasPin ? (
            mode === 'set' ? (
              <View style={styles.form} testID="pin-setup-set-form">
                <TextInput
                  style={styles.input}
                  placeholder="New PIN (4-6 digits)"
                  placeholderTextColor="#7f7899"
                  keyboardType="number-pad"
                  secureTextEntry
                  value={newPin}
                  onChangeText={setNewPin}
                  testID="pin-setup-new-input"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm PIN"
                  placeholderTextColor="#7f7899"
                  keyboardType="number-pad"
                  secureTextEntry
                  value={confirmPin}
                  onChangeText={setConfirmPin}
                  testID="pin-setup-confirm-input"
                />
                <TouchableOpacity
                  activeOpacity={0.84}
                  style={[styles.submitBtn, submitting && styles.disabledBtn]}
                  onPress={handleSetPin}
                  disabled={submitting}
                  testID="pin-setup-submit-btn"
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Set PIN</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={submitting}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.row}
                onPress={() => setMode('set')}
                testID="pin-setup-start-btn"
              >
                <Text style={styles.rowTitle}>Set a PIN</Text>
                <Text style={styles.rowArrow}>{'>'}</Text>
              </TouchableOpacity>
            )
          ) : mode === 'change' || mode === 'remove' ? (
            <View style={styles.form} testID="pin-setup-verify-form">
              <TextInput
                style={styles.input}
                placeholder="Current PIN"
                placeholderTextColor="#7f7899"
                keyboardType="number-pad"
                secureTextEntry
                value={currentPin}
                onChangeText={setCurrentPin}
                testID="pin-setup-current-input"
              />
              {mode === 'change' && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="New PIN (4-6 digits)"
                    placeholderTextColor="#7f7899"
                    keyboardType="number-pad"
                    secureTextEntry
                    value={newPin}
                    onChangeText={setNewPin}
                    testID="pin-setup-new-input"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm new PIN"
                    placeholderTextColor="#7f7899"
                    keyboardType="number-pad"
                    secureTextEntry
                    value={confirmPin}
                    onChangeText={setConfirmPin}
                    testID="pin-setup-confirm-input"
                  />
                </>
              )}
              <TouchableOpacity
                activeOpacity={0.84}
                style={[styles.submitBtn, mode === 'remove' && styles.destructiveBtn, submitting && styles.disabledBtn]}
                onPress={mode === 'change' ? handleChangePin : handleRemovePin}
                disabled={submitting}
                testID="pin-setup-submit-btn"
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>{mode === 'change' ? 'Change PIN' : 'Remove PIN'}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={submitting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                activeOpacity={0.84}
                style={[styles.row, styles.rowBorder]}
                onPress={() => setMode('change')}
                testID="pin-setup-change-btn"
              >
                <Text style={styles.rowTitle}>Change PIN</Text>
                <Text style={styles.rowArrow}>{'>'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.row}
                onPress={() => setMode('remove')}
                testID="pin-setup-remove-btn"
              >
                <Text style={[styles.rowTitle, styles.destructiveText]}>Remove PIN</Text>
                <Text style={styles.rowArrow}>{'>'}</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'idle' && (
            <TouchableOpacity activeOpacity={0.82} onPress={() => setMode('forgot')} style={styles.forgotBtn}>
              <Text style={styles.forgotText}>Forgot PIN?</Text>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>
    </SafeAreaView>
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
  scroll: { padding: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  card: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  hint: { color: '#a9a1bd', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
  },
  rowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  destructiveText: { color: '#ff7080' },
  rowArrow: { color: '#b8aacd', fontSize: 22, fontWeight: '300' },
  form: { gap: 12 },
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
  },
  destructiveBtn: { backgroundColor: '#ef445b' },
  disabledBtn: { opacity: 0.62 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: '#a99cc5', fontSize: 13, fontWeight: '700' },
  forgotBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 6 },
  forgotText: { color: '#a99cc5', fontSize: 13, fontWeight: '700' },
});
