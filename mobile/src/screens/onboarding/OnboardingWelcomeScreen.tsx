import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { trackEvent } from '../../services/analyticsService';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

export default function OnboardingWelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();

  useEffect(() => {
    trackEvent('onboarding_started');
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.brand}>Bes</Text>
        <Text style={styles.title}>You're almost set up.</Text>
        <Text style={styles.body}>
          Bes only asks for camera, microphone, and location access to power the safety features you
          choose to use. Before each request, we'll explain exactly why — you can always change your
          answer later in Settings › Bes.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.86}
          onPress={() => navigation.navigate('CameraStep')}
          style={styles.ctaButton}
          testID="onboarding-welcome-cta"
          accessibilityLabel="onboarding-welcome-cta"
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715', justifyContent: 'space-between' },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  brand: { color: '#d9bcff', fontSize: 18, fontWeight: '900', marginBottom: 24 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900', marginBottom: 18, textAlign: 'center' },
  body: { color: '#cfc8dd', fontSize: 15, lineHeight: 23, textAlign: 'center' },
  actions: { paddingBottom: 24, paddingHorizontal: 24 },
  ctaButton: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
