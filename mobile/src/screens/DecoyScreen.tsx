import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePinLock } from '../context/PinLockContext';

const BUTTONS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

function compute(a: number, op: string, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? NaN : a / b;
    default:
      return b;
  }
}

export default function DecoyScreen() {
  const { hasPin, exitDecoy } = usePinLock();

  const [display, setDisplay] = useState('0');
  const [pending, setPending] = useState<{ value: number; op: string } | null>(null);
  const [showExit, setShowExit] = useState(false);
  const [exitPin, setExitPin] = useState('');
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState(false);

  const inputDigit = (digit: string) => {
    if (display === '0' && digit !== '.') {
      setDisplay(digit);
    } else if (digit === '.' && display.includes('.')) {
      return;
    } else {
      setDisplay(display + digit);
    }
  };

  const handlePress = (key: string) => {
    if (/[0-9.]/.test(key)) {
      inputDigit(key);
      return;
    }

    if (key === 'C') {
      setDisplay('0');
      setPending(null);
      return;
    }

    if (key === '±') {
      setDisplay((current) => (current.startsWith('-') ? current.slice(1) : `-${current}`));
      return;
    }

    if (key === '%') {
      setDisplay((current) => String(parseFloat(current) / 100));
      return;
    }

    if (key === '=') {
      if (pending) {
        const result = compute(pending.value, pending.op, parseFloat(display));
        setDisplay(String(result));
        setPending(null);
      }
      return;
    }

    // +, -, ×, ÷
    setPending({ value: parseFloat(display), op: key });
    setDisplay('0');
  };

  const handleExitAttempt = async () => {
    if (!hasPin) {
      await exitDecoy();
      return;
    }
    setExiting(true);
    setExitError(false);
    const ok = await exitDecoy(exitPin);
    setExiting(false);
    if (!ok) {
      setExitError(true);
      setExitPin('');
    } else {
      setShowExit(false);
      setExitPin('');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity
        activeOpacity={1}
        style={styles.displayWrap}
        onLongPress={() => setShowExit(true)}
        delayLongPress={800}
        testID="decoy-display"
      >
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </TouchableOpacity>

      {showExit && (
        <View style={styles.exitOverlay} testID="decoy-exit-overlay">
          <View style={styles.exitCard}>
            {hasPin ? (
              <>
                <Text style={styles.exitTitle}>Enter PIN to exit</Text>
                <TextInput
                  style={styles.exitInput}
                  placeholder="PIN"
                  placeholderTextColor="#7f7899"
                  keyboardType="number-pad"
                  secureTextEntry
                  value={exitPin}
                  onChangeText={setExitPin}
                  testID="decoy-exit-pin-input"
                  autoFocus
                />
                {exitError && <Text style={styles.exitError}>Incorrect PIN</Text>}
                <TouchableOpacity
                  activeOpacity={0.84}
                  style={styles.exitBtn}
                  onPress={handleExitAttempt}
                  disabled={exiting}
                  testID="decoy-exit-submit-btn"
                >
                  {exiting ? <ActivityIndicator color="#fff" /> : <Text style={styles.exitBtnText}>Unlock</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.exitBtn}
                onPress={handleExitAttempt}
                testID="decoy-exit-submit-btn"
              >
                <Text style={styles.exitBtnText}>Exit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.exitCancel} onPress={() => setShowExit(false)}>
              <Text style={styles.exitCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.pad}>
        {BUTTONS.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.padRow}>
            {row.map((key) => (
              <TouchableOpacity
                key={key}
                activeOpacity={0.8}
                style={[styles.key, key === '0' && styles.keyWide, /[÷×\-+=]/.test(key) && styles.keyOperator]}
                onPress={() => handlePress(key)}
              >
                <Text style={styles.keyText}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0d', justifyContent: 'flex-end', padding: 14 },
  displayWrap: { alignItems: 'flex-end', flex: 1, justifyContent: 'flex-end', paddingBottom: 24 },
  display: { color: '#fff', fontSize: 64, fontWeight: '300' },
  pad: { gap: 10 },
  padRow: { flexDirection: 'row', gap: 10 },
  key: {
    alignItems: 'center',
    backgroundColor: '#333',
    borderRadius: 40,
    flex: 1,
    height: 76,
    justifyContent: 'center',
  },
  keyWide: { flex: 2.2, alignItems: 'flex-start', paddingLeft: 28 },
  keyOperator: { backgroundColor: '#ff9f0a' },
  keyText: { color: '#fff', fontSize: 28, fontWeight: '600' },
  exitOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  exitCard: {
    backgroundColor: '#17133a',
    borderColor: 'rgba(149,110,255,0.3)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 22,
    width: '80%',
  },
  exitTitle: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  exitInput: {
    backgroundColor: 'rgba(5, 7, 21, 0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 14,
    textAlign: 'center',
  },
  exitError: { color: '#ff8fa0', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  exitBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
  },
  exitBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  exitCancel: { alignItems: 'center', paddingVertical: 6 },
  exitCancelText: { color: '#a99cc5', fontSize: 12, fontWeight: '700' },
});
