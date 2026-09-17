import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { trackEvent } from '../../services/analyticsService';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import OnboardingCard from './OnboardingCard';

export default function OnboardingWelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();

  useEffect(() => {
    trackEvent('onboarding_started');
  }, []);

  return (
    <OnboardingCard
      icon="B"
      title="You're almost set up."
      body={
        'Bes uses camera, microphone, and location permissions only for the safety features you choose ' +
        "to enable. We'll explain each permission before Android asks for it, and you can skip any " +
        'request and change it later in Settings.'
      }
      footnote="You can skip any permission and enable it later."
      primaryLabel="Get Started"
      onPrimaryPress={() => navigation.navigate('CameraStep')}
      primaryTestID="onboarding-welcome-cta"
    />
  );
}
