import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/apiClient';
import { fetchGoogleEnabled } from '../services/googleAuth';

// Settings → Google sign-in. Linking an existing account to Google always
// requires being signed in AND re-entering the password (the server checks
// both) — accounts are never linked by matching emails.
export default function GoogleAccountRow() {
  const { user, linkGoogle, unlinkGoogle } = useAuth();
  const [available, setAvailable] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGoogleEnabled().then((enabled) => !cancelled && setAvailable(enabled));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available || !user) return null;

  const googleOnly = user.hasPassword === false;
  const linked = Boolean(user.googleLinked);

  const connect = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      const result = await linkGoogle(password);
      if (result === 'linked') {
        setAskPassword(false);
        setPassword('');
        Alert.alert('Google connected', 'You can now sign in to Bes with Google.');
      }
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'invalid_password'
          ? 'That password is incorrect.'
          : error instanceof Error
            ? error.message
            : 'Try again.';
      Alert.alert('Could not connect Google', message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    Alert.alert('Disconnect Google?', "You'll sign in with your email and password instead.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          unlinkGoogle().catch((error) =>
            Alert.alert('Could not disconnect Google', error instanceof Error ? error.message : 'Try again.'),
          );
        },
      },
    ]);
  };

  const label = googleOnly ? 'Signed in with Google' : linked ? 'Disconnect Google' : 'Connect Google';
  const desc = googleOnly
    ? 'This account signs in with Google.'
    : linked
      ? 'Google sign-in is on for this account.'
      : 'Sign in to Bes with your Google account next time.';

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.84}
        style={styles.row}
        disabled={googleOnly}
        onPress={linked ? disconnect : () => setAskPassword(true)}
        testID="settings-google-row"
        accessibilityLabel="settings-google-row"
      >
        <View style={styles.icon}>
          <Text style={styles.iconText}>G</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.desc}>{desc}</Text>
        </View>
        {!googleOnly && <Text style={styles.arrow}>{'>'}</Text>}
      </TouchableOpacity>

      <Modal visible={askPassword} transparent animationType="fade" onRequestClose={() => setAskPassword(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="settings-google-password-sheet">
            <Text style={styles.sheetTitle}>Confirm your password</Text>
            <Text style={styles.desc}>To connect Google, confirm it's you with your Bes password.</Text>
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#7f7899"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              testID="settings-google-password-input"
              accessibilityLabel="settings-google-password-input"
            />
            <TouchableOpacity
              style={[styles.primary, (!password || busy) && styles.disabled]}
              onPress={connect}
              disabled={!password || busy}
              testID="settings-google-connect-btn"
              accessibilityLabel="settings-google-connect-btn"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Continue with Google</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setAskPassword(false);
                setPassword('');
              }}
              testID="settings-google-cancel-btn"
            >
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Matches SettingsScreen's rows (the list's gap handles spacing).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1231',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(122,87,214,0.28)',
    padding: 16,
    gap: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4285f424' },
  iconText: { color: '#4285f4', fontSize: 16, fontWeight: '800' },
  copy: { flex: 1 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
  desc: { color: '#aaa', fontSize: 13, marginTop: 2 },
  arrow: { color: '#9e8fc2', fontSize: 18 },
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', flex: 1, justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#15122b', borderRadius: 20, gap: 12, maxWidth: 420, padding: 20, width: '100%' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primary: { alignItems: 'center', backgroundColor: '#ef445b', borderRadius: 12, paddingVertical: 13 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  cancel: { color: '#a8a0bf', fontSize: 14, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
});
