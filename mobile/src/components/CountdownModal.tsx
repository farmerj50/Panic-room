import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { COUNTDOWN_SECONDS } from '../config/emergencyConfig';

interface Props {
  visible: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export default function CountdownModal({ visible, onComplete, onCancel }: Props) {
  const [count, setCount] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!visible) {
      setCount(COUNTDOWN_SECONDS);
      return;
    }
    setCount(COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setCount((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Activating Emergency</Text>
          <Text style={styles.count}>{count}</Text>
          <Text style={styles.sub}>Camera · Audio · GPS will start</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 280,
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    alignItems: 'center',
    padding: 32,
    borderWidth: 2,
    borderColor: '#e74c3c',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  count: {
    color: '#e74c3c',
    fontSize: 72,
    fontWeight: '900',
    lineHeight: 80,
  },
  sub: {
    color: '#aaa',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 24,
    textAlign: 'center',
  },
  cancelBtn: {
    backgroundColor: '#333',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  cancelText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
  },
});
