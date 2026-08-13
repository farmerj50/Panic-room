import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store has NO web implementation at all — its web module
// (ExpoSecureStore.web.ts) is a literal empty object, so every method
// throws "is not a function" at runtime on web, not just a missing feature
// warning. This app genuinely ships a web target (deployed, not just used
// for local dev), so fall back to localStorage there. That isn't OS
// keychain-secure, but it's the standard, practical approach for this exact
// gap across the Expo ecosystem, and is strictly better than crashing.
const isWeb = Platform.OS === 'web';

function getLocalStorage(): Storage | null {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) return getLocalStorage()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) {
    getLocalStorage()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) {
    getLocalStorage()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
