import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveGpsEmergency, recordLocationPoint } from '../services/locationQueue';
import { getBatteryPercent } from '../services/batteryLevel';
import { onRecoveryFix } from '../services/recoveryTracking';

export const BACKGROUND_LOCATION_TASK = 'PANICROOM_BG_LOCATION';

// expo-task-manager and expo-location are only available in native builds.
// Guard with try/catch so the web bundle doesn't break before `npm install`.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TaskManager = require('expo-task-manager');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Location = require('expo-location');

  TaskManager.defineTask(
    BACKGROUND_LOCATION_TASK,
    async ({ data, error }: { data: { locations: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }[] }; error: unknown }) => {
      if (error) return;
      const fixes = [...(data?.locations ?? [])].sort((a, b) => a.timestamp - b.timestamp);
      const loc = fixes[fixes.length - 1];
      if (loc) {
        await AsyncStorage.setItem(
          'panicroom_last_location',
          JSON.stringify({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            timestamp: loc.timestamp,
          }),
        );
        // During an emergency (incl. Hidden SOS with the screen off) and
        // recovery tracking, these fixes also go into the encrypted GPS
        // history queue — every fix Android delivered, each with its own
        // observation time (a batch arrives after the OS deferred updates).
        const emergencyId = await getActiveGpsEmergency();
        if (emergencyId) {
          const batteryLevel = await getBatteryPercent();
          for (const fix of fixes) {
            await recordLocationPoint(emergencyId, {
              latitude: fix.coords.latitude,
              longitude: fix.coords.longitude,
              accuracy: fix.coords.accuracy,
              batteryLevel,
              timestamp: fix.timestamp,
            }, fix.timestamp);
          }
          await onRecoveryFix();
        }
      }
    },
  );
} catch {
  // expo-task-manager not installed — background location disabled until npm install runs.
}
