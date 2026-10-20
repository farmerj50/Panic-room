// Emergency GPS history: every point is written to an encrypted on-device
// queue BEFORE it is sent, and removed only after the server acknowledges
// it — so location evidence survives lost signal and app restarts.
//
// - Encrypted with nacl.secretbox; the key lives in SecureStore (see
//   secureStorage.ts), the ciphertext in AsyncStorage.
// - Bounded: at most MAX_POINTS_PER_EMERGENCY per emergency. When full, older
//   points are thinned (first, newest and outlier points are kept) rather
//   than dropping new ones; the thinned count is reported to the server.
// - Live points go out immediately; failures retry with backoff, on app
//   foreground and at the next launch (see resumeLocationQueue).
// - Points of an emergency recorded without signal wait until that emergency
//   exists on the server (see pendingEmergencies); sending them earlier would
//   be rejected as "not found" and dropped.
// Never throws to callers — GPS upload must not affect the emergency flow.
import './naclSetup';
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, apiRequest } from './apiClient';
import { pendingCreateIds, registerEmergencyIdRemap, serverIdFor } from './pendingEmergencies';
import { getItemAsync, setItemAsync } from './secureStorage';

export type QueuedPoint = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  recordedAt: string;
};

type EmergencyQueue = { points: QueuedPoint[]; thinned: number };
type QueueState = Record<string, EmergencyQueue>;

export const LOCATION_QUEUE_STORAGE_KEY = 'bes_location_queue';
const KEY_NAME = 'bes_location_queue_key';
export const MAX_POINTS_PER_EMERGENCY = 2000;
export const MIN_RECORD_INTERVAL_MS = 15_000;
export const MIN_RECORD_DISTANCE_M = 25;
const OUTLIER_DISTANCE_M = 100;
const BATCH_SIZE = 200;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

let key: Uint8Array | null = null;
let chain: Promise<unknown> = Promise.resolve();
let flushing: Promise<void> | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const lastRecorded: Record<string, { t: number; latitude: number; longitude: number }> = {};

// Serializes every read-modify-write of the stored queue.
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function getKey(): Promise<Uint8Array> {
  if (key) return key;
  const stored = await getItemAsync(KEY_NAME);
  if (stored) {
    key = decodeBase64(stored);
    return key;
  }
  key = nacl.randomBytes(nacl.secretbox.keyLength);
  await setItemAsync(KEY_NAME, encodeBase64(key));
  return key;
}

async function load(): Promise<QueueState> {
  const raw = await AsyncStorage.getItem(LOCATION_QUEUE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const [version, nonce, box] = raw.split(':');
    if (version !== 'v1') return {};
    const opened = nacl.secretbox.open(decodeBase64(box), decodeBase64(nonce), await getKey());
    return opened ? (JSON.parse(encodeUTF8(opened)) as QueueState) : {};
  } catch {
    console.warn('Location queue could not be read — starting a new one.');
    return {};
  }
}

async function save(state: QueueState) {
  const ids = Object.keys(state).filter((id) => state[id].points.length > 0 || state[id].thinned > 0);
  if (ids.length === 0) {
    await AsyncStorage.removeItem(LOCATION_QUEUE_STORAGE_KEY);
    return;
  }
  const trimmed: QueueState = Object.fromEntries(ids.map((id) => [id, state[id]]));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(decodeUTF8(JSON.stringify(trimmed)), nonce, await getKey());
  await AsyncStorage.setItem(LOCATION_QUEUE_STORAGE_KEY, `v1:${encodeBase64(nonce)}:${encodeBase64(box)}`);
}

// Halves the history without losing its shape: always keeps the first and
// newest points and any point far from both neighbours (a turn or jump).
export function thinPoints(points: QueuedPoint[], max = MAX_POINTS_PER_EMERGENCY): { points: QueuedPoint[]; dropped: number } {
  let current = points;
  let dropped = 0;
  let ignoreOutliers = false;
  while (current.length > max) {
    const kept: QueuedPoint[] = [current[0]];
    for (let i = 1; i < current.length - 1; i += 1) {
      const outlier =
        !ignoreOutliers &&
        distanceMeters(current[i], current[i - 1]) > OUTLIER_DISTANCE_M &&
        distanceMeters(current[i], current[i + 1]) > OUTLIER_DISTANCE_M;
      if (i % 2 === 0 || outlier) kept.push(current[i]);
    }
    kept.push(current[current.length - 1]);
    if (kept.length === current.length) {
      ignoreOutliers = true; // everything was an outlier — thin regardless
      continue;
    }
    dropped += current.length - kept.length;
    current = kept;
  }
  return { points: current, dropped };
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushLocationQueue();
  }, delay);
}

// Records a GPS fix for an active emergency (throttled to one per 15s unless
// the person moved more than 25m) and sends it right away.
export async function recordLocationPoint(
  localEmergencyId: string,
  loc: { latitude: number; longitude: number; accuracy?: number | null; timestamp?: number },
  now = Date.now(),
): Promise<boolean> {
  try {
    const emergencyId = await serverIdFor(localEmergencyId);
    const previous = lastRecorded[emergencyId];
    if (previous && now - previous.t < MIN_RECORD_INTERVAL_MS && distanceMeters(previous, loc) < MIN_RECORD_DISTANCE_M) {
      return false;
    }
    lastRecorded[emergencyId] = { t: now, latitude: loc.latitude, longitude: loc.longitude };
    const point: QueuedPoint = {
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy ?? null,
      recordedAt: new Date(loc.timestamp ?? now).toISOString(),
    };
    await locked(async () => {
      const state = await load();
      const queue = state[emergencyId] ?? { points: [], thinned: 0 };
      queue.points.push(point);
      if (queue.points.length > MAX_POINTS_PER_EMERGENCY) {
        const thinned = thinPoints(queue.points);
        queue.points = thinned.points;
        queue.thinned += thinned.dropped;
      }
      state[emergencyId] = queue;
      await save(state);
    });
    void flushLocationQueue();
    return true;
  } catch (error) {
    console.warn('Could not queue GPS point', error);
    return false;
  }
}

async function flushOnce(): Promise<void> {
  const state = await locked(load);
  const waitingForServer = await pendingCreateIds();
  let hadFailure = false;
  for (const emergencyId of Object.keys(state)) {
    if (waitingForServer.has(emergencyId)) continue; // flushed once it's created
    const queue = state[emergencyId];
    while (queue.points.length > 0 || queue.thinned > 0) {
      const batch = queue.points.slice(0, BATCH_SIZE);
      const thinned = queue.thinned;
      let remove = false;
      try {
        if (batch.length > 0) {
          await apiRequest(`/api/emergency/${emergencyId}/locations`, {
            method: 'POST',
            body: JSON.stringify({ points: batch, thinned }),
          });
        }
        remove = true;
      } catch (error) {
        // 400/404/409: the server will never accept these points (invalid,
        // emergency deleted, or outside its time window) — stop retrying them.
        if (error instanceof ApiError && [400, 404, 409].includes(error.status)) {
          console.warn(`GPS points rejected for emergency (${error.status}) — not retried.`);
          remove = true;
        } else {
          hadFailure = true;
        }
      }
      if (!remove) break;
      const sent = new Set(batch.map((p) => p.recordedAt));
      await locked(async () => {
        const latest = await load();
        const current = latest[emergencyId];
        if (current) {
          current.points = current.points.filter((p) => !sent.has(p.recordedAt));
          current.thinned = Math.max(0, current.thinned - thinned);
          await save(latest);
        }
      });
      queue.points = queue.points.slice(batch.length);
      queue.thinned = 0;
    }
  }
  if (hadFailure) {
    failures += 1;
    scheduleRetry();
  } else {
    failures = 0;
  }
}

// Sends everything queued. Concurrent callers share one in-flight flush.
export function flushLocationQueue(): Promise<void> {
  if (!flushing) {
    flushing = flushOnce()
      .catch((error) => console.warn('GPS queue flush failed', error))
      .finally(() => {
        flushing = null;
      });
  }
  return flushing;
}

// An older server ignored the phone's emergency id: move its queued points.
registerEmergencyIdRemap((from, to) =>
  locked(async () => {
    const current = await load();
    if (current[from]) {
      const into = current[to] ?? { points: [], thinned: 0 };
      current[to] = { points: [...into.points, ...current[from].points], thinned: into.thinned + current[from].thinned };
      delete current[from];
      await save(current);
    }
    if (lastRecorded[from]) {
      lastRecorded[to] = lastRecorded[from];
      delete lastRecorded[from];
    }
    if ((await getActiveGpsEmergency()) === from) await setActiveGpsEmergency(to);
  }),
);

// App launch / foreground: retry anything left from an outage or a restart.
export function resumeLocationQueue(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return flushLocationQueue();
}

// The emergency whose GPS history is being recorded, persisted so the
// background location task (which may run with the screen off or in a fresh
// JS context) can add its fixes too.
export const ACTIVE_GPS_EMERGENCY_KEY = 'bes_active_gps_emergency';

export async function setActiveGpsEmergency(emergencyId: string | null) {
  try {
    if (emergencyId) await AsyncStorage.setItem(ACTIVE_GPS_EMERGENCY_KEY, emergencyId);
    else await AsyncStorage.removeItem(ACTIVE_GPS_EMERGENCY_KEY);
  } catch {}
}

export async function getActiveGpsEmergency(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_GPS_EMERGENCY_KEY);
  } catch {
    return null;
  }
}

export async function pendingLocationCount(): Promise<number> {
  const state = await locked(load);
  return Object.values(state).reduce((sum, queue) => sum + queue.points.length, 0);
}

export function __resetLocationQueueForTests() {
  key = null;
  chain = Promise.resolve();
  flushing = null;
  failures = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const id of Object.keys(lastRecorded)) delete lastRecorded[id];
}
