import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { ApiError } from '../services/apiClient';
import {
  connectProvider,
  disconnectProvider,
  listConnections,
  updatePreference,
  type SocialConnection,
  type SocialProvider,
} from '../services/socialSharingService';
import { contentColumn } from '../config/layout';

// Covers the one scenario where this still matters: a provider's backend
// config (socialSharingConfig.js) is ever unset again — e.g. a Railway env
// var gets removed. Not shown in normal operation now that both providers
// are configured.
const REASON_COPY: Record<string, string> = {
  social_sharing_not_configured: "This isn't available yet — check back soon.",
  invalid_state: 'That connection attempt expired. Try connecting again.',
  invalid_provider: 'Something went wrong. Try again.',
  missing_code: 'Connection was cancelled.',
  connect_failed: "Couldn't finish connecting. Try again.",
  cancelled: 'Connection was cancelled.',
};

const PROVIDERS: Array<{ value: SocialProvider; label: string; icon: string; color: string }> = [
  { value: 'tiktok', label: 'TikTok', icon: 'T', color: '#25f4ee' },
  { value: 'instagram', label: 'Instagram', icon: 'I', color: '#e1306c' },
];

function connectionFor(connections: SocialConnection[], provider: SocialProvider) {
  return connections.find((c) => c.provider === provider && c.status !== 'revoked') ?? null;
}

export default function SocialSharingScreen() {
  const navigation = useNavigation<any>();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [connecting, setConnecting] = useState<SocialProvider | null>(null);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Settings');
  };

  const loadAll = useCallback(async () => {
    try {
      const result = await listConnections();
      setConnections(result.connections);
    } catch {
      // Network hiccup — leave whatever was last loaded rather than clearing it.
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleConnect = async (provider: SocialProvider) => {
    setConnecting(provider);
    try {
      await connectProvider(provider);
      await loadAll();
    } catch (error) {
      // connectProvider throws an ApiError only if the initial /connect
      // call itself 503s (provider unconfigured); any failure past that
      // point (cancelled, expired state, provider-side error) is a plain
      // Error whose message is the reason code from the callback redirect.
      const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : undefined;
      if (code === 'cancelled' || code === 'missing_code') {
        // User backed out of the browser — not worth an alert.
        return;
      }
      Alert.alert('Could not connect', (code && REASON_COPY[code]) || 'Could not connect right now.');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = (provider: SocialProvider, label: string) => {
    Alert.alert('Disconnect?', `Bes will no longer be able to share to ${label}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectProvider(provider);
            await loadAll();
          } catch {
            Alert.alert('Error', 'Could not disconnect. Check your connection.');
          }
        },
      },
    ]);
  };

  const handleTogglePreference = async (provider: SocialProvider, value: boolean) => {
    try {
      const updated = await updatePreference(provider, value);
      setConnections((current) => current.map((c) => (c.provider === updated.provider ? updated : c)));
    } catch {
      Alert.alert('Error', 'Could not update this preference. Check your connection.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="social-sharing-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerButton} activeOpacity={0.82}>
            <Text style={styles.headerButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Emergency Social Sharing</Text>
          <View style={styles.headerButton} />
        </View>

        <LinearGradient colors={['rgba(12, 16, 45, 0.98)', 'rgba(10, 12, 38, 0.94)']} style={styles.hero}>
          <View style={styles.heroIcon}>
            <Text style={styles.heroIconText}>S</Text>
          </View>
          <Text style={styles.heroText}>
            Connect TikTok or Instagram so that, once an emergency is active, you can choose to share
            video from it. This is completely separate from Bes's core safety tools — recording, your
            location, and alerting your trusted contacts all work the same whether or not you connect
            anything here, and can never be delayed or affected by this feature.
          </Text>
        </LinearGradient>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            TikTok posts shared from Bes stay private to your account (visible only to you) until this
            app completes TikTok's review for public posting.
          </Text>
        </View>

        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          {PROVIDERS.map((provider) => {
            const connection = connectionFor(connections, provider.value);
            const isConnected = connection?.status === 'connected';
            return (
              <View key={provider.value} style={styles.row}>
                <View style={styles.rowTop}>
                  <View style={[styles.providerIcon, { backgroundColor: `${provider.color}24` }]}>
                    <Text style={[styles.providerIconText, { color: provider.color }]}>{provider.icon}</Text>
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel}>{provider.label}</Text>
                    <Text style={styles.rowStatus}>
                      {isConnected
                        ? `Connected${connection?.providerUsername ? ` as @${connection.providerUsername}` : ''}`
                        : 'Not connected'}
                    </Text>
                  </View>
                  {isConnected ? (
                    <TouchableOpacity
                      style={styles.disconnectButton}
                      activeOpacity={0.82}
                      onPress={() => handleDisconnect(provider.value, provider.label)}
                      testID={`social-disconnect-${provider.value}`}
                    >
                      <Text style={styles.disconnectText}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.connectButton}
                      activeOpacity={0.82}
                      disabled={connecting === provider.value}
                      onPress={() => handleConnect(provider.value)}
                      testID={`social-connect-${provider.value}`}
                    >
                      <Text style={styles.connectText}>
                        {connecting === provider.value ? 'Connecting…' : 'Connect'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {isConnected && (
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Share during emergency</Text>
                    <Switch
                      value={connection?.enabledForEmergency ?? true}
                      onValueChange={(value) => handleTogglePreference(provider.value, value)}
                      trackColor={{ false: '#2a2a40', true: '#7c3aed' }}
                      thumbColor="#fff"
                    />
                  </View>
                )}
              </View>
            );
          })}
        </LinearGradient>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: { paddingBottom: 42, paddingHorizontal: 18, paddingTop: 16, ...contentColumn },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  headerButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  headerButtonText: { color: '#fff', fontSize: 28, fontWeight: '500' },
  title: { color: '#fff', fontSize: 19, fontWeight: '900', flex: 1, textAlign: 'center' },
  hero: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 20,
    marginBottom: 16,
    padding: 24,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(137, 76, 255, 0.24)',
    borderRadius: 48,
    height: 80,
    width: 80,
    justifyContent: 'center',
  },
  heroIconText: { color: '#b777ff', fontSize: 32, fontWeight: '900' },
  heroText: { color: '#d8d2e8', fontSize: 14, lineHeight: 20, flex: 1 },
  banner: {
    backgroundColor: 'rgba(90,78,148,0.16)',
    borderColor: 'rgba(149,110,255,0.28)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    padding: 14,
  },
  bannerText: { color: '#c7bfe0', fontSize: 12, lineHeight: 18 },
  card: {
    borderColor: 'rgba(122,87,214,0.28)',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  row: { gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  providerIconText: { fontSize: 16, fontWeight: '800' },
  rowCopy: { flex: 1 },
  rowLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowStatus: { color: '#aaa', fontSize: 13, marginTop: 2 },
  connectButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  connectText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  disconnectButton: {
    borderColor: 'rgba(231,76,60,0.6)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  disconnectText: { color: '#e74c3c', fontSize: 13, fontWeight: '700' },
  toggleRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(122,87,214,0.2)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  toggleLabel: { color: '#d8d2e8', fontSize: 13 },
});
