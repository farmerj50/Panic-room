const mockConfirmCameraDisclosure = jest.fn();
const mockConfirmMicrophoneDisclosure = jest.fn();
jest.mock('../../utils/permissionDisclosures', () => ({
  confirmCameraDisclosure: (...args: unknown[]) => mockConfirmCameraDisclosure(...args),
  confirmMicrophoneDisclosure: (...args: unknown[]) => mockConfirmMicrophoneDisclosure(...args),
}));

const mockConfirmForegroundLocationDisclosure = jest.fn();
jest.mock('../../utils/locationDisclosure', () => ({
  confirmForegroundLocationDisclosure: (...args: unknown[]) => mockConfirmForegroundLocationDisclosure(...args),
}));

const mockTrackEvent = jest.fn();
jest.mock('../analyticsService', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const mockRequestCameraPermissionsAsync = jest.fn();
const mockRequestMicrophonePermissionsAsync = jest.fn();
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(),
    requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermissionsAsync(...args),
    getMicrophonePermissionsAsync: jest.fn(),
    requestMicrophonePermissionsAsync: (...args: unknown[]) => mockRequestMicrophonePermissionsAsync(...args),
  },
}));

const mockRequestForegroundPermissionsAsync = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForegroundPermissionsAsync(...args),
}));

import { requestCameraPermission, requestForegroundLocationPermission, requestMicrophonePermission } from '../corePermissions';

describe('corePermissions request functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirmCameraDisclosure.mockResolvedValue(true);
    mockConfirmMicrophoneDisclosure.mockResolvedValue(true);
    mockConfirmForegroundLocationDisclosure.mockResolvedValue(true);
    mockRequestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    mockRequestMicrophonePermissionsAsync.mockResolvedValue({ granted: true });
    mockRequestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true });
  });

  test('requestCameraPermission fires explanation-viewed before the disclosure, then granted, threading context/variant', async () => {
    const status = await requestCameraPermission({ context: 'onboarding', variant: 'onboarding' });

    expect(status).toBe('granted');
    expect(mockTrackEvent.mock.calls[0]).toEqual([
      'camera_permission_explanation_viewed',
      { context: 'onboarding', variant: 'onboarding' },
    ]);
    expect(mockTrackEvent).toHaveBeenCalledWith('camera_permission_granted', { context: 'onboarding', variant: 'onboarding' });
  });

  test('requestCameraPermission fires denied (never hitting the OS prompt) when the in-app disclosure is declined', async () => {
    mockConfirmCameraDisclosure.mockResolvedValue(false);

    const status = await requestCameraPermission({ context: 'emergency_activation' });

    expect(status).toBe('denied');
    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith('camera_permission_denied', { context: 'emergency_activation' });
  });

  test('requestMicrophonePermission threads context/variant through granted and denied events', async () => {
    mockRequestMicrophonePermissionsAsync.mockResolvedValue({ granted: false });

    const status = await requestMicrophonePermission({ context: 'covert_setup' });

    expect(status).toBe('denied');
    expect(mockTrackEvent).toHaveBeenCalledWith('microphone_permission_explanation_viewed', { context: 'covert_setup' });
    expect(mockTrackEvent).toHaveBeenCalledWith('microphone_permission_denied', { context: 'covert_setup' });
  });

  test('requestForegroundLocationPermission works with no opts at all (undefined params on trackEvent)', async () => {
    const status = await requestForegroundLocationPermission();

    expect(status).toBe('granted');
    expect(mockTrackEvent).toHaveBeenCalledWith('location_permission_explanation_viewed', undefined);
    expect(mockTrackEvent).toHaveBeenCalledWith('location_permission_granted', undefined);
  });
});
