import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { trackEvent } from '../../services/analyticsService';
import type { PermissionStepConfig } from './permissionSteps';
import type { PermStatus } from '../../services/corePermissions';

type Props = {
  config: PermissionStepConfig;
  onDone: (status: PermStatus) => void;
};

// One reusable, config-driven screen for every onboarding permission step —
// avoids the near-duplicate camera/microphone/location screens that would
// otherwise exist. Fires its explanation-viewed event on mount, requests
// the permission on CTA press (corePermissions.ts owns the disclosure +
// analytics for granted/denied), and advances either way.
export default function PermissionStepScreen({ config, onDone }: Props) {
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    trackEvent(config.explanationViewedEvent);
  }, [config.explanationViewedEvent]);

  const handleAllow = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const status = await config.request();
      onDone(status);
    } finally {
      setRequesting(false);
    }
  };

  const handleNotNow = () => {
    onDone('denied');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: `${config.accentColor}24`, borderColor: `${config.accentColor}55` }]}>
          <Text style={[styles.iconText, { color: config.accentColor }]}>{config.icon}</Text>
        </View>

        <Text style={styles.title}>{config.title}</Text>
        <Text style={styles.body}>{config.body}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.86}
          disabled={requesting}
          onPress={handleAllow}
          style={[styles.ctaButton, { backgroundColor: config.accentColor }, requesting && styles.ctaButtonDisabled]}
          testID={`onboarding-${config.key}-cta`}
          accessibilityLabel={`onboarding-${config.key}-cta`}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{requesting ? 'Please wait...' : config.ctaLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={requesting}
          onPress={handleNotNow}
          style={styles.skipButton}
          testID={`onboarding-${config.key}-skip`}
          accessibilityLabel={`onboarding-${config.key}-skip`}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715', justifyContent: 'space-between' },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 44,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    marginBottom: 28,
    width: 88,
  },
  iconText: { fontSize: 34, fontWeight: '900' },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
  body: { color: '#cfc8dd', fontSize: 15, lineHeight: 23, textAlign: 'center' },
  actions: { gap: 12, paddingBottom: 24, paddingHorizontal: 24 },
  ctaButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaButtonDisabled: { opacity: 0.62 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  skipButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  skipText: { color: '#918aaa', fontSize: 13, fontWeight: '800' },
});
