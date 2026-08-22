import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Home: undefined;
  Resources: undefined;
  SafetyPlan: undefined;
  Emergency: undefined;
  Journal: undefined;
  Messages: undefined;
  Profile: undefined;
  Setup: undefined;
  Contacts: undefined;
  Evidence: undefined;
  Safety: undefined;
  EmergencySettings: undefined;
  CovertMessages: undefined;
  PinSetup: undefined;
  DecoySettings: undefined;
};

export type TabParamList = {
  Home: undefined;
  Resources: undefined;
  SafetyPlan: undefined;
  Emergency: undefined;
  Messages: undefined;
  Profile: undefined;
  Journal: undefined;
};

export type UnauthStackParamList = {
  Landing: undefined;
  Auth: { mode?: 'login' | 'register' } | undefined;
  Login: { mode?: 'login' } | undefined;
  Register: { mode?: 'register' } | undefined;
  ForgotPassword: undefined;
};
