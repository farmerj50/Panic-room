import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { useEmergencyContext } from '../../context/EmergencyContext';
import { trackEvent } from '../../services/analyticsService';
import type { RootStackParamList } from '../../navigation/types';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

export default function OnboardingCompleteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const route = useRoute<RouteProp<OnboardingStackParamList, 'Complete'>>();
  const { consumeOnboarding, consumePostAuthTab } = useAuth();
  const { markSetupDone } = useEmergencyContext();

  const { camera, microphone, location } = route.params;
  const allGranted = camera === 'granted' && microphone === 'granted' && location === 'granted';

  useEffect(() => {
    trackEvent('onboarding_completed', { camera, microphone, location });
  }, [camera, microphone, location]);

  const handleContinue = async () => {
    if (allGranted) {
      await markSetupDone();
    }
    consumeOnboarding();
    consumePostAuthTab();
    navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('Main', { screen: 'Home' });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.checkmark}>✓</Text>
        <Text style={styles.title}>You're ready.</Text>
        <Text style={styles.body}>
          Bes is set up and ready to protect you. You can review or change any permission at any time in
          Settings › Bes.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.86}
          onPress={handleContinue}
          style={styles.ctaButton}
          testID="onboarding-complete-cta"
          accessibilityLabel="onboarding-complete-cta"
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>Continue to Bes</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715', justifyContent: 'space-between' },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  checkmark: {
    color: '#12c48b',
    fontSize: 56,
    fontWeight: '900',
    marginBottom: 20,
  },
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
