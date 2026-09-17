import { Alert } from 'react-native';

// Sibling to locationDisclosure.ts, same pattern: show an in-app
// explanation and get an explicit affirmative action *before* the OS
// permission dialog appears, rather than relying on the bare system
// prompt (which carries no context about why Bes wants the permission).

function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

export const CAMERA_DISCLOSURE = {
  title: 'Camera Access',
  body:
    "Bes uses your camera to automatically record video evidence the moment you activate an emergency, " +
    "so there's a record of what happened. Bes never records video in the background — only when you " +
    'start an emergency.',
};

export const MICROPHONE_DISCLOSURE = {
  title: 'Microphone Access',
  body:
    'Bes uses your microphone to automatically record audio alongside video when you activate an ' +
    'emergency. Recording only starts when you activate an emergency — never in the background.',
};

export const NOTIFICATIONS_DISCLOSURE = {
  title: 'Notification Access',
  body:
    "Bes needs notification access to show the ACTIVATE SOS button on your lock screen and notification " +
    "shade. Bes won't send you any other notifications without asking first.",
};

export function confirmCameraDisclosure(): Promise<boolean> {
  return confirm(CAMERA_DISCLOSURE.title, CAMERA_DISCLOSURE.body);
}

export function confirmMicrophoneDisclosure(): Promise<boolean> {
  return confirm(MICROPHONE_DISCLOSURE.title, MICROPHONE_DISCLOSURE.body);
}

export function confirmNotificationsDisclosure(): Promise<boolean> {
  return confirm(NOTIFICATIONS_DISCLOSURE.title, NOTIFICATIONS_DISCLOSURE.body);
}
