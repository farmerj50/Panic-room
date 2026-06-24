import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKGROUND_LOCATION_TASK = 'PANICROOM_BG_LOCATION';

// ─── Foreground location ────────────────────────────────────────────────────

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    const granted = await requestLocationPermission();
    if (!granted) return null;
  }
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
}

export async function watchLocation(
  callback: (loc: { latitude: number; longitude: number }) => void,
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
    (loc) => callback({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }),
  );
}

// ─── Background location ────────────────────────────────────────────────────
// expo-task-manager is an optional native-only package.
// All background location functions degrade gracefully on web or before npm install.

export async function startBackgroundLocationMonitoring(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') return false;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRegistered) {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (hasStarted) return true;
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30_000,
      distanceInterval: 100,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'PanicRoom',
        notificationBody: 'Location monitoring active for your safety',
        notificationColor: '#7C3AED',
      },
      pausesUpdatesAutomatically: false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundLocationMonitoring(): Promise<void> {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {}
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Returns the last location written by the background task, or null. */
export async function getLastKnownLocation(): Promise<{
  latitude: number;
  longitude: number;
  timestamp?: number;
} | null> {
  try {
    const raw = await AsyncStorage.getItem('panicroom_last_location');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
