import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecure = new Map<string, string>();
jest.mock('../secureStorage', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecure.set(key, value);
  },
}));

const mockApiRequest = jest.fn();
jest.mock('../apiClient', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, apiRequest: (...args: unknown[]) => mockApiRequest(...args) };
});

const mockLocation = {
  fg: 'granted',
  bg: 'granted',
  running: false,
  starts: [] as Array<Record<string, unknown>>,
  stops: 0,
};
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  getForegroundPermissionsAsync: async () => ({ status: mockLocation.fg }),
  getBackgroundPermissionsAsync: async () => ({ status: mockLocation.bg }),
  hasStartedLocationUpdatesAsync: async () => mockLocation.running,
  startLocationUpdatesAsync: async (_task: string, options: Record<string, unknown>) => {
    mockLocation.starts.push(options);
    mockLocation.running = true;
  },
  stopLocationUpdatesAsync: async () => {
    mockLocation.stops += 1;
    mockLocation.running = false;
  },
}));

const mockStartMonitoring = jest.fn(async () => true);
jest.mock('../locationService', () => ({
  BACKGROUND_LOCATION_TASK: 'PANICROOM_BG_LOCATION',
  startBackgroundLocationMonitoring: () => mockStartMonitoring(),
}));

import { ApiError } from '../apiClient';
import { __resetLocationQueueForTests, flushLocationQueue, getActiveGpsEmergency, recordLocationPoint } from '../locationQueue';
import { __resetPendingEmergenciesForTests } from '../pendingEmergencies';
import {
  RECOVERY_TTL_MS,
  beginRecoveryTracking,
  getRecoveryTracking,
  markPhoneRecovered,
  onRecoveryFix,
  reconcileRecoveryTracking,
  shouldStartRecoveryTracking,
} from '../recoveryTracking';
import { publishTracking } from '../trackingEvents';

const ID = '11111111-1111-4111-8111-111111111111';
const SETTINGS_KEY = 'panicroom_emergency_settings';
const ENDED = new Date(Date.now() - 60_000).toISOString();

const setSettings = (s: Record<string, unknown>) => AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
const calls = (match: string) => mockApiRequest.mock.calls.filter(([url]) => String(url).includes(match));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  __resetLocationQueueForTests();
  __resetPendingEmergenciesForTests();
  Object.assign(mockLocation, { fg: 'granted', bg: 'granted', running: false, starts: [], stops: 0 });
  mockStartMonitoring.mockClear();
  mockApiRequest.mockReset().mockResolvedValue({ state: 'RECOVERY_TRACKING', recovery: null });
  await setSettings({ recoveryTrackingEnabled: true });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('eligibility', () => {
  test('only with the setting on and both location permissions granted', async () => {
    expect(await shouldStartRecoveryTracking()).toBe(true);
    mockLocation.bg = 'denied';
    expect(await shouldStartRecoveryTracking()).toBe(false);
    mockLocation.bg = 'granted';
    await setSettings({ recoveryTrackingEnabled: false });
    expect(await shouldStartRecoveryTracking()).toBe(false);
    await AsyncStorage.removeItem(SETTINGS_KEY); // default: off
    expect(await shouldStartRecoveryTracking()).toBe(false);
  });
});

describe('lifecycle', () => {
  test('begin: 72 h from the SOS end, GPS history continues under the same emergency, ~30 s updates with a notification', async () => {
    expect(await beginRecoveryTracking(ID, ENDED)).toBe(true);
    const state = await getRecoveryTracking();
    expect(new Date(state!.expiresAt).getTime() - new Date(ENDED).getTime()).toBe(RECOVERY_TTL_MS);
    expect(await getActiveGpsEmergency()).toBe(ID);
    expect(mockLocation.starts[0]).toMatchObject({ timeInterval: 30_000, distanceInterval: 0 });
    expect((mockLocation.starts[0].foregroundService as { notificationTitle: string }).notificationTitle).toMatch(/recovery tracking is on/i);
  });

  test('a remote stop reaches the phone through a GPS upload: it stops, restores normal monitoring, and never tells the server', async () => {
    await setSettings({ recoveryTrackingEnabled: true, backgroundLocationEnabled: true });
    await beginRecoveryTracking(ID, ENDED);
    mockApiRequest.mockImplementation(async (url: string) => {
      if (url.includes('/locations')) throw new ApiError('stopped', 409, 'TRACKING_STOPPED');
      return {};
    });
    await recordLocationPoint(ID, { latitude: 40, longitude: -74, batteryLevel: 50 }, Date.now());
    await flushLocationQueue();
    await flush();
    await flush();
    expect(await getRecoveryTracking()).toBeNull();
    expect(await getActiveGpsEmergency()).toBeNull();
    expect(mockStartMonitoring).toHaveBeenCalled(); // Background Location Monitoring was on before
    expect(calls('/recovery/stop')).toHaveLength(0);
  });

  test('"Phone recovered" without signal: stops at once, the server stop is kept and sent later', async () => {
    await beginRecoveryTracking(ID, ENDED);
    mockApiRequest.mockRejectedValue(new Error('Network request failed'));
    await markPhoneRecovered();
    expect(await getRecoveryTracking()).toBeNull();
    expect(mockLocation.running).toBe(false);

    mockApiRequest.mockReset().mockResolvedValue({ state: 'CLOSED', recovery: null });
    await reconcileRecoveryTracking();
    const [stop] = calls('/recovery/stop');
    expect(stop[0]).toBe(`/api/emergency/${ID}/recovery/stop`);
    expect(JSON.parse(stop[1].body)).toEqual({ reason: 'recovered' });
    mockApiRequest.mockClear();
    await reconcileRecoveryTracking();
    expect(calls('/recovery/stop')).toHaveLength(0); // sent once
  });

  test('expires on the phone after 72 hours even with no signal', async () => {
    await beginRecoveryTracking(ID, ENDED);
    mockApiRequest.mockRejectedValue(new Error('offline'));
    await onRecoveryFix(new Date(ENDED).getTime() + RECOVERY_TTL_MS + 1);
    expect(await getRecoveryTracking()).toBeNull();
  });

  test('location permission taken away: stops and tells the server why', async () => {
    await beginRecoveryTracking(ID, ENDED);
    mockLocation.bg = 'denied';
    await reconcileRecoveryTracking();
    expect(await getRecoveryTracking()).toBeNull();
    await flush();
    expect(JSON.parse(calls('/recovery/stop')[0][1].body)).toEqual({ reason: 'permission_revoked' });
  });

  test('after a reboot or force-stop, opening the app resumes the updates Android dropped', async () => {
    await beginRecoveryTracking(ID, ENDED);
    mockLocation.running = false; // what a reboot leaves behind
    mockLocation.starts = [];
    await reconcileRecoveryTracking();
    expect(mockLocation.starts).toHaveLength(1);
    expect(await getRecoveryTracking()).not.toBeNull();
  });

  test('the server ending it (expired / stopped elsewhere) is followed on the next check', async () => {
    await beginRecoveryTracking(ID, ENDED);
    mockApiRequest.mockResolvedValue({ state: 'CLOSED', recovery: { endReason: 'remote_stop' } });
    await reconcileRecoveryTracking();
    expect(await getRecoveryTracking()).toBeNull();
  });

  test('never restarted by the server: a RECOVERY_TRACKING reply with nothing running on the phone does nothing', async () => {
    publishTracking(ID, { state: 'RECOVERY_TRACKING', recovery: { startedAt: ENDED, expiresAt: ENDED, endedAt: null, endReason: null } });
    await flush();
    expect(await getRecoveryTracking()).toBeNull();
    expect(mockLocation.starts).toHaveLength(0);
  });

  test('the background task asks the server at most every 5 minutes', async () => {
    await beginRecoveryTracking(ID, ENDED);
    const t = Date.now();
    await onRecoveryFix(t);
    await onRecoveryFix(t + 60_000);
    await onRecoveryFix(t + 4 * 60_000);
    expect(calls('/tracking')).toHaveLength(1);
    await onRecoveryFix(t + 5 * 60_000 + 1);
    expect(calls('/tracking')).toHaveLength(2);
  });
});
