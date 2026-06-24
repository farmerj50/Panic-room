import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer, useNavigation, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { EmergencyProvider } from '../context/EmergencyContext';
import { RootStackParamList, TabParamList, UnauthStackParamList } from './types';
import { ACTION_ACTIVATE_SOS, restoreLockScreenButton, setupNotificationHandler } from '../services/lockScreenService';

import LandingScreen from '../screens/LandingScreen';
import AuthScreen from '../screens/AuthScreen';
import HomeScreen from '../screens/HomeScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import SetupScreen from '../screens/SetupScreen';
import ContactsScreen from '../screens/ContactsScreen';
import EvidenceScreen from '../screens/EvidenceScreen';
import ResourcesScreen from '../screens/ResourcesScreen';
import SafetyPlanScreen from '../screens/SafetyPlanScreen';
import JournalScreen from '../screens/JournalScreen';
import MessagesScreen from '../screens/MessagesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EmergencySettingsScreen from '../screens/EmergencySettingsScreen';

// expo-notifications loads at runtime so the app still boots before `npm install`.
// Once installed, the module resolves normally; until then every call is a no-op.
type _NotifResponse = { actionIdentifier: string };
type _NotifModule = {
  getLastNotificationResponseAsync(): Promise<_NotifResponse | null>;
  addNotificationResponseReceivedListener(cb: (r: _NotifResponse) => void): { remove(): void };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: _NotifModule | null = null;
try { Notifications = require('expo-notifications') as _NotifModule; } catch {}  // eslint-disable-line @typescript-eslint/no-require-imports

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const UnauthStack = createNativeStackNavigator<UnauthStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, string> = {
  Home: 'H',
  Resources: 'R',
  SafetyPlan: 'S',
  Emergency: '!',
  Messages: 'M',
  Profile: 'P',
  Journal: 'J',
};

const linking = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          Home: '',
          Resources: 'resources',
          SafetyPlan: 'safety-plan',
          Emergency: 'emergency',
          Messages: 'messages',
          Profile: 'profile',
          Journal: 'journal',
        },
      },
      Setup: 'setup',
      Contacts: 'contacts',
      Evidence: 'evidence',
      Safety: 'safety',
      EmergencySettings: 'emergency-settings',
    },
  },
};

function TabIcon({ route, color, focused }: { route: keyof TabParamList; color: string; focused: boolean }) {
  const isEmergency = route === 'Emergency';
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: isEmergency ? '#ef445b' : focused ? 'rgba(124, 58, 237, 0.36)' : 'transparent',
        borderColor: isEmergency ? 'rgba(255,255,255,0.42)' : 'transparent',
        borderRadius: isEmergency ? 22 : 18,
        borderWidth: isEmergency ? 2 : 0,
        height: isEmergency ? 44 : 34,
        justifyContent: 'center',
        shadowColor: isEmergency ? '#ef445b' : '#7c3aed',
        shadowOpacity: isEmergency ? 0.34 : 0,
        shadowRadius: isEmergency ? 12 : 0,
        width: 44,
      }}
    >
      <Text style={{ color: isEmergency ? '#fff' : color, fontSize: isEmergency ? 24 : 17, fontWeight: '900', lineHeight: isEmergency ? 28 : 20 }}>
        {TAB_ICONS[route]}
      </Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#d7b4ff',
        tabBarInactiveTintColor: '#d8d2e8',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginTop: 0 },
        tabBarItemStyle: { alignItems: 'center', justifyContent: 'center', minHeight: 64 },
        tabBarStyle: {
          backgroundColor: 'rgba(5, 8, 25, 0.96)',
          borderTopColor: 'rgba(122, 87, 214, 0.3)',
          height: 78,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarIcon: ({ color, focused }) => (
          <TabIcon route={route.name as keyof TabParamList} color={color} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Resources" component={ResourcesScreen} />
      <Tab.Screen name="SafetyPlan" component={SafetyPlanScreen} options={{ title: 'Safety Plan' }} />
      <Tab.Screen
        name="Emergency"
        component={EmergencyScreen}
        options={{
          tabBarLabel: 'Emergency',
          tabBarStyle: { display: 'none' },
          tabBarButtonTestID: 'tab-emergency-btn',
          tabBarAccessibilityLabel: 'tab-emergency-btn',
        }}
      />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Journal" component={JournalScreen} options={{ tabBarButton: () => null }} />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={{ alignItems: 'center', backgroundColor: '#050715', flex: 1, justifyContent: 'center' }}>
      <Text style={{ color: '#d9bcff', fontSize: 18, fontWeight: '900' }}>PanicRoom</Text>
    </View>
  );
}

function TabRedirect({ tab }: { tab: keyof TabParamList }) {
  const navigation = useNavigation<any>();

  useEffect(() => {
    navigation.replace('Main', { screen: tab });
  }, [navigation, tab]);

  return <LoadingScreen />;
}

function HomeRedirect() {
  return <TabRedirect tab="Home" />;
}

function ResourcesRedirect() {
  return <TabRedirect tab="Resources" />;
}

function SafetyPlanRedirect() {
  return <TabRedirect tab="SafetyPlan" />;
}

function EmergencyRedirect() {
  return <TabRedirect tab="Emergency" />;
}

function JournalRedirect() {
  return <TabRedirect tab="Journal" />;
}

function MessagesRedirect() {
  return <TabRedirect tab="Messages" />;
}

function ProfileRedirect() {
  return <TabRedirect tab="Profile" />;
}

function UnauthenticatedNavigator() {
  return (
    <NavigationContainer>
      <UnauthStack.Navigator
        initialRouteName="Landing"
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <UnauthStack.Screen name="Landing" component={LandingScreen} />
        <UnauthStack.Screen name="Auth" component={AuthScreen} />
      </UnauthStack.Navigator>
    </NavigationContainer>
  );
}

function AuthGate() {
  const { status } = useAuth();

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'unauthenticated') return <UnauthenticatedNavigator />;

  return <AuthenticatedNavigator />;
}

function AuthenticatedNavigator() {
  const { consumePostAuthTab, postAuthTab } = useAuth();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);
  const pendingRoute = useRef<keyof RootStackParamList | null>(null);

  const goEmergency = useCallback(() => {
    if (navReady && navigationRef.isReady()) {
      navigationRef.navigate('Emergency');
    } else {
      pendingRoute.current = 'Emergency';
    }
  }, [navReady, navigationRef]);

  useEffect(() => {
    if (!Notifications) return;

    setupNotificationHandler();

    // Cold-start: app was opened by tapping the notification action.
    // Wrapped in try/catch — this API throws UnavailabilityError on web.
    try {
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response?.actionIdentifier === ACTION_ACTIVATE_SOS) goEmergency();
      }).catch(() => {});
    } catch {}

    // Foreground / background: notification action tapped while app is alive
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.actionIdentifier === ACTION_ACTIVATE_SOS) goEmergency();
    });

    // Re-post the persistent SOS notification if the user had it enabled
    restoreLockScreenButton();

    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const routePostAuthTab = useCallback(() => {
    if (!postAuthTab || !navigationRef.isReady()) return false;

    navigationRef.navigate('Main', { screen: postAuthTab });
    consumePostAuthTab();
    return true;
  }, [consumePostAuthTab, navigationRef, postAuthTab]);

  const onNavReady = useCallback(() => {
    setNavReady(true);
    if (routePostAuthTab()) return;

    if (pendingRoute.current && navigationRef.isReady()) {
      navigationRef.navigate(pendingRoute.current);
      pendingRoute.current = null;
    }
  }, [navigationRef, routePostAuthTab]);

  useEffect(() => {
    if (!navReady) return;
    routePostAuthTab();
  }, [navReady, routePostAuthTab]);

  return (
    <EmergencyProvider>
      <NavigationContainer ref={navigationRef} linking={linking as never} onReady={onNavReady}>
        <Stack.Navigator
          initialRouteName="Main"
          screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
        >
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Home" component={HomeRedirect} />
          <Stack.Screen name="Resources" component={ResourcesRedirect} />
          <Stack.Screen name="SafetyPlan" component={SafetyPlanRedirect} />
          <Stack.Screen name="Emergency" component={EmergencyRedirect} />
          <Stack.Screen name="Journal" component={JournalRedirect} />
          <Stack.Screen name="Messages" component={MessagesRedirect} />
          <Stack.Screen name="Profile" component={ProfileRedirect} />
          <Stack.Screen name="Setup" component={SetupScreen} />
          <Stack.Screen name="Contacts" component={ContactsScreen} />
          <Stack.Screen name="Evidence" component={EvidenceScreen} />
          <Stack.Screen name="Safety" component={SafetyPlanScreen} />
          <Stack.Screen name="EmergencySettings" component={EmergencySettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </EmergencyProvider>
  );
}

export default function AppNavigator() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
