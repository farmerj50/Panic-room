import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockUpdateSettings = jest.fn().mockResolvedValue(undefined);
let mockSettings = { recoveryTrackingEnabled: false, emergencyCallMode: 'contacts', cameraAutoRecord: true, audioAutoRecord: true };
jest.mock('../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({ emergencySettings: mockSettings, updateEmergencySettings: mockUpdateSettings }),
}));
jest.mock('../../context/SubscriptionContext', () => ({ useSubscription: () => ({ isPremium: false }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: unknown }) => children }));
jest.mock('../../services/lockScreenService', () => ({
  isLockScreenButtonEnabled: async () => false,
  enableLockScreenButton: jest.fn(),
  disableLockScreenButton: jest.fn(),
}));
jest.mock('../../services/locationService', () => ({
  isBackgroundLocationRunning: async () => false,
  startBackgroundLocationMonitoring: jest.fn(),
  stopBackgroundLocationMonitoring: jest.fn(),
}));
jest.mock('../../services/analyticsService', () => ({ trackEvent: jest.fn() }));
jest.mock('../../utils/permissionDisclosures', () => ({ confirmNotificationsDisclosure: jest.fn() }));

const mockConsent = { recovery: true, fg: true, bg: true };
jest.mock('../../utils/locationDisclosure', () => ({
  confirmRecoveryTrackingDisclosure: async () => mockConsent.recovery,
  confirmForegroundLocationDisclosure: async () => mockConsent.fg,
  confirmBackgroundLocationDisclosure: async () => mockConsent.bg,
}));
const mockPerm = { fg: 'granted', bg: 'undetermined', bgRequest: 'granted' };
const mockRequestBg = jest.fn(async () => ({ status: mockPerm.bgRequest }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: async () => ({ status: mockPerm.fg }),
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getBackgroundPermissionsAsync: async () => ({ status: mockPerm.bg }),
  requestBackgroundPermissionsAsync: () => mockRequestBg(),
}));
const mockSetConsent = jest.fn();
jest.mock('../../services/emergencyService', () => ({ setRecoveryTrackingConsent: (v: boolean) => mockSetConsent(v) }));
const mockEndRecovery = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/recoveryTracking', () => ({ endRecoveryTracking: (r: string) => mockEndRecovery(r) }));

import EmergencySettingsScreen from '../EmergencySettingsScreen';

beforeEach(() => {
  mockSettings = { ...mockSettings, recoveryTrackingEnabled: false };
  Object.assign(mockConsent, { recovery: true, fg: true, bg: true });
  Object.assign(mockPerm, { fg: 'granted', bg: 'undetermined', bgRequest: 'granted' });
  mockUpdateSettings.mockClear();
  mockRequestBg.mockClear();
  mockSetConsent.mockReset().mockResolvedValue({ enabled: true });
  mockEndRecovery.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

async function toggle(value: boolean) {
  render(<EmergencySettingsScreen />);
  await act(async () => {});
  await act(async () => {
    fireEvent(screen.getByTestId('recovery-tracking-switch'), 'valueChange', value);
  });
}

test('off by default, with the exact setting wording', async () => {
  render(<EmergencySettingsScreen />);
  await act(async () => {});
  expect(screen.getByTestId('recovery-tracking-switch').props.value).toBe(false);
  expect(screen.getByText('Keep tracking my phone after an emergency until I mark it recovered.')).toBeTruthy();
});

test('turning on: explanation and consent first, then "Allow all the time", then consent recorded on the server', async () => {
  await toggle(true);
  expect(mockRequestBg).toHaveBeenCalled();
  expect(mockSetConsent).toHaveBeenCalledWith(true);
  expect(mockUpdateSettings).toHaveBeenCalledWith({ recoveryTrackingEnabled: true });
});

test('declining the explanation changes nothing and asks for no permission', async () => {
  mockConsent.recovery = false;
  await toggle(true);
  expect(mockRequestBg).not.toHaveBeenCalled();
  expect(mockSetConsent).not.toHaveBeenCalled();
  expect(mockUpdateSettings).not.toHaveBeenCalled();
});

test('"Allow all the time" refused: stays off and points to Settings', async () => {
  mockPerm.bgRequest = 'denied';
  await toggle(true);
  expect(mockSetConsent).not.toHaveBeenCalled();
  expect(mockUpdateSettings).not.toHaveBeenCalled();
  expect((Alert.alert as jest.Mock).mock.calls[0][0]).toMatch(/Allow all the time/);
});

test('no connection: consent can\'t be recorded, so the setting stays off', async () => {
  mockPerm.bg = 'granted';
  mockSetConsent.mockRejectedValue(new Error('Network request failed'));
  await toggle(true);
  expect(mockUpdateSettings).not.toHaveBeenCalled();
  expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('No connection');
});

test('turning off: stops any tracking running now and withdraws consent', async () => {
  mockSettings = { ...mockSettings, recoveryTrackingEnabled: true };
  await toggle(false);
  expect(mockUpdateSettings).toHaveBeenCalledWith({ recoveryTrackingEnabled: false });
  expect(mockEndRecovery).toHaveBeenCalledWith('consent_withdrawn');
  expect(mockSetConsent).toHaveBeenCalledWith(false);
});
