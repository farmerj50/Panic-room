import { useEffect } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../context/AuthContext';
import { useEmergencyContext } from '../../context/EmergencyContext';
import { trackEvent } from '../../services/analyticsService';
import type { RootStackParamList } from '../../navigation/types';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import OnboardingCard from './OnboardingCard';

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
    <OnboardingCard
      icon="✓"
      iconColor="#12c48b"
      title="You're ready."
      body="Bes is set up and ready to protect you. You can review or change any permission at any time in Settings › Bes."
      primaryLabel="Continue to Bes"
      onPrimaryPress={handleContinue}
      primaryTestID="onboarding-complete-cta"
    />
  );
}
