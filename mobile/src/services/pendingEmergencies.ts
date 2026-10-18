// Offline-first Emergency: the emergency's id is generated on the phone the
// moment it's activated, and recording, audio and GPS start against it with
// or without signal. Creating it on the server is recorded here first (on the
// device) and retried until it succeeds — with backoff, when the app comes to
// the foreground, and at the next launch. The create is idempotent on the id
// (see backend createEmergencyEvent), so retries never make a second
// emergency.
//
// Until an emergency is on the server, its queued clips and GPS points wait
// (segmentQueue / locationQueue skip it) — uploading them early would be
// rejected as "emergency not found" and lost.
//
// Never throws to callers: Emergency recording must not depend on this.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { ApiError } from './apiClient';
import { createEmergency, updateEmergency } from './emergencyService';

export type PendingEmergency = {
  id: string;
  activatedAt: string;
  latitude?: number;
  longitude?: number;
  // Set when the person ended the emergency before it reached the server:
  // it's then created already resolved, with its real end time.
  endedAt?: string;
  attempts: number;
};

// Emergencies already on the server whose "resolved" status couldn't be sent.
type PendingResolve = { id: string; endedAt: string };

type Stored = { creates: PendingEmergency[]; resolves: PendingResolve[] };

export type SyncEvent = { type: 'synced'; id: string; serverId: string; endedBeforeSync: boolean } | { type: 'changed' };

export const PENDING_EMERGENCIES_KEY = 'bes_pending_emergencies';
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000, 300_000];

let state: Stored | null = null;
let loading: Promise<Stored> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let syncing: Promise<void> | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(event: SyncEvent) => void>();
const remaps: Array<(from: string, to: string) => Promise<void>> = [];

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function load(): Promise<Stored> {
  if (state) return state;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_EMERGENCIES_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
        state = { creates: parsed.creates ?? [], resolves: parsed.resolves ?? [] };
      } catch {
        state = { creates: [], resolves: [] };
      }
      return state;
    })();
  }
  return loading;
}

async function save(): Promise<void> {
  if (!state) return;
  try {
    if (state.creates.length === 0 && state.resolves.length === 0) await AsyncStorage.removeItem(PENDING_EMERGENCIES_KEY);
    else await AsyncStorage.setItem(PENDING_EMERGENCIES_KEY, JSON.stringify(state));
  } catch {
    // Storage full or failing: the in-memory state still drives this session.
  }
}

function emit(event: SyncEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch {}
  }
}

export function newEmergencyId(): string {
  return Crypto.randomUUID();
}

// Queues that hold work keyed by emergency id register here, so an older
// server that ignores the phone's id (returns its own) can be followed.
export function registerEmergencyIdRemap(fn: (from: string, to: string) => Promise<void>) {
  remaps.push(fn);
}

export function subscribeToPendingEmergencies(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Ids still waiting to be created on the server.
export async function pendingCreateIds(): Promise<Set<string>> {
  const s = await load();
  return new Set(s.creates.map((c) => c.id));
}

export async function isOnServer(id: string): Promise<boolean> {
  return !(await pendingCreateIds()).has(id);
}

export async function pendingEmergencyCount(): Promise<number> {
  return (await load()).creates.length;
}

// Recorded on the device before any network call.
export async function registerPendingEmergency(entry: Omit<PendingEmergency, 'attempts'>): Promise<void> {
  await locked(async () => {
    const s = await load();
    if (!s.creates.some((c) => c.id === entry.id)) s.creates.push({ ...entry, attempts: 0 });
    await save();
  });
  emit({ type: 'changed' });
}

// The person ended the emergency. Not on the server yet: remember the end
// time (it's created resolved later). Already there: send the status, and
// keep retrying it if that fails.
export async function endEmergency(id: string, endedAt = new Date().toISOString()): Promise<void> {
  const stillLocal = await locked(async () => {
    const s = await load();
    const pending = s.creates.find((c) => c.id === id);
    if (pending) {
      pending.endedAt = endedAt;
      await save();
      return true;
    }
    return false;
  });
  if (stillLocal) {
    emit({ type: 'changed' });
    void syncPendingEmergencies();
    return;
  }
  try {
    await updateEmergency(id, { status: 'RESOLVED' });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 409)) return;
    await locked(async () => {
      const s = await load();
      if (!s.resolves.some((r) => r.id === id)) s.resolves.push({ id, endedAt });
      await save();
    });
    scheduleRetry();
  }
}

async function syncOne(entry: PendingEmergency): Promise<'done' | 'retry'> {
  let serverId: string;
  try {
    const created = await createEmergency({
      id: entry.id,
      activatedAt: entry.activatedAt,
      latitude: entry.latitude,
      longitude: entry.longitude,
      status: entry.endedAt ? 'RESOLVED' : 'ACTIVE',
      endedAt: entry.endedAt,
    });
    serverId = created.id;
  } catch (error) {
    // 400/409: the server won't take this id (malformed, or — practically
    // impossible — already someone else's). Create it without one and follow
    // the server's id instead of losing the evidence.
    if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
      try {
        const created = await createEmergency({ latitude: entry.latitude, longitude: entry.longitude, status: entry.endedAt ? 'RESOLVED' : 'ACTIVE' });
        serverId = created.id;
      } catch {
        return 'retry';
      }
    } else {
      return 'retry';
    }
  }
  if (serverId !== entry.id) {
    for (const remap of remaps) {
      try {
        await remap(entry.id, serverId);
      } catch (error) {
        console.warn('[Emergency] could not move queued evidence to the server id', error);
      }
    }
  }
  await locked(async () => {
    const s = await load();
    s.creates = s.creates.filter((c) => c.id !== entry.id);
    await save();
  });
  emit({ type: 'synced', id: entry.id, serverId, endedBeforeSync: Boolean(entry.endedAt) });
  return 'done';
}

async function syncAll(): Promise<void> {
  const s = await load();
  let retry = false;
  for (const entry of [...s.creates]) {
    entry.attempts += 1;
    if ((await syncOne(entry)) === 'retry') retry = true;
  }
  for (const resolve of [...s.resolves]) {
    try {
      await updateEmergency(resolve.id, { status: 'RESOLVED' });
    } catch (error) {
      if (!(error instanceof ApiError && (error.status === 404 || error.status === 409))) {
        retry = true;
        continue;
      }
    }
    await locked(async () => {
      const latest = await load();
      latest.resolves = latest.resolves.filter((r) => r.id !== resolve.id);
      await save();
    });
  }
  if (retry) {
    failures += 1;
    await locked(save);
    scheduleRetry();
  } else {
    failures = 0;
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = BACKOFF_MS[Math.min(Math.max(failures, 1) - 1, BACKOFF_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncPendingEmergencies();
  }, delay);
}

// Creates every pending emergency on the server. Concurrent callers share
// one run, so there's never more than one create in flight per emergency.
export function syncPendingEmergencies(): Promise<void> {
  if (!syncing) {
    syncing = syncAll()
      .catch((error) => console.warn('[Emergency] pending sync failed', error))
      .finally(() => {
        syncing = null;
      });
  }
  return syncing;
}

// Launch / foreground: try now rather than waiting for the backoff.
export function resumePendingEmergencies(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return syncPendingEmergencies();
}

export function __resetPendingEmergenciesForTests() {
  state = null;
  loading = null;
  chain = Promise.resolve();
  syncing = null;
  failures = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  listeners.clear();
}
