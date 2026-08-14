import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { usePinLock } from '../context/PinLockContext';
import ForgotPinForm from '../components/ForgotPinForm';

const PIN_LENGTH = 4;
const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

export default function PinLockScreen() {
  const { user } = useAuth();
  const { unlock, bypassToEmergency, forceClearPin } = usePinLock();

  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const handleDigit = async (digit: string) => {
    if (checking) return;
    setError(false);
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);

    if (next.length === PIN_LENGTH) {
      setChecking(true);
      const ok = await unlock(next);
      setChecking(false);
      if (!ok) {
        setError(true);
        setPin('');
      }
    }
  };

  const handleDelete = () => {
    if (checking) return;
    setError(false);
    setPin((current) => current.slice(0, -1));
  };

  if (showForgot) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerColumn}>
          <ForgotPinForm
            defaultEmail={user?.email}
            onRecovered={forceClearPin}
            onCancel={() => setShowForgot(false)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centerColumn}>
        <Text style={styles.brand}>Bes</Text>
        <Text style={styles.title}>Enter your PIN</Text>

        <View style={styles.dotsRow} testID="pin-lock-dots">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, error && styles.dotError]} />
          ))}
        </View>

        {error && <Text style={styles.errorText}>Incorrect PIN — try again</Text>}

        <View style={styles.keypad}>
          {KEYPAD_ROWS.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.keypadRow}>
              {row.map((key, colIdx) => {
                if (key === '') return <View key={colIdx} style={styles.keySpacer} />;
                if (key === 'del') {
                  return (
                    <TouchableOpacity
                      key={colIdx}
                      activeOpacity={0.8}
                      style={styles.key}
                      onPress={handleDelete}
                      testID="pin-lock-delete-btn"
                    >
                      <Text style={styles.keyText}>{'<'}</Text>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={colIdx}
                    activeOpacity={0.8}
                    style={styles.key}
                    onPress={() => handleDigit(key)}
                    testID={`pin-lock-key-${key}`}
                  >
                    <Text style={styles.keyText}>{key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <TouchableOpacity activeOpacity={0.82} onPress={() => setShowForgot(true)} style={styles.forgotBtn}>
          <Text style={styles.forgotText}>Forgot PIN?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.86}
          style={styles.emergencyBtn}
          onPress={bypassToEmergency}
          testID="pin-lock-emergency-btn"
          accessibilityLabel="pin-lock-emergency-btn"
        >
          <Text style={styles.emergencyText}>Emergency — Skip PIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  centerColumn: {
    alignItems: 'center',
    alignSelf: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    maxWidth: 340,
    padding: 24,
    width: '100%',
  },
  brand: { color: '#d9bcff', fontSize: 20, fontWeight: '900' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  dotsRow: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  dot: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(149,110,255,0.5)',
    borderRadius: 9,
    borderWidth: 1.5,
    height: 18,
    width: 18,
  },
  dotFilled: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  dotError: { borderColor: '#ef445b' },
  errorText: { color: '#ff8fa0', fontSize: 13, fontWeight: '800' },
  keypad: { gap: 14, marginTop: 8, width: '100%' },
  keypadRow: { flexDirection: 'row', gap: 14, justifyContent: 'center' },
  key: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(199,140,255,0.24)',
    borderRadius: 34,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  keySpacer: { height: 68, width: 68 },
  keyText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  forgotBtn: { marginTop: 4, paddingVertical: 6 },
  forgotText: { color: '#a99cc5', fontSize: 13, fontWeight: '700' },
  emergencyBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,91,0.18)',
    borderColor: '#ef445b',
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 54,
    paddingHorizontal: 24,
    width: '100%',
  },
  emergencyText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
