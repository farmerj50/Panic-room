import { Alert } from 'react-native';

// Google Play's Prominent Disclosure and Consent Requirement: the OS runtime
// permission dialog does NOT satisfy this on its own — the app must show its
// own in-app explanation of what location data is collected and how it's
// used, and get an explicit affirmative action, *before* the system prompt
// appears. This gates every foreground/background location permission
// request in the app so that requirement is met consistently everywhere.
// https://support.google.com/googleplay/android-developer/answer/9799150

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

// Show before requesting foreground (While Using the App) location access.
export function confirmForegroundLocationDisclosure(): Promise<boolean> {
  return confirm(
    'Location Access',
    'Bes collects your precise location data to support emergency safety features, including sharing your location with your trusted contacts (and 911, if enabled) during an active emergency. Your location is used only to provide these safety features and is not used for advertising.',
  );
}

// Show before requesting background ("Allow all the time") location access.
// Wording mirrors Google Play's Prominent Disclosure guidance for background
// location: state that the app collects location, name the feature, and say
// explicitly that it continues even when the app is closed / not in use.
export function confirmBackgroundLocationDisclosure(): Promise<boolean> {
  return confirm(
    'Background Location',
    'Bes collects location data to enable Background Location Monitoring, emergency location sharing, and safety features even when the app is closed or not in use. Location data is used to provide these safety features and is not used for advertising.\n\nOn the next screen, select "Allow all the time."',
  );
}
