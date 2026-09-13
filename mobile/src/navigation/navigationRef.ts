import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

// Shared so code outside the navigation tree (EmergencyContext's relaunch
// recovery flow) can navigate without needing a React Navigation hook —
// AppNavigator attaches this to its NavigationContainer instead of creating
// its own local ref via useNavigationContainerRef().
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
