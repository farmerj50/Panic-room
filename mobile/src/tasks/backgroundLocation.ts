import AsyncStorage from '@react-native-async-storage/async-storage';

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
      const loc = data?.locations?.[0];
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
      }
    },
  );
} catch {
  // expo-task-manager not installed — background location disabled until npm install runs.
}
