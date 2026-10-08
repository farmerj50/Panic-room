import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { ANDROID_PACKAGE_NAME, PREMIUM_PRODUCT_ID } from '../config/purchasesConfig';
import { API_URL } from '../config/emergencyConfig';
import { listConnections, type SocialProvider } from '../services/socialSharingService';
import { contentColumn } from '../config/layout';

// The one place account deletion happens, reachable in one tap from
// Settings and from Profile → Danger Zone (Google Play requires the in-app
// path to be easy to find). The backend re-checks the password, revokes
// TikTok access, and deletes everything; this screen makes sure the user
// knows exactly what they lose first.

export const PLAY_SUBSCRIPTIONS_URL = `https://play.google.com/store/account/subscriptions?sku=${PREMIUM_PRODUCT_ID}&package=${ANDROID_PACKAGE_NAME}`;

const DELETED_ITEMS = [
  'Your account and profile',
  'Trusted contacts',
  'Emergency history and location data',
  'Recordings and stored evidence',
  'Covert messages',
  'Connected TikTok/Instagram accounts and their stored access',
  'Every signed-in session',
];

export default function DeleteAccountScreen() {
  const navigation = useNavigation<any>();
  const { deleteAccount } = useAuth();
  const { isPremium } = useSubscription();

  const [password, setPassword] = useState('');
  const [subscriptionAcknowledged, setSubscriptionAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [connected, setConnected] = useState<SocialProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    listConnections()
      .then((result) => {
        if (cancelled) return;
        setConnected(result.connections.filter((c) => c.status === 'connected').map((c) => c.provider));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const canDelete = password.length > 0 && (!isPremium || subscriptionAcknowledged) && !deleting;

  const confirmDelete = () => {
    if (!canDelete) return;
    Alert.alert('Are you absolutely sure?', 'There is no way to undo this once it starts.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete My Account',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount(password);
            // deleteAccount() flips AuthContext to 'unauthenticated' on
            // success, which drops the app back to the sign-in stack — no
            // explicit navigation needed here.
          } catch (error) {
            Alert.alert(
              'Could not delete account',
              error instanceof Error ? error.message : 'Check your connection and try again.',
            );
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} testID="delete-account-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.8} disabled={deleting}>
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Delete Account</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>This permanently deletes</Text>
          {DELETED_ITEMS.map((item) => (
            <View key={item} style={styles.bulletRow}>
              <View style={styles.bullet} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
          <Text style={styles.cannotUndo}>This can't be undone.</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`${API_URL}/legal/data-deletion`)} testID="delete-account-learn-more">
            <Text style={styles.link}>Learn more about what gets deleted</Text>
          </TouchableOpacity>
        </View>

        {connected.length > 0 && (
          <View style={styles.card} testID="delete-account-social-note">
            <Text style={styles.cardTitle}>Connected accounts</Text>
            {connected.includes('tiktok') && (
              <Text style={styles.cardText}>We'll revoke Bes's TikTok access automatically.</Text>
            )}
            {connected.includes('instagram') && (
              <Text style={styles.cardText}>
                To fully remove Bes from Instagram, also remove it in Facebook → Settings & privacy → Settings →
                Business integrations.
              </Text>
            )}
          </View>
        )}

        {isPremium && (
          <View style={[styles.card, styles.proCard]} testID="delete-account-pro-notice">
            <Text style={styles.cardTitle}>Your Bes Pro subscription</Text>
            <Text style={styles.cardText}>
              Deleting your account does <Text style={styles.bold}>not</Text> cancel your Bes Pro subscription. Google
              Play will keep billing you until you cancel it there.
            </Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => Linking.openURL(PLAY_SUBSCRIPTIONS_URL).catch(() => {})}
              testID="delete-account-cancel-subscription-btn"
              accessibilityLabel="delete-account-cancel-subscription-btn"
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Cancel subscription in Google Play</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setSubscriptionAcknowledged((v) => !v)}
              disabled={deleting}
              testID="delete-account-subscription-ack"
              accessibilityLabel="delete-account-subscription-ack"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: subscriptionAcknowledged }}
            >
              <View style={[styles.checkbox, subscriptionAcknowledged && styles.checkboxOn]}>
                {subscriptionAcknowledged && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkText}>
                I understand that deleting my account does not cancel my Google Play subscription.
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.warning} testID="delete-account-evidence-warning">
          <Text style={styles.warningText}>
            <Text style={styles.bold}>Important:</Text> Deleting your account permanently removes your emergency
            recordings, location history, and stored evidence from Bes. Open Profile → Evidence to view and save any
            recordings you need before continuing. This action cannot be undone.
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Evidence')} disabled={deleting} testID="delete-account-go-evidence">
            <Text style={styles.link}>Go to Evidence</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.inputLabel}>Confirm your password</Text>
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#7f7899"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!deleting}
          testID="delete-account-password-input"
          accessibilityLabel="delete-account-password-input"
        />

        <TouchableOpacity
          style={[styles.deleteBtn, !canDelete && styles.disabled]}
          onPress={confirmDelete}
          disabled={!canDelete}
          testID="delete-account-confirm-btn"
          accessibilityLabel="delete-account-confirm-btn"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDelete }}
        >
          {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteText}>Delete my account</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const RED = '#ef445b';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, ...contentColumn },
  back: { padding: 8 },
  backText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  body: { padding: 16, gap: 14, paddingBottom: 40, ...contentColumn },
  card: {
    backgroundColor: '#0d1231',
    borderColor: 'rgba(122,87,214,0.28)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  proCard: { borderColor: 'rgba(239,68,91,0.45)' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 2 },
  cardText: { color: '#c9c3dc', fontSize: 14, lineHeight: 20 },
  bulletRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  bullet: { backgroundColor: RED, borderRadius: 3, height: 6, width: 6 },
  bulletText: { color: '#c9c3dc', flex: 1, fontSize: 14 },
  cannotUndo: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 4 },
  link: { color: '#b98cff', fontSize: 14, fontWeight: '700', marginTop: 4 },
  bold: { fontWeight: '800', color: '#fff' },
  secondaryBtn: {
    alignItems: 'center',
    borderColor: RED,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 4,
    paddingVertical: 12,
  },
  secondaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  checkRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginTop: 6 },
  checkbox: {
    alignItems: 'center',
    borderColor: '#a1a1aa',
    borderRadius: 6,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    marginTop: 1,
    width: 24,
  },
  checkboxOn: { backgroundColor: RED, borderColor: RED },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '900' },
  checkText: { color: '#fff', flex: 1, fontSize: 14, lineHeight: 20 },
  warning: {
    backgroundColor: 'rgba(239,68,91,0.10)',
    borderColor: 'rgba(239,68,91,0.45)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  warningText: { color: '#f3c4cb', fontSize: 14, lineHeight: 20 },
  inputLabel: { color: '#cbd5e1', fontSize: 13, fontWeight: '800', marginTop: 4 },
  input: {
    backgroundColor: '#0d1231',
    borderColor: 'rgba(122,87,214,0.4)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deleteBtn: {
    alignItems: 'center',
    backgroundColor: RED,
    borderRadius: 14,
    marginTop: 6,
    minHeight: 52,
    justifyContent: 'center',
  },
  deleteText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});
