import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import { useSubscription } from '../context/SubscriptionContext';
import type { RootStackParamList } from '../navigation/types';

const HEADLINES: Record<string, string> = {
  'background-location': 'Unlock Background Location Monitoring',
  'covert-messaging': 'Unlock Covert Messaging',
  'contacts-cap': 'Unlock Unlimited Trusted Contacts',
};

const BENEFITS = [
  { icon: 'G', title: 'Background Location Monitoring', desc: 'Keep sharing your GPS even when Bes is closed.' },
  { icon: 'M', title: 'Covert Messaging', desc: 'Send discreet, encrypted messages hidden inside images.' },
  { icon: 'C', title: 'Unlimited Trusted Contacts', desc: 'Add everyone you trust, no cap.' },
];

export default function PaywallScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'Paywall'>>();
  const { isPremium, loading, offering, purchasePackage, restorePurchases } = useSubscription();
  const [busy, setBusy] = useState(false);
  const pageMaxWidth = 640;

  const headline = HEADLINES[route.params?.reason ?? ''] ?? 'Unlock Bes Premium';
  const pkg = offering?.availablePackages?.[0] ?? null;
  const priceString = pkg?.product.priceString ?? '$4.99/mo';

  const handleSubscribe = async () => {
    if (!pkg) {
      Alert.alert('Not available', 'Bes Premium isn’t available right now. Please try again later.');
      return;
    }
    setBusy(true);
    try {
      await purchasePackage(pkg);
      Alert.alert('You’re Premium!', 'Bes Premium is now active. Thank you for supporting Bes.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      if (!error?.userCancelled) {
        Alert.alert('Purchase failed', error?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restorePurchases();
      Alert.alert(
        isPremium ? 'Restored' : 'Nothing to restore',
        isPremium
          ? 'Your Bes Premium subscription has been restored.'
          : 'We couldn’t find an active Bes Premium subscription on this account.',
      );
    } catch (error: any) {
      Alert.alert('Restore failed', error?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="paywall-screen" accessible accessibilityLabel="paywall-screen">
      <ScrollView
        contentContainerStyle={[styles.scroll, { maxWidth: pageMaxWidth }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} activeOpacity={0.82}>
            <Text style={styles.headerButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Bes Premium</Text>
          <View style={styles.headerButton} />
        </View>

        <LinearGradient colors={['rgba(139,92,246,0.24)', 'rgba(12,16,45,0.98)']} style={styles.hero}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.price}>{priceString}</Text>
          <Text style={styles.priceSub}>per month • cancel anytime</Text>
        </LinearGradient>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Text style={styles.benefitIconText}>{b.icon}</Text>
              </View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {isPremium ? (
          <View style={styles.activeBanner}>
            <Text style={styles.activeBannerText}>You already have Bes Premium — thank you!</Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.86}
            style={[styles.subscribeBtn, (busy || loading) && styles.subscribeBtnDisabled]}
            onPress={handleSubscribe}
            disabled={busy || loading}
            testID="paywall-subscribe-btn"
            accessibilityLabel="paywall-subscribe-btn"
            accessibilityRole="button"
          >
            <Text style={styles.subscribeText}>{busy ? 'Please wait…' : `Subscribe — ${priceString}`}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.restoreBtn}
          onPress={handleRestore}
          disabled={busy}
          testID="paywall-restore-btn"
          accessibilityLabel="paywall-restore-btn"
          accessibilityRole="button"
        >
          <Text style={styles.restoreText}>Restore Purchases</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Everything that matters in an emergency — SOS activation, GPS sharing, calling and notifying your
          trusted contacts — is always free on Bes, with or without Premium.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: { alignSelf: 'center', flexGrow: 1, gap: 16, padding: 20, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerButtonText: { color: '#fff', fontSize: 22, fontWeight: '500' },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  hero: {
    alignItems: 'center',
    borderColor: 'rgba(149,110,255,0.3)',
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    padding: 28,
  },
  headline: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  price: { color: '#d7b4ff', fontSize: 36, fontWeight: '900', marginTop: 8 },
  priceSub: { color: '#aaa4bb', fontSize: 14, fontWeight: '600' },
  benefits: { gap: 12 },
  benefitRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  benefitIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(183,119,255,0.22)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  benefitIconText: { color: '#b777ff', fontSize: 18, fontWeight: '900' },
  benefitCopy: { flex: 1 },
  benefitTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  benefitDesc: { color: '#aaa4bb', fontSize: 13, lineHeight: 18, marginTop: 2 },
  subscribeBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    minHeight: 56,
    justifyContent: 'center',
  },
  subscribeBtnDisabled: { opacity: 0.6 },
  subscribeText: { color: '#fff', fontSize: 17, fontWeight: '900' },
  restoreBtn: { alignItems: 'center', paddingVertical: 8 },
  restoreText: { color: '#b777ff', fontSize: 14, fontWeight: '800' },
  activeBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(78,225,213,0.14)',
    borderColor: '#4ee1d5',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  activeBannerText: { color: '#4ee1d5', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  footnote: { color: '#918aaa', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
