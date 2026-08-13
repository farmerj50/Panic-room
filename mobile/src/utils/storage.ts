import AsyncStorage from '@react-native-async-storage/async-storage';

// General-purpose, non-sensitive app state (settings, recovery flags).
// Auth tokens and crypto keys belong in tokenStorage.ts / keyService.ts
// (SecureStore-backed) instead — never store secrets here.

export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
