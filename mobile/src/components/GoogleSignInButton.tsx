import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GoogleLinkRequiredError, useAuth } from '../context/AuthContext';
import { fetchGoogleEnabled } from '../services/googleAuth';

// "Continue with Google" — Android only, and only when both this build and
// the server have Google configured (otherwise renders nothing, leaving the
// email options). Signing in or creating an account is the same tap; the
// server decides which.
export default function GoogleSignInButton({
  onAvailable,
  testID = 'google-sign-in-btn',
}: {
  onAvailable?: (available: boolean) => void;
  testID?: string;
}) {
  const { signInWithGoogle } = useAuth();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGoogleEnabled().then((enabled) => {
      if (cancelled) return;
      setAvailable(enabled);
      onAvailable?.(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [onAvailable]);

  if (!available) return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithGoogle(); // 'cancelled' is silent by design
    } catch (error) {
      if (error instanceof GoogleLinkRequiredError) {
        Alert.alert(
          'You already have a Bes account',
          'Sign in with your email and password, then connect Google in Settings so you can use it next time.',
        );
      } else {
        Alert.alert('Google sign-in', error instanceof Error ? error.message : 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      disabled={busy}
      style={styles.button}
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={testID}
    >
      {busy ? (
        <ActivityIndicator color="#1f1f1f" />
      ) : (
        <View style={styles.row}>
          <View style={styles.badge}>
            <Text style={styles.g}>G</Text>
          </View>
          <Text style={styles.label}>Continue with Google</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 22,
    width: '100%',
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  badge: {
    alignItems: 'center',
    borderColor: '#dadce0',
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  g: { color: '#4285f4', fontSize: 15, fontWeight: '900' },
  label: { color: '#1f1f1f', fontSize: 16, fontWeight: '700' },
});
