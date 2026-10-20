import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCreateEmergency = jest.fn();
const mockUpdateEmergency = jest.fn();
jest.mock('../emergencyService', () => ({
  createEmergency: (...args: unknown[]) => mockCreateEmergency(...args),
  updateEmergency: (...args: unknown[]) => mockUpdateEmergency(...args),
}));
jest.mock('../apiClient', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError };
});

import { ApiError } from '../apiClient';
import {
  PENDING_EMERGENCIES_KEY,
  __resetPendingEmergenciesForTests,
  endEmergency,
  isOnServer,
  newEmergencyId,
  pendingEmergencyCount,
  registerEmergencyIdRemap,
  registerPendingEmergency,
  resumePendingEmergencies,
  subscribeToPendingEmergencies,
  syncPendingEmergencies,
} from '../pendingEmergencies';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';
const AT = '2026-10-18T09:00:00.000Z';
const echo = async (d: { id?: string }) => ({ id: d.id ?? 'server-generated' });

beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
  __resetPendingEmergenciesForTests();
  mockCreateEmergency.mockReset().mockImplementation(echo);
  mockUpdateEmergency.mockReset().mockResolvedValue({});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('ids are UUID v4, generated on the phone', () => {
  expect(newEmergencyId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('is stored on the device before any network call, and survives an app restart', async () => {
  mockCreateEmergency.mockRejectedValue(new Error('Network request failed'));
  await registerPendingEmergency({ id: ID, activatedAt: AT, latitude: 1, longitude: 2 });
  expect(JSON.parse((await AsyncStorage.getItem(PENDING_EMERGENCIES_KEY))!).creates[0]).toEqual(expect.objectContaining({ id: ID, activatedAt: AT }));
  await syncPendingEmergencies();
  expect(await isOnServer(ID)).toBe(false);

  __resetPendingEmergenciesForTests(); // app killed and relaunched
  mockCreateEmergency.mockImplementation(echo);
  expect(await pendingEmergencyCount()).toBe(1);
  await resumePendingEmergencies();
  expect(await isOnServer(ID)).toBe(true);
  expect(mockCreateEmergency).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID, activatedAt: AT, latitude: 1, longitude: 2, status: 'ACTIVE' }));
  expect(await AsyncStorage.getItem(PENDING_EMERGENCIES_KEY)).toBeNull();
});

test('concurrent syncs share one run: never two creates in flight for the same emergency', async () => {
  let release!: () => void;
  mockCreateEmergency.mockImplementation((d: { id: string }) => new Promise((r) => (release = () => r({ id: d.id }))));
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  const runs = [syncPendingEmergencies(), syncPendingEmergencies(), resumePendingEmergencies()];
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all(runs);
  expect(mockCreateEmergency).toHaveBeenCalledTimes(1);
});

test('retries with backoff until the server answers, then announces it once', async () => {
  jest.useFakeTimers();
  const events: unknown[] = [];
  subscribeToPendingEmergencies((e) => events.push(e));
  mockCreateEmergency.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockImplementation(echo);
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await syncPendingEmergencies();
  await jest.advanceTimersByTimeAsync(3_000); // second attempt fails
  await jest.advanceTimersByTimeAsync(10_000); // third succeeds
  expect(mockCreateEmergency).toHaveBeenCalledTimes(3);
  expect(events.filter((e) => (e as { type: string }).type === 'synced')).toEqual([{ type: 'synced', id: ID, serverId: ID, endedBeforeSync: false }]);
  await jest.advanceTimersByTimeAsync(600_000);
  expect(mockCreateEmergency).toHaveBeenCalledTimes(3);
});

test('ended before it reached the server: created resolved, with its real end time, and no status PATCH', async () => {
  mockCreateEmergency.mockRejectedValue(new Error('offline'));
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await endEmergency(ID, '2026-10-18T09:05:00.000Z');
  mockCreateEmergency.mockImplementation(echo);
  await resumePendingEmergencies();
  expect(mockCreateEmergency).toHaveBeenLastCalledWith(expect.objectContaining({ id: ID, status: 'RESOLVED', endedAt: '2026-10-18T09:05:00.000Z' }));
  expect(mockUpdateEmergency).not.toHaveBeenCalled();
});

test('ended after it reached the server: a failed status update is kept and retried', async () => {
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await syncPendingEmergencies();
  mockUpdateEmergency.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  await endEmergency(ID);
  expect(JSON.parse((await AsyncStorage.getItem(PENDING_EMERGENCIES_KEY))!).resolves).toHaveLength(1);
  await resumePendingEmergencies();
  expect(mockUpdateEmergency).toHaveBeenLastCalledWith(ID, { status: 'RESOLVED' });
  expect(await AsyncStorage.getItem(PENDING_EMERGENCIES_KEY)).toBeNull();
});

test('an older server that ignores the id: queued evidence is moved to the id it returns', async () => {
  const remap = jest.fn().mockResolvedValue(undefined);
  registerEmergencyIdRemap(remap);
  mockCreateEmergency.mockResolvedValue({ id: 'server-9' });
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await syncPendingEmergencies();
  expect(remap).toHaveBeenCalledWith(ID, 'server-9');
});

test('a refused id (409/400) still gets the emergency created, without the id', async () => {
  mockCreateEmergency.mockRejectedValueOnce(new ApiError('Emergency id already in use', 409)).mockResolvedValue({ id: 'server-7' });
  const events: unknown[] = [];
  subscribeToPendingEmergencies((e) => events.push(e));
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await syncPendingEmergencies();
  expect(mockCreateEmergency).toHaveBeenCalledTimes(2);
  expect(mockCreateEmergency.mock.calls[1][0]).not.toHaveProperty('id');
  expect(events).toContainEqual({ type: 'synced', id: ID, serverId: 'server-7', endedBeforeSync: false });
});

test('registering the same emergency twice keeps one entry', async () => {
  mockCreateEmergency.mockRejectedValue(new Error('offline'));
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  expect(await pendingEmergencyCount()).toBe(1);
});

test('older server: later status updates go to the id it returned (alias kept on the device)', async () => {
  mockCreateEmergency.mockResolvedValue({ id: 'server-9' });
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  await syncPendingEmergencies();
  await endEmergency(ID);
  expect(mockUpdateEmergency).toHaveBeenCalledWith('server-9', { status: 'RESOLVED' });
});

test('ended while its create was in flight: the resolved status is still sent', async () => {
  let release!: () => void;
  mockCreateEmergency.mockImplementation((d: { id: string }) => new Promise((r) => (release = () => r({ id: d.id }))));
  await registerPendingEmergency({ id: ID, activatedAt: AT });
  const sync = syncPendingEmergencies();
  await new Promise((r) => setTimeout(r, 0));
  await endEmergency(ID, '2026-10-18T09:02:00.000Z'); // create still in flight (sent as ACTIVE)
  release();
  await sync;
  await resumePendingEmergencies();
  expect(mockUpdateEmergency).toHaveBeenCalledWith(ID, { status: 'RESOLVED' });
});
