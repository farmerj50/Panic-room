import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert() is a total no-op stub (see
// node_modules/react-native-web/dist/exports/Alert/index.js) — it never
// renders anything and never invokes a button's onPress, so any code that
// awaits a Promise resolved from inside Alert.alert's buttons hangs forever
// on web. Every permission disclosure in this app depends on exactly that,
// so this branches to the browser's native window.confirm() there instead —
// a real, synchronous, blocking dialog — while native platforms keep using
// the normal two-button Alert.
export function confirmDialog(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }

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
