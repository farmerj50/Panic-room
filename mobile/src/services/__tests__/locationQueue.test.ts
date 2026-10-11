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
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, apiRequest: (...args: unknown[]) => mockApiRequest(...args) };
});

import { ApiError } from '../apiClient';
import {
  LOCATION_QUEUE_STORAGE_KEY,
  MAX_POINTS_PER_EMERGENCY,
  __resetLocationQueueForTests,
  flushLocationQueue,
  pendingLocationCount,
  recordLocationPoint,
  thinPoints,
} from '../locationQueue';

const EMERGENCY = 'e-1';
const T0 = Date.parse('2026-10-10T12:00:00Z');
const NYC = { latitude: 40.7128, longitude: -74.006 };

const sentPoints = () => mockApiRequest.mock.calls.flatMap(([, init]) => JSON.parse(init.body).points);

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  __resetLocationQueueForTests();
  mockApiRequest.mockReset().mockResolvedValue({ accepted: 1 });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('records at most one point per 15s unless the person moved more than 25m', async () => {
  expect(await recordLocationPoint(EMERGENCY, NYC, T0)).toBe(true);
  expect(await recordLocationPoint(EMERGENCY, { latitude: 40.71281, longitude: -74.006 }, T0 + 5000)).toBe(false);
  expect(await recordLocationPoint(EMERGENCY, { latitude: 40.7135, longitude: -74.006 }, T0 + 6000)).toBe(true); // ~80m
  expect(await recordLocationPoint(EMERGENCY, { latitude: 40.7135, longitude: -74.006 }, T0 + 22_000)).toBe(true);
});

test('points are stored encrypted, sent with their fix time, and removed only after the server accepts them', async () => {
  mockApiRequest.mockRejectedValue(new Error('Network request failed'));
  await recordLocationPoint(EMERGENCY, { ...NYC, accuracy: 6, timestamp: T0 - 2000 }, T0);
  await flushLocationQueue();

  const raw = (await AsyncStorage.getItem(LOCATION_QUEUE_STORAGE_KEY))!;
  expect(raw.startsWith('v1:')).toBe(true);
  expect(raw).not.toContain('40.71');
  expect(raw).not.toContain(EMERGENCY);
  expect(await pendingLocationCount()).toBe(1);

  mockApiRequest.mockReset().mockResolvedValue({ accepted: 1 });
  await flushLocationQueue();
  expect(mockApiRequest).toHaveBeenCalledWith(`/api/emergency/${EMERGENCY}/locations`, expect.objectContaining({ method: 'POST' }));
  expect(sentPoints()).toEqual([{ ...NYC, accuracy: 6, recordedAt: new Date(T0 - 2000).toISOString() }]);
  expect(await pendingLocationCount()).toBe(0);
});

test('the queue survives an app restart and backfills after reconnecting', async () => {
  mockApiRequest.mockRejectedValue(new Error('offline'));
  await recordLocationPoint(EMERGENCY, NYC, T0);
  await recordLocationPoint(EMERGENCY, { latitude: 40.72, longitude: -74.0 }, T0 + 20_000);
  await flushLocationQueue();
  __resetLocationQueueForTests(); // app killed; key stays in SecureStore

  mockApiRequest.mockReset().mockResolvedValue({ accepted: 2 });
  await flushLocationQueue();
  expect(sentPoints()).toHaveLength(2);
  expect(await pendingLocationCount()).toBe(0);
});

test('points the server will never accept (409 outside the window) stop being retried', async () => {
  mockApiRequest.mockRejectedValue(new ApiError('outside window', 409));
  await recordLocationPoint(EMERGENCY, NYC, T0);
  await flushLocationQueue();
  expect(await pendingLocationCount()).toBe(0);
});

test('thinning keeps the first, newest and outlier points, and reports how many were dropped', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({
    latitude: 40 + i * 0.00001,
    longitude: -74,
    recordedAt: new Date(T0 + i * 15_000).toISOString(),
  }));
  points[5] = { ...points[5], latitude: 41 }; // a jump far from both neighbours
  const { points: kept, dropped } = thinPoints(points, 7);
  expect(kept.length).toBeLessThanOrEqual(7);
  expect(dropped).toBe(10 - kept.length);
  expect(kept[0]).toBe(points[0]);
  expect(kept[kept.length - 1]).toBe(points[9]);
  expect(kept).toContain(points[5]);
});

test('a full queue thins old points instead of dropping new ones, and sends the thinned count', async () => {
  mockApiRequest.mockRejectedValue(new Error('offline'));
  for (let i = 0; i <= MAX_POINTS_PER_EMERGENCY; i += 1) {
    await recordLocationPoint(EMERGENCY, { latitude: 40 + i * 0.001, longitude: -74 }, T0 + i * 15_000);
  }
  await flushLocationQueue();
  const count = await pendingLocationCount();
  expect(count).toBeLessThanOrEqual(MAX_POINTS_PER_EMERGENCY);

  mockApiRequest.mockReset().mockResolvedValue({ accepted: 1 });
  await flushLocationQueue();
  const bodies = mockApiRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(bodies[0].thinned).toBe(MAX_POINTS_PER_EMERGENCY + 1 - count);
  const all = bodies.flatMap((b) => b.points);
  expect(all[all.length - 1].recordedAt).toBe(new Date(T0 + MAX_POINTS_PER_EMERGENCY * 15_000).toISOString());
}, 60_000);
