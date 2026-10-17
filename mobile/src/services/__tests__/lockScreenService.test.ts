import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: 'max' },
}));
const mockNotif = jest.requireMock('expo-notifications');

import {
  disableLockScreenButton,
  enableLockScreenButton,
  isLockScreenButtonEnabled,
  restoreLockScreenButton,
  setupNotificationHandler,
} from '../lockScreenService';

async function handlerFor(identifier: string) {
  setupNotificationHandler();
  const { handleNotification } = mockNotif.setNotificationHandler.mock.calls.at(-1)[0];
  return handleNotification({ request: { identifier } });
}

describe('lock-screen SOS notification', () => {
  const originalOS = Platform.OS;
  beforeEach(async () => {
    jest.clearAllMocks();
    mockNotif.scheduleNotificationAsync.mockResolvedValue('id');
    mockNotif.setNotificationChannelAsync.mockResolvedValue(undefined);
    mockNotif.setNotificationCategoryAsync.mockResolvedValue(undefined);
    mockNotif.dismissNotificationAsync.mockResolvedValue(undefined);
    mockNotif.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
    await AsyncStorage.clear();
    mockNotif.requestPermissionsAsync.mockResolvedValue({ granted: true });
    Object.defineProperty(Platform, 'OS', { value: 'android' });
  });
  afterAll(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

  it('keeps the SOS button listed in the shade while the app is open, without a banner or sound', async () => {
    expect(await handlerFor('panicroom-lock-screen-button')).toEqual({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('still shows other notifications normally while the app is open', async () => {
    expect(await handlerFor('something-else')).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('never returns all-false show flags for the SOS button (Android would drop it)', async () => {
    const behavior = await handlerFor('panicroom-lock-screen-button');
    expect(behavior.shouldShowList || behavior.shouldShowBanner).toBe(true);
  });

  it('posts the button on the SOS channel (public on the lock screen) with the ACTIVATE SOS action', async () => {
    expect(await enableLockScreenButton()).toBe(true);
    expect(mockNotif.setNotificationChannelAsync).toHaveBeenCalledWith(
      'panicroom-sos',
      expect.objectContaining({ lockscreenVisibility: 1, importance: 5 }),
    );
    expect(mockNotif.setNotificationCategoryAsync).toHaveBeenCalledWith('PANICROOM_EMERGENCY', [
      expect.objectContaining({ identifier: 'ACTIVATE_SOS', options: expect.objectContaining({ opensAppToForeground: true }) }),
    ]);
    expect(mockNotif.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'panicroom-lock-screen-button',
        content: expect.objectContaining({ categoryIdentifier: 'PANICROOM_EMERGENCY', sticky: true }),
        trigger: { channelId: 'panicroom-sos' },
      }),
    );
    expect(await isLockScreenButtonEnabled()).toBe(true);
  });

  it('does not post or remember the button when notification permission is denied', async () => {
    mockNotif.requestPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await enableLockScreenButton()).toBe(false);
    expect(mockNotif.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await isLockScreenButtonEnabled()).toBe(false);
  });

  it('removes the button when disabled and does not bring it back at launch', async () => {
    await enableLockScreenButton();
    await disableLockScreenButton();
    expect(mockNotif.dismissNotificationAsync).toHaveBeenCalledWith('panicroom-lock-screen-button');
    mockNotif.scheduleNotificationAsync.mockClear();
    await restoreLockScreenButton();
    expect(mockNotif.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('re-posts the button at launch when the user had it on', async () => {
    await enableLockScreenButton();
    mockNotif.scheduleNotificationAsync.mockClear();
    await restoreLockScreenButton();
    expect(mockNotif.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
