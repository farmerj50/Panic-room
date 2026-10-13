import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { trackEvent } from '../services/analyticsService';
import { listConnections } from '../services/socialSharingService';
import {
  clearRemindAfterEmergency,
  dismissHomeCard,
  hasRemindAfterEmergency,
  shouldShowHomeCard,
} from '../services/socialSharingPrompts';

// Home: lets people discover emergency sharing to TikTok/Instagram before
// they ever need it, and shows the one-time reminder a user asked for during
// an emergency. Premium users go to Social Sharing; free users see the
// Paywall — same targets as Settings → Emergency Social Sharing.
export default function SocialSharingCard() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const userId = user?.id ?? null;
  const [visible, setVisible] = useState(false);
  const reminderOpenRef = useRef(false);

  const openSetup = useCallback(() => {
    if (isPremium) navigation.navigate('SocialSharing');
    else navigation.navigate('Paywall', { reason: 'social-sharing' });
  }, [isPremium, navigation]);

  // Hidden once any account is connected; free users make no network call.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      if (!(await shouldShowHomeCard(userId))) return;
      if (isPremium) {
        const result = await listConnections().catch(() => null);
        if (!result || result.connections.some((c) => c.status === 'connected')) return;
      }
      if (cancelled) return;
      setVisible(true);
      trackEvent('social_card_shown', { premium: isPremium });
    })();
    return () => {
      cancelled = true;
    };
  }, [isPremium, userId]);

  // "Remind me after" from an emergency. Read on focus and cleared only once
  // the user acts on or dismisses the sheet — never just for being read.
  useFocusEffect(
    useCallback(() => {
      if (!userId || reminderOpenRef.current) return;
      let cancelled = false;
      hasRemindAfterEmergency(userId).then((pending) => {
        if (!pending || cancelled || reminderOpenRef.current) return;
        reminderOpenRef.current = true;
        const done = (accepted: boolean) => {
          reminderOpenRef.current = false;
          void clearRemindAfterEmergency(userId);
          if (accepted) {
            trackEvent('social_remind_sheet_accepted', { premium: isPremium });
            openSetup();
          }
        };
        Alert.alert(
          'Set up emergency sharing?',
          isPremium
            ? 'Connect TikTok or Instagram so you can share emergency video if you ever need to.'
            : 'Sharing emergency video to TikTok or Instagram is part of Bes Premium.',
          [
            { text: 'Not now', style: 'cancel', onPress: () => done(false) },
            { text: isPremium ? 'Connect' : 'See Premium', onPress: () => done(true) },
          ],
          { cancelable: true, onDismiss: () => done(false) },
        );
      });
      return () => {
        cancelled = true;
      };
    }, [isPremium, openSetup, userId]),
  );

  if (!visible) return null;

  const onConnect = () => {
    trackEvent('social_card_connect', { premium: isPremium });
    openSetup();
  };
  const onDismiss = () => {
    trackEvent('social_card_dismiss', { premium: isPremium });
    setVisible(false);
    if (userId) void dismissHomeCard(userId);
  };

  return (
    <View style={styles.card} testID="home-social-sharing-card" accessibilityLabel="home-social-sharing-card">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Share emergency video to TikTok or Instagram</Text>
        {!isPremium && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Premium</Text>
          </View>
        )}
      </View>
      <Text style={styles.body}>
        Connect your accounts now so they're ready if you ever need them. Nothing is ever posted without you
        reviewing and tapping Share.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity onPress={onConnect} style={styles.primary} testID="home-social-sharing-connect">
          <Text style={styles.primaryText}>{isPremium ? 'Connect' : 'See Premium'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} testID="home-social-sharing-dismiss">
          <Text style={styles.quiet}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(244,114,182,0.10)',
    borderColor: 'rgba(244,114,182,0.55)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 18,
    padding: 18,
    width: '100%',
  },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { color: '#fff', flex: 1, fontSize: 17, fontWeight: '800' },
  badge: { backgroundColor: '#f472b6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: '#1a1020', fontSize: 11, fontWeight: '900' },
  body: { color: '#d8d0e8', fontSize: 14, lineHeight: 20 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: 20, marginTop: 4 },
  primary: { backgroundColor: '#f472b6', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  primaryText: { color: '#1a1020', fontSize: 14, fontWeight: '900' },
  quiet: { color: '#d8d0e8', fontSize: 14, fontWeight: '700' },
});
