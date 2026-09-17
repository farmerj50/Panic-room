import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import PermissionStepScreen from '../screens/onboarding/PermissionStepScreen';
import OnboardingWelcomeScreen from '../screens/onboarding/OnboardingWelcomeScreen';
import OnboardingCompleteScreen from '../screens/onboarding/OnboardingCompleteScreen';
import { CAMERA_STEP, LOCATION_STEP, MICROPHONE_STEP } from '../screens/onboarding/permissionSteps';
import type { PermStatus } from '../services/corePermissions';

// One-time, post-registration sequence: Welcome -> Camera -> Microphone ->
// Location -> Complete. Each permission step accumulates the prior steps'
// results through route params so Complete can log/act on the full set.
export type OnboardingStackParamList = {
  Welcome: undefined;
  CameraStep: undefined;
  MicrophoneStep: { camera: PermStatus };
  LocationStep: { camera: PermStatus; microphone: PermStatus };
  Complete: { camera: PermStatus; microphone: PermStatus; location: PermStatus };
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

function CameraStepScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  return (
    <PermissionStepScreen
      config={CAMERA_STEP}
      onDone={(camera) => navigation.navigate('MicrophoneStep', { camera })}
    />
  );
}

function MicrophoneStepScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const route = useRoute<RouteProp<OnboardingStackParamList, 'MicrophoneStep'>>();
  return (
    <PermissionStepScreen
      config={MICROPHONE_STEP}
      onDone={(microphone) =>
        navigation.navigate('LocationStep', { camera: route.params.camera, microphone })
      }
    />
  );
}

function LocationStepScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const route = useRoute<RouteProp<OnboardingStackParamList, 'LocationStep'>>();
  return (
    <PermissionStepScreen
      config={LOCATION_STEP}
      onDone={(location) =>
        navigation.navigate('Complete', {
          camera: route.params.camera,
          microphone: route.params.microphone,
          location,
        })
      }
    />
  );
}

export default function OnboardingNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="Welcome" component={OnboardingWelcomeScreen} />
      <Stack.Screen name="CameraStep" component={CameraStepScreen} />
      <Stack.Screen name="MicrophoneStep" component={MicrophoneStepScreen} />
      <Stack.Screen name="LocationStep" component={LocationStepScreen} />
      <Stack.Screen name="Complete" component={OnboardingCompleteScreen} />
    </Stack.Navigator>
  );
}
