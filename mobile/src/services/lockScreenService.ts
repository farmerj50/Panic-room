import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-notifications is native-only and may not be installed yet.
// All functions degrade gracefully if the module is absent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notif: any = null;
try { Notif = require('expo-notifications'); } catch {} // eslint-disable-line @typescript-eslint/no-require-imports

const CHANNEL_ID = 'panicroom-sos';
const NOTIFICATION_ID = 'panicroom-lock-screen-button';

export const EMERGENCY_CATEGORY_ID = 'PANICROOM_EMERGENCY';
export const ACTION_ACTIVATE_SOS = 'ACTIVATE_SOS';

const ENABLED_KEY = 'panicroom_lock_screen_enabled';

/** Call once at app startup (in AppNavigator). Configures foreground notification display. */
export function setupNotificationHandler() {
  if (!Notif) return;
  Notif.setNotificationHandler({
    handleNotification: async (notification: { request: { identifier: string } }) => {
      const isSosButton = notification.request.identifier === NOTIFICATION_ID;
      return {
        shouldShowAlert: !isSosButton,
        shouldPlaySound: !isSosButton,
        shouldSetBadge: false,
      };
    },
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notif) return false;
  const { granted } = await Notif.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
      allowCriticalAlerts: true,
      provideAppNotificationSettings: true,
    },
  });
  return Boolean(granted);
}

async function createAndroidChannel() {
  if (!Notif || Platform.OS !== 'android') return;
  await Notif.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Emergency SOS Button',
    description: 'Persistent panic button shown on your lock screen.',
    importance: Notif.AndroidImportance.MAX,
    lockscreenVisibility: Notif.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
}

async function registerSosCategory() {
  if (!Notif) return;
  await Notif.setNotificationCategoryAsync(EMERGENCY_CATEGORY_ID, [
    {
      identifier: ACTION_ACTIVATE_SOS,
      buttonTitle: '🚨 ACTIVATE SOS',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        // false = lock screen action does NOT require Face ID / PIN before opening app
        isAuthenticationRequired: false,
      },
    },
  ]);
}

/**
 * Posts a persistent notification in the notification shade and on the lock screen.
 * The "ACTIVATE SOS" button can be tapped without unlocking the device.
 * Returns false if expo-notifications isn't installed or permission was denied.
 */
export async function enableLockScreenButton(): Promise<boolean> {
  if (!Notif) return false;
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return false;

    await createAndroidChannel();
    await registerSosCategory();

    await Notif.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '🛡️ PanicRoom Active',
        body: 'Tap ACTIVATE SOS for immediate emergency help',
        categoryIdentifier: EMERGENCY_CATEGORY_ID,
        data: { source: 'lock_screen_button' },
        color: '#ef445b',
        sticky: true,
        autoDismiss: false,
        priority: Notif.AndroidNotificationPriority?.MAX,
      },
      trigger: null,
    });

    await AsyncStorage.setItem(ENABLED_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}

export async function disableLockScreenButton(): Promise<void> {
  if (!Notif) return;
  try { await Notif.dismissNotificationAsync(NOTIFICATION_ID); } catch {}
  try { await Notif.cancelScheduledNotificationAsync(NOTIFICATION_ID); } catch {}
  await AsyncStorage.removeItem(ENABLED_KEY);
}

export async function isLockScreenButtonEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(ENABLED_KEY);
  return val === 'true';
}

/** Re-posts the SOS notification on app launch if the user previously enabled it. */
export async function restoreLockScreenButton(): Promise<void> {
  const enabled = await isLockScreenButtonEnabled();
  if (enabled) await enableLockScreenButton();
}
