// Durable, crash-safe upload queue for emergency evidence (video clips and
// the audio recording). Recording never waits on it.
//
// - The camera and recorder write into persistent files (bes-recording/),
//   never the cache: Android purges app caches under storage pressure, which
//   deleted clips mid-recording (patches/expo-camera, patches/expo-audio).
// - Each finished clip is moved into Paths.document/emergency-segments/. Its
//   filename alone describes it — <emergencyId>__v<sequence>__<facing>__<startMs>__<endMs>.<ext>
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

import { trackEvent } from './analyticsService';
import { ApiError } from './apiClient';
import { addVideoSegment, createRecording, updateEmergency } from './emergencyService';
import { uploadFile } from './uploadService';

export type ClipKind = 'video' | 'audio';
// 'incomplete': a recording interrupted by a crash or kill whose file can't be
// played (no MP4 index). Kept on the device, never uploaded or auto-deleted.
export type ClipState = 'moving' | 'pending' | 'confirmed' | 'conflict' | 'lost' | 'incomplete';
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

export type QueueSummary = { waiting: number; conflict: number; lost: number; incomplete: number; bytes: number };

export const SEGMENT_QUEUE_STORAGE_KEY = 'bes_segment_queue';
export const RECORDING_JOURNAL_STORAGE_KEY = 'bes_recording_journal';
// Where the patched expo-camera / expo-audio write recordings (persistent
// files, never the cache): <files>/bes-recording/{Camera,Audio}/.
const RECORDING_DIR = 'bes-recording';
// Files last written before this process started can't be in progress now.
const processStartedAt = Date.now();
const DIR_NAME = 'emergency-segments';
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const isWeb = Platform.OS === 'web';

let records: ClipRecord[] | null = null;
let journal: JournalEntry[] | null = null;
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

// Best effort: a full disk can make the save fail, but that must never stop a
// clip being moved or uploaded. The in-memory queue stays authoritative for
// this session, and a lost save is rebuilt from filenames at the next launch.
async function persist() {
  notify();
  if (isWeb || !records) return;
  try {
    await AsyncStorage.setItem(SEGMENT_QUEUE_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('[Evidence] Could not save the upload queue', error);
  }
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

// ── Recording journal ────────────────────────────────────────────────────
// An entry is written before every recording starts and removed once the
// clip reaches the queue (or the emergency stops normally). Entries still
// here at the next launch are recordings a crash or kill interrupted; their
// files are recovered by reconcileClipQueue.
type JournalEntry = {
  kind: ClipKind;
  emergencyId: string;
  sequence: number;
  facing: ClipRecord['facing'];
  startedAt: string;
};

const sameRecording = (a: Pick<JournalEntry, 'kind' | 'emergencyId' | 'sequence'>, b: typeof a) =>
  a.kind === b.kind && a.emergencyId === b.emergencyId && a.sequence === b.sequence;

async function loadJournal(): Promise<JournalEntry[]> {
  if (journal) return journal;
  try {
    const raw = await AsyncStorage.getItem(RECORDING_JOURNAL_STORAGE_KEY);
    journal = raw ? (JSON.parse(raw) as JournalEntry[]) : [];
  } catch {
    journal = [];
  }
  return journal;
}

async function persistJournal() {
  if (isWeb || !journal) return;
  await AsyncStorage.setItem(RECORDING_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
}

export function journalRecordingStarted(entry: {
  kind: ClipKind;
  emergencyId: string;
  sequence?: number;
  facing?: 'front' | 'back';
  startedAt: string;
}): Promise<void> {
  if (isWeb) return Promise.resolve();
  const next: JournalEntry = {
    kind: entry.kind,
    emergencyId: entry.emergencyId,
    sequence: entry.sequence ?? 0,
    facing: entry.kind === 'video' ? entry.facing ?? 'back' : 'none',
    startedAt: entry.startedAt,
  };
  return locked(async () => {
    const list = await loadJournal();
    journal = [...list.filter((e) => !sameRecording(e, next)), next];
    await persistJournal();
  }).catch(() => {});
}

// The emergency stopped normally: every recording it made reached the queue.
export function clearRecordingJournal(emergencyId: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  return locked(async () => {
    const list = await loadJournal();
    journal = list.filter((e) => e.emergencyId !== emergencyId);
    await persistJournal();
  }).catch(() => {});
}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

// MP4/M4A files are only playable once the recorder writes the 'moov' index,
// which happens when recording stops; a crash or kill leaves it out. Walks
// the top-level boxes without reading the media itself.
export function hasCompleteMp4Index(uri: string): boolean {
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = new File(uri).open();
    const size = handle.size ?? 0;
    let offset = 0;
    let moov = false;
    for (let boxes = 0; offset + 8 <= size && boxes < 10_000; boxes += 1) {
      handle.offset = offset;
      const header = handle.readBytes(8);
      let boxSize = u32(header, 0);
      const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
      if (boxSize === 1) {
        const large = handle.readBytes(8);
        boxSize = u32(large, 0) * 2 ** 32 + u32(large, 4);
      } else if (boxSize === 0) {
        boxSize = size - offset; // runs to the end of the file
      }
      if (boxSize < 8 || offset + boxSize > size) return false; // truncated
      if (type === 'moov') moov = true;
      offset += boxSize;
    }
    return moov && offset === size;
  } catch {
    return false;
  } finally {
    try {
      handle?.close();
    } catch {}
  }
}

// Idempotent: a clip already in evidence storage is left as is. The
// original is only removed after a copy is verified complete; a partial copy
// is discarded and the original kept.
async function moveInto(sourceUri: string, name: string): Promise<string> {
  if (isWeb) return sourceUri;
  const target = new File(ensureDirectory(), name);
  if (target.exists) return target.uri;
  const source = new File(sourceUri);
  try {
    await source.move(target);
  } catch {
    await source.copy(target);
    if (!target.exists || target.size !== source.size) {
      try {
        if (source.exists && target.exists) target.delete();
      } catch {}
      throw new Error('Copied clip did not match the original');
    }
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
    // The queue owns this recording now, so it is no longer in progress.
    const inProgress = await loadJournal();
    const handedOff = { kind: clip.kind, emergencyId: clip.emergencyId, sequence: record.sequence };
    if (inProgress.some((e) => sameRecording(e, handedOff))) {
      journal = inProgress.filter((e) => !sameRecording(e, handedOff));
      await persistJournal().catch(() => {});
    }
  });
  // Recordings are written outside the cache (patches/expo-camera, expo-audio);
  // a cache path means that protection is gone (e.g. lost in an Expo upgrade).
  if (!isWeb && /\/cache\//.test(clip.sourceUri)) {
    console.warn('[Evidence] Recording was written to the purgeable cache', { kind: clip.kind });
    trackEvent('evidence_recorded_to_cache', { kind: clip.kind });
  }
  try {
    record.localUri = await moveInto(clip.sourceUri, name);
  } catch (error) {
    // Couldn't relocate it — upload straight from where the camera left it.
    console.warn('Could not move clip to evidence storage', error);
    record.localUri = clip.sourceUri;
  }
  // If the recording's file is already gone there is nothing to upload: say
  // so (Evidence shows lost clips) instead of retrying a missing file forever.
  const saved = isWeb || fileExists(record.localUri);
  const state: ClipState = saved ? 'pending' : 'lost';
  await locked(async () => {
    const list = await load();
    const stored = list.find((r) => r.id === record.id);
    if (stored) Object.assign(stored, { localUri: record.localUri, state, sourceUri: undefined });
    await persist();
  });
  record.state = state;
  record.sourceUri = undefined;
  if (!saved) {
    console.error('[Evidence] Clip file was missing before it could be saved', { kind: clip.kind, name });
    trackEvent('evidence_clip_lost', { kind: clip.kind, reason: 'source_missing' });
    settle(record.id, 'failed');
    return record;
  }
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
export async function reconcileClipQueue(): Promise<{ recovered: number; lost: number; incomplete: number }> {
  if (isWeb) return { recovered: 0, lost: 0, incomplete: 0 };
  let recovered = 0;
  let lost = 0;
  let incomplete = 0;
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
    const interrupted = await recoverInterruptedRecordings(list);
    recovered += interrupted.recovered;
    incomplete += interrupted.incomplete;

    records = list;
    await persist();
  });
  void runClipQueue();
  return { recovered, lost, incomplete };
}

function recordingFiles(kind: ClipKind): Array<{ file: File; mtime: number }> {
  try {
    const dir = new Directory(Paths.document, RECORDING_DIR, kind === 'video' ? 'Camera' : 'Audio');
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({ file, mtime: file.modificationTime ?? 0 }))
      .sort((a, b) => a.mtime - b.mtime);
  } catch {
    return [];
  }
}

// Recordings a crash or kill interrupted: files the recorders left in
// bes-recording/ that no queue entry owns. Each is matched to its journal
// entry (emergency, sequence, start time), checked for a playable MP4 index,
// and queued once if valid. Invalid or unidentifiable files are kept and
// reported as 'incomplete', never deleted. Runs inside the queue lock.
async function recoverInterruptedRecordings(list: ClipRecord[]): Promise<{ recovered: number; incomplete: number }> {
  let recovered = 0;
  let incomplete = 0;
  const inProgress = [...(await loadJournal())].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const owned = new Set(list.flatMap((r) => [r.localUri, r.sourceUri]).filter((u): u is string => Boolean(u)));

  for (const kind of ['video', 'audio'] as const) {
    // Written before this launch, and not already owned by a queue entry.
    const orphans = recordingFiles(kind).filter(({ file, mtime }) => mtime < processStartedAt && !owned.has(file.uri));
    for (const entry of inProgress.filter((e) => e.kind === kind)) {
      const startedMs = Date.parse(entry.startedAt);
      const index = orphans.findIndex(({ mtime }) => mtime >= startedMs - 1000);
      if (index < 0) continue;
      const [{ file, mtime }] = orphans.splice(index, 1);
      const ext = file.name.split('.').pop() ?? (kind === 'video' ? 'mp4' : 'm4a');
      const endedAt = new Date(Math.max(mtime, startedMs)).toISOString();
      const name = clipFileName({ ...entry, endedAt, ext });
      if (list.some((r) => r.id === name)) continue; // already recovered
      const valid = hasCompleteMp4Index(file.uri);
      let localUri = file.uri;
      try {
        localUri = await moveInto(file.uri, name);
      } catch {}
      list.push({
        id: name,
        kind,
        emergencyId: entry.emergencyId,
        sequence: entry.sequence,
        facing: entry.facing,
        startedAt: entry.startedAt,
        endedAt,
        localUri,
        state: valid ? 'pending' : 'incomplete',
        attempts: 0,
      });
      if (valid) recovered += 1;
      else incomplete += 1;
      trackEvent('evidence_recording_recovered', { kind, valid, identified: true });
    }
    // Interrupted recordings with no journal entry can't be tied to an
    // emergency; keep and report them rather than guess.
    for (const { file, mtime } of orphans) {
      const id = `unidentified__${file.name}`;
      if (list.some((r) => r.id === id)) continue;
      const at = new Date(mtime).toISOString();
      list.push({
        id,
        kind,
        emergencyId: '',
        sequence: 0,
        facing: kind === 'video' ? 'back' : 'none',
        startedAt: at,
        endedAt: at,
        localUri: file.uri,
        state: 'incomplete',
        attempts: 0,
      });
      incomplete += 1;
      trackEvent('evidence_recording_recovered', { kind, valid: false, identified: false });
    }
  }

  if (inProgress.length) {
    journal = [];
    await persistJournal();
  }
  return { recovered, incomplete };
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
    incomplete: list.filter((r) => r.state === 'incomplete').length,
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
  journal = null;
  chain = Promise.resolve();
  working = null;
  failures = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  waiters.clear();
  listeners.clear();
  retained.clear();
}
