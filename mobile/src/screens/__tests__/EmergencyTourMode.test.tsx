import { act, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockCreateEmergency = jest.fn();
const mockNotifyEmergencyContacts = jest.fn();
const mockRunCoreActivation = jest.fn();
const mockTriggerEmergency = jest.fn();
const mockRequestPermissions = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: { tourMode: true } }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
  useMicrophonePermissions: () => [{ granted: false }, jest.fn()],
}));

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('../../context/TourContext', () => ({
  useTourTarget: () => ({ current: null }),
  useTourTargetPress: (_key: string, handler: () => void) => handler,
  useTour: () => ({ phase: 'touring', paused: false, currentStep: null, next: jest.fn() }),
}));

jest.mock('../../components/LiveLocationMap', () => () => null);

jest.mock('../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({
    orderedContacts: [],
    priorityContact: null,
    emergencyId: null,
    setEmergencyId: jest.fn(),
    triggerEmergency: mockTriggerEmergency,
    resolveEmergency: jest.fn(),
    emergencySettings: { cameraAutoRecord: false, audioAutoRecord: false, emergencyCallMode: 'dialer' },
    runCoreActivation: mockRunCoreActivation,
    stopAudioCapture: jest.fn(),
    stopLocationWatch: jest.fn(),
  }),
}));

jest.mock('../../services/corePermissions', () => ({
  ensurePermissions: (...args: unknown[]) => mockRequestPermissions(...args),
  getCameraStatus: jest.fn().mockResolvedValue('undetermined'),
  getMicrophoneStatus: jest.fn().mockResolvedValue('undetermined'),
  getForegroundLocationStatus: jest.fn().mockResolvedValue('undetermined'),
  requestCameraPermission: jest.fn(),
  requestMicrophonePermission: jest.fn(),
  requestForegroundLocationPermission: jest.fn(),
}));

jest.mock('../../services/experiments', () => ({
  getExistingOnboardingVariant: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/emergencyService', () => ({
  createEmergency: (...args: unknown[]) => mockCreateEmergency(...args),
  notifyEmergencyContacts: (...args: unknown[]) => mockNotifyEmergencyContacts(...args),
  uploadEmergencyFile: jest.fn(),
  updateEmergency: jest.fn(),
  resolveEmergencyRequest: jest.fn(),
}));

jest.mock('../../services/uploadService', () => ({ uploadFile: jest.fn() }));

jest.mock('../../hooks/useAppStateEmergencyGuard', () => ({
  clearInProgressEmergency: jest.fn(),
  useAppStateEmergencyGuard: jest.fn(),
}));

jest.mock('../../utils/mapUrl', () => ({ mapUrl: () => '' }));

import EmergencyScreen from '../EmergencyScreen';

describe('Emergency tourMode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCreateEmergency.mockClear();
    mockNotifyEmergencyContacts.mockClear();
    mockRunCoreActivation.mockClear();
    mockTriggerEmergency.mockClear();
    mockRequestPermissions.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders the static demo, never the live countdown', () => {
    render(<EmergencyScreen />);
    expect(screen.getByTestId('emergency-tour-banner')).toBeTruthy();
    expect(screen.queryByTestId('emergency-countdown-screen')).toBeNull();
    expect(screen.queryByTestId('emergency-live-screen')).toBeNull();
  });

  test('never activates, notifies, dials, or prompts for permissions, even past the countdown', async () => {
    const openURL = jest.spyOn(Linking, 'openURL');

    render(<EmergencyScreen />);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockCreateEmergency).not.toHaveBeenCalled();
    expect(mockNotifyEmergencyContacts).not.toHaveBeenCalled();
    expect(mockRunCoreActivation).not.toHaveBeenCalled();
    expect(mockTriggerEmergency).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();

    openURL.mockRestore();
  });
});
