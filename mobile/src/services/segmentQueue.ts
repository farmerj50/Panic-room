// Durable, crash-safe upload queue for emergency evidence (video clips and
// the audio recording). Recording never waits on it.
//
// - Each finished clip is moved out of the camera cache (which the OS may
//   purge) into Paths.document/emergency-segments/. Its filename alone
//   describes it — <emergencyId>__v<sequence>__<facing>__<startMs>__<endMs>.<ext>
//   (audio: __a0__) — so a crash at any point can be reconciled at launch.
// - Write order: record ('moving', target path) → move file → record 'pending'.
// - The local file is deleted only after the server confirms the clip.
//   Nothing is ever deleted automatically before that; unuploaded evidence
//   is only removed by an explicit owner action (discardUnuploadedClips).
// - Uploads run one at a time in the background with backoff (5s, 15s, 60s,
//   then every 5 min), and resume on app foreground and at the next launch.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { ApiError } from './apiClient';
import { addVideoSegment, createRecording, updateEmergency } from './emergencyService';
import { uploadFile } from './uploadService';

export type ClipKind = 'video' | 'audio';
export type ClipState = 'moving' | 'pending' | 'confirmed' | 'conflict' | 'lost';
export type ClipOutcome = 'confirmed' | 'failed' | 'conflict';

export type ClipRecord = {
  id: string; // the filename — unique per clip
  kind: ClipKind;
  emergencyId: string;
  sequence: number; // 0 for audio
  facing: 'front' | 'back' | 'none';
  startedAt: string;
  endedAt: string;
  localUri: string;
  sourceUri?: string;
  storageKey?: string;
  state: ClipState;
  attempts: number;
};

export type QueueSummary = { waiting: number; conflict: number; lost: number; bytes: number };

export const SEGMENT_QUEUE_STORAGE_KEY = 'bes_segment_queue';
const DIR_NAME = 'emergency-segments';
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const isWeb = Platform.OS === 'web';

let records: ClipRecord[] | null = null;
let chain: Promise<unknown> = Promise.resolve();
let working: Promise<void> | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const waiters = new Map<string, Array<(outcome: ClipOutcome) => void>>();
const listeners = new Set<() => void>();
// Emergencies still on screen: their confirmed clips are kept on the device
// (the social-share preview plays them) until releaseRetainedClips().
const retained = new Set<string>();

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

function directory(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

function ensureDirectory() {
  const dir = directory();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function clipFileName(clip: {
  kind: ClipKind;
  emergencyId: string;
  sequence: number;
  facing: ClipRecord['facing'];
  startedAt: string;
  endedAt: string;
  ext: string;
}) {
  const ref = clip.kind === 'video' ? `v${clip.sequence}` : 'a0';
  const ext = clip.ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || (clip.kind === 'video' ? 'mp4' : 'm4a');
  return `${clip.emergencyId}__${ref}__${clip.facing}__${Date.parse(clip.startedAt)}__${Date.parse(clip.endedAt)}.${ext}`;
}

// Rebuilds a record from a file found on disk with no queue entry.
export function parseClipFileName(name: string): Omit<ClipRecord, 'localUri' | 'state' | 'attempts'> | null {
  const match = /^([0-9a-f-]{36})__(v\d+|a0)__(front|back|none)__(\d+)__(\d+)\.[a-z0-9]+$/i.exec(name);
  if (!match) return null;
  const [, emergencyId, ref, facing, startMs, endMs] = match;
  const kind: ClipKind = ref === 'a0' ? 'audio' : 'video';
  return {
    id: name,
    kind,
    emergencyId,
    sequence: kind === 'video' ? Number(ref.slice(1)) : 0,
    facing: facing as ClipRecord['facing'],
    startedAt: new Date(Number(startMs)).toISOString(),
    endedAt: new Date(Number(endMs)).toISOString(),
  };
}

async function load(): Promise<ClipRecord[]> {
  if (records) return records;
  if (isWeb) {
    records = [];
    return records;
  }
  try {
    const raw = await AsyncStorage.getItem(SEGMENT_QUEUE_STORAGE_KEY);
    records = raw ? (JSON.parse(raw) as ClipRecord[]) : [];
  } catch {
    records = [];
  }
  return records;
}

async function persist() {
  notify();
  if (isWeb || !records) return;
  await AsyncStorage.setItem(SEGMENT_QUEUE_STORAGE_KEY, JSON.stringify(records));
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

export function subscribeToClipQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function settle(id: string, outcome: ClipOutcome) {
  const pending = waiters.get(id);
  if (!pending) return;
  waiters.delete(id);
  pending.forEach((resolve) => resolve(outcome));
}

// Resolves with the outcome of the NEXT upload attempt for this clip.
export function waitForClipAttempt(id: string): Promise<ClipOutcome> {
  return new Promise((resolve) => {
    const list = waiters.get(id) ?? [];
    list.push(resolve);
    waiters.set(id, list);
  });
}

function fileExists(uri: string | undefined) {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

async function moveInto(sourceUri: string, name: string): Promise<string> {
  if (isWeb) return sourceUri;
  const target = new File(ensureDirectory(), name);
  if (target.exists) return target.uri;
  const source = new File(sourceUri);
  try {
    await source.move(target);
  } catch {
    await source.copy(target);
    try {
      source.delete();
    } catch {}
  }
  return target.uri;
}

// Hands a finished clip to the queue. Returns immediately after the file is
// safely stored; the upload happens in the background.
export async function enqueueClip(
  clip: {
    kind: ClipKind;
    emergencyId: string;
    sequence?: number;
    facing?: 'front' | 'back';
    startedAt: string;
    endedAt: string;
    sourceUri: string;
  },
  // Called with the outcome of the first upload attempt (registered before
  // the upload can start, so it's never missed).
  onFirstAttempt?: (outcome: ClipOutcome) => void,
): Promise<ClipRecord> {
  const ext = clip.sourceUri.split('?')[0].split('.').pop() ?? '';
  const facing = clip.kind === 'video' ? clip.facing ?? 'back' : 'none';
  const name = clipFileName({ ...clip, sequence: clip.sequence ?? 0, facing, ext });
  if (onFirstAttempt) void waitForClipAttempt(name).then(onFirstAttempt);
  const target = isWeb ? clip.sourceUri : new File(new Directory(Paths.document, DIR_NAME), name).uri;
  const record: ClipRecord = {
    id: name,
    kind: clip.kind,
    emergencyId: clip.emergencyId,
    sequence: clip.sequence ?? 0,
    facing,
    startedAt: clip.startedAt,
    endedAt: clip.endedAt,
    localUri: target,
    sourceUri: clip.sourceUri,
    state: 'moving',
    attempts: 0,
  };

  await locked(async () => {
    const list = await load();
    if (!list.some((r) => r.id === record.id)) list.push(record);
    await persist();
  });
  try {
    record.localUri = await moveInto(clip.sourceUri, name);
  } catch (error) {
    // Couldn't relocate it — upload straight from where the camera left it.
    console.warn('Could not move clip to evidence storage', error);
    record.localUri = clip.sourceUri;
  }
  await locked(async () => {
    const list = await load();
    const stored = list.find((r) => r.id === record.id);
    if (stored) Object.assign(stored, { localUri: record.localUri, state: 'pending', sourceUri: undefined });
    await persist();
  });
  record.state = 'pending';
  record.sourceUri = undefined;
  void runClipQueue();
  return record;
}

async function uploadOne(record: ClipRecord): Promise<ClipOutcome> {
  try {
    if (!record.storageKey) {
      const { key } = await uploadFile({ localUri: record.localUri, kind: record.kind });
      record.storageKey = key;
      await locked(persist);
    }
    if (record.kind === 'video') {
      await addVideoSegment(record.emergencyId, {
        fileUrl: record.storageKey,
        facing: record.facing === 'front' ? 'front' : 'back',
        sequence: record.sequence,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
      });
    } else {
      await updateEmergency(record.emergencyId, { audioUrl: record.storageKey });
      await createRecording({ fileUrl: record.storageKey, type: 'audio' }).catch(() => {});
    }
    return 'confirmed';
  } catch (error) {
    // 409: a different clip already holds this sequence; 404: the emergency
    // no longer exists. Retrying can't help — keep the file, stop retrying.
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) return 'conflict';
    return 'failed';
  }
}

async function confirm(record: ClipRecord) {
  await locked(async () => {
    record.state = 'confirmed';
    await persist();
  });
  if (retained.has(record.emergencyId)) return;
  try {
    if (!isWeb && fileExists(record.localUri)) new File(record.localUri).delete();
  } catch {}
  await locked(async () => {
    const list = await load();
    records = list.filter((r) => r.id !== record.id);
    await persist();
  });
}

export function retainClipsFor(emergencyId: string) {
  retained.add(emergencyId);
}

// The emergency left the screen: delete its server-confirmed clips. Clips not
// yet confirmed are untouched and keep uploading.
export async function releaseRetainedClips(emergencyId: string) {
  retained.delete(emergencyId);
  const list = await locked(load);
  for (const record of list.filter((r) => r.emergencyId === emergencyId && r.state === 'confirmed')) {
    await confirm(record);
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runClipQueue();
  }, delay);
}

// Uploads queued clips one at a time. Safe to call any time; concurrent
// callers share (and can await) the run already in progress.
export function runClipQueue(): Promise<void> {
  if (!working) {
    working = drainQueue()
      .catch((error) => console.warn('Clip queue run failed', error))
      .finally(() => {
        working = null;
      });
  }
  return working;
}

async function drainQueue(): Promise<void> {
  for (;;) {
    const list = await locked(load);
    const next = list.find((r) => r.state === 'pending');
    if (!next) return;
    next.attempts += 1;
    const outcome = await uploadOne(next);
    if (outcome === 'confirmed') {
      failures = 0;
      await confirm(next);
    } else if (outcome === 'conflict') {
      await locked(async () => {
        next.state = 'conflict';
        await persist();
      });
    }
    settle(next.id, outcome);
    if (outcome === 'failed') {
      failures += 1;
      await locked(persist);
      scheduleRetry();
      return;
    }
  }
}

// App launch / foreground: retry now instead of waiting for the backoff.
export function resumeClipQueue(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return runClipQueue();
}

// Startup reconciliation — runs before any new emergency. Recovers clips
// whose queue entry was never written (crash right after the move), finishes
// interrupted moves, and reports clips that can't be found instead of
// silently dropping them. Returns how many clips were recovered or lost.
export async function reconcileClipQueue(): Promise<{ recovered: number; lost: number }> {
  if (isWeb) return { recovered: 0, lost: 0 };
  let recovered = 0;
  let lost = 0;
  await locked(async () => {
    const list = await load();
    let names: string[] = [];
    try {
      const dir = directory();
      names = dir.exists ? dir.list().filter((entry) => entry instanceof File).map((entry) => entry.name) : [];
    } catch {}

    for (const name of names) {
      if (list.some((r) => r.id === name)) continue;
      const parsed = parseClipFileName(name);
      if (!parsed) continue;
      list.push({ ...parsed, localUri: new File(directory(), name).uri, state: 'pending', attempts: 0 });
      recovered += 1;
    }

    for (const record of [...list]) {
      const present = fileExists(record.localUri);
      if (record.state === 'confirmed') {
        // Confirmed by the server; only the cleanup was interrupted.
        if (present) {
          try {
            new File(record.localUri).delete();
          } catch {}
        }
        list.splice(list.indexOf(record), 1);
      } else if (record.state === 'moving') {
        if (present) {
          record.state = 'pending';
        } else if (fileExists(record.sourceUri)) {
          try {
            record.localUri = await moveInto(record.sourceUri!, record.id);
          } catch {
            record.localUri = record.sourceUri!;
          }
          record.state = 'pending';
          recovered += 1;
        } else {
          record.state = 'lost';
          lost += 1;
        }
        record.sourceUri = undefined;
      } else if ((record.state === 'pending' || record.state === 'conflict') && !present) {
        // Already uploaded file + metadata still owed: finish the job.
        if (record.state === 'pending' && record.storageKey) continue;
        record.state = 'lost';
        lost += 1;
      }
    }
    records = list;
    await persist();
  });
  void runClipQueue();
  return { recovered, lost };
}

export async function getClipQueueSummary(): Promise<QueueSummary> {
  const list = await locked(load);
  let bytes = 0;
  for (const record of list) {
    if (record.state === 'lost' || record.state === 'confirmed') continue;
    try {
      bytes += new File(record.localUri).size ?? 0;
    } catch {}
  }
  return {
    waiting: list.filter((r) => r.state === 'pending' || r.state === 'moving').length,
    conflict: list.filter((r) => r.state === 'conflict').length,
    lost: list.filter((r) => r.state === 'lost').length,
    bytes,
  };
}

// Explicit owner action only (Settings → Evidence, behind a confirmation).
export async function discardUnuploadedClips(): Promise<number> {
  let removed = 0;
  await locked(async () => {
    const list = await load();
    for (const record of list) {
      if (record.state === 'confirmed') continue;
      try {
        if (fileExists(record.localUri)) new File(record.localUri).delete();
      } catch {}
      removed += 1;
    }
    records = [];
    await persist();
  });
  return removed;
}

export function __resetClipQueueForTests() {
  records = null;
  chain = Promise.resolve();
  working = null;
  failures = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  waiters.clear();
  listeners.clear();
  retained.clear();
}
