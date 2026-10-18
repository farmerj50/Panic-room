import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory file system standing in for expo-file-system.
const mockFiles = new Map<string, number>(); // uri -> size
const mockContent = new Map<string, Uint8Array>(); // uri -> bytes (for MP4 index checks)
const mockMtime = new Map<string, number>(); // uri -> last-modified ms
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri) ?? null;
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get modificationTime() {
      return mockMtime.get(this.uri) ?? 0;
    }
    open() {
      const bytes = mockContent.get(this.uri) ?? new Uint8Array(mockFiles.get(this.uri) ?? 0);
      return {
        size: bytes.length,
        offset: 0,
        readBytes(n: number) {
          const out = bytes.slice(this.offset, this.offset + n);
          this.offset += n;
          return out;
        },
        close() {},
      };
    }
    async move(target: File) {
      if (!mockFiles.has(this.uri)) throw new Error('missing');
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      for (const m of [mockContent, mockMtime] as Map<string, unknown>[]) {
        if (m.has(this.uri)) m.set(target.uri, m.get(this.uri));
        m.delete(this.uri);
      }
      mockFiles.delete(this.uri);
    }
    async copy(target: File) {
      if (!mockFiles.has(this.uri)) throw new Error('missing');
      mockFiles.set(target.uri, mockTruncateNextCopy ? 1 : mockFiles.get(this.uri)!);
      mockTruncateNextCopy = false;
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      const prefix = `${this.uri}/`;
      return [...mockFiles.keys()].filter((u) => u.startsWith(prefix) && !u.slice(prefix.length).includes('/')).map((u) => new File(u));
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///doc') } };
});

// Lets a test make the next copy() write a truncated file.
let mockTruncateNextCopy = false;
const mockTrackEvent = jest.fn();
jest.mock('../analyticsService', () => ({ trackEvent: (...args: unknown[]) => mockTrackEvent(...args) }));
const mockUploadFile = jest.fn();
const mockAddVideoSegment = jest.fn();
const mockUpdateEmergency = jest.fn();
const mockCreateEmergency = jest.fn();
jest.mock('../uploadService', () => ({ uploadFile: (...args: unknown[]) => mockUploadFile(...args) }));
jest.mock('../emergencyService', () => ({
  addVideoSegment: (...args: unknown[]) => mockAddVideoSegment(...args),
  updateEmergency: (...args: unknown[]) => mockUpdateEmergency(...args),
  createEmergency: (...args: unknown[]) => mockCreateEmergency(...args),
  createRecording: jest.fn().mockResolvedValue(undefined),
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
  SEGMENT_QUEUE_STORAGE_KEY,
  __resetClipQueueForTests,
  clipFileName,
  discardUnuploadedClips,
  enqueueClip,
  clearRecordingJournal,
  getClipQueueSummary,
  hasCompleteMp4Index,
  journalRecordingStarted,
  parseClipFileName,
  reconcileClipQueue,
  releaseRetainedClips,
  resumeClipQueue,
  retainClipsFor,
  runClipQueue,
} from '../segmentQueue';
import { __resetPendingEmergenciesForTests, registerPendingEmergency, syncPendingEmergencies } from '../pendingEmergencies';

const EMERGENCY = '11111111-2222-3333-4444-555555555555';
const DIR = 'file:///doc/emergency-segments';
const STARTED = '2026-10-10T12:00:00.000Z';
const ENDED = '2026-10-10T12:00:30.000Z';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function cameraClip(n: number) {
  const uri = `file:///cache/Camera/clip-${n}.mp4`;
  mockFiles.set(uri, 1000 * n);
  return uri;
}

async function enqueueVideo(sequence: number, onFirstAttempt?: (o: string) => void) {
  return enqueueClip(
    { kind: 'video', emergencyId: EMERGENCY, sequence, facing: 'back', startedAt: STARTED, endedAt: ENDED, sourceUri: cameraClip(sequence) },
    onFirstAttempt,
  );
}

async function stored() {
  const raw = await AsyncStorage.getItem(SEGMENT_QUEUE_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.useRealTimers();
  mockFiles.clear();
  mockContent.clear();
  mockMtime.clear();
  await AsyncStorage.clear();
  __resetClipQueueForTests();
  __resetPendingEmergenciesForTests();
  mockCreateEmergency.mockReset().mockImplementation(async (d: { id: string }) => ({ id: d.id }));
  mockUploadFile.mockReset().mockResolvedValue({ key: 'user1/abc.mp4' });
  mockAddVideoSegment.mockReset().mockResolvedValue({});
  mockTrackEvent.mockReset();
  mockTruncateNextCopy = false;
  mockUpdateEmergency.mockReset().mockResolvedValue({});
});

test('file names fully describe a clip, so a record can be rebuilt from the file alone', () => {
  const name = clipFileName({ kind: 'video', emergencyId: EMERGENCY, sequence: 7, facing: 'front', startedAt: STARTED, endedAt: ENDED, ext: 'mp4' });
  expect(parseClipFileName(name)).toEqual({
    id: name,
    kind: 'video',
    emergencyId: EMERGENCY,
    sequence: 7,
    facing: 'front',
    startedAt: STARTED,
    endedAt: ENDED,
  });
  expect(parseClipFileName('random.mp4')).toBeNull();
});

test('a clip is moved out of the camera cache and its file is kept until the server confirms it', async () => {
  let fileAtConfirm = false;
  mockAddVideoSegment.mockImplementation(async () => {
    fileAtConfirm = [...mockFiles.keys()].some((u) => u.startsWith(DIR));
  });
  const outcomes: string[] = [];
  const record = await enqueueVideo(1, (o) => outcomes.push(o));
  expect(record.localUri.startsWith(DIR)).toBe(true);
  expect(mockFiles.has('file:///cache/Camera/clip-1.mp4')).toBe(false);

  await runClipQueue();
  await flush();
  expect(mockUploadFile).toHaveBeenCalledWith({ localUri: record.localUri, kind: 'video' });
  expect(mockAddVideoSegment).toHaveBeenCalledWith(EMERGENCY, expect.objectContaining({ sequence: 1, fileUrl: 'user1/abc.mp4' }));
  expect(fileAtConfirm).toBe(true); // still on the device while the server was confirming
  expect(mockFiles.has(record.localUri)).toBe(false); // deleted only after
  expect(outcomes).toEqual(['confirmed']);
  expect(await stored()).toEqual([]);
});

test('network failures keep the file and retry; an uploaded file is never re-uploaded', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockAddVideoSegment.mockRejectedValueOnce(new Error('Network request failed'));
  const outcomes: string[] = [];
  const record = await enqueueVideo(1, (o) => outcomes.push(o));
  await runClipQueue();
  await flush();
  expect(outcomes).toEqual(['failed']);
  expect(mockFiles.has(record.localUri)).toBe(true);
  expect((await stored())[0]).toEqual(expect.objectContaining({ state: 'pending', storageKey: 'user1/abc.mp4', attempts: 1 }));

  await resumeClipQueue();
  await flush();
  expect(mockUploadFile).toHaveBeenCalledTimes(1);
  expect(mockAddVideoSegment).toHaveBeenCalledTimes(2);
  expect(mockFiles.has(record.localUri)).toBe(false);
});

test('a 409 conflict keeps the file and stops retrying', async () => {
  mockAddVideoSegment.mockRejectedValue(new ApiError('conflict', 409));
  const record = await enqueueVideo(1);
  await runClipQueue();
  await resumeClipQueue();
  await flush();
  expect(mockAddVideoSegment).toHaveBeenCalledTimes(1);
  expect(mockFiles.has(record.localUri)).toBe(true);
  expect(await getClipQueueSummary()).toEqual(expect.objectContaining({ conflict: 1, waiting: 0 }));
});

test('the queue survives an app restart', async () => {
  mockUploadFile.mockRejectedValue(new Error('offline'));
  await enqueueVideo(1);
  await enqueueVideo(2);
  await runClipQueue();
  __resetClipQueueForTests(); // app killed

  mockUploadFile.mockResolvedValue({ key: 'user1/abc.mp4' });
  await reconcileClipQueue();
  await runClipQueue();
  await flush();
  expect(mockAddVideoSegment.mock.calls.map(([, data]) => data.sequence).sort()).toEqual([1, 2]);
  expect(await stored()).toEqual([]);
});

describe('a recording whose file is already gone (e.g. purged by Android)', () => {
  test('is reported as lost — never uploaded, never retried, never silently dropped', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const outcomes: string[] = [];
    const record = await enqueueClip(
      { kind: 'audio', emergencyId: EMERGENCY, startedAt: STARTED, endedAt: ENDED, sourceUri: 'file:///cache/Audio/gone.m4a' },
      (o) => outcomes.push(o),
    );
    await runClipQueue();
    await flush();
    expect(record.state).toBe('lost');
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(outcomes).toEqual(['failed']);
    expect(await getClipQueueSummary()).toEqual(expect.objectContaining({ lost: 1, waiting: 0 }));
    expect(mockTrackEvent).toHaveBeenCalledWith('evidence_clip_lost', { kind: 'audio', reason: 'source_missing' });
  });
});

describe('moving a clip into evidence storage', () => {
  test('falls back to copy, and keeps the original if the copy is incomplete', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const source = cameraClip(3);
    const original = mockFiles.get(source);
    // Rename fails (e.g. different filesystem) and the copy comes out truncated.
    const { File } = jest.requireMock('expo-file-system');
    const move = jest.spyOn(File.prototype, 'move').mockRejectedValueOnce(new Error('EXDEV'));
    mockTruncateNextCopy = true;
    const record = await enqueueClip({
      kind: 'video', emergencyId: EMERGENCY, sequence: 3, facing: 'back', startedAt: STARTED, endedAt: ENDED, sourceUri: source,
    });
    move.mockRestore();
    expect(mockFiles.get(source)).toBe(original); // original untouched
    expect(record.localUri).toBe(source); // uploads from the original instead
    expect(record.state).toBe('pending');
    expect([...mockFiles.keys()].some((u) => u.startsWith(DIR))).toBe(false); // partial copy removed
  });

  test('a verified copy replaces the original', async () => {
    const source = cameraClip(4);
    const { File } = jest.requireMock('expo-file-system');
    const move = jest.spyOn(File.prototype, 'move').mockRejectedValueOnce(new Error('EXDEV'));
    const record = await enqueueClip({
      kind: 'video', emergencyId: EMERGENCY, sequence: 4, facing: 'back', startedAt: STARTED, endedAt: ENDED, sourceUri: source,
    });
    move.mockRestore();
    expect(record.localUri.startsWith(DIR)).toBe(true);
    expect(mockFiles.get(record.localUri)).toBe(4000);
    expect(mockFiles.has(source)).toBe(false);
  });

  test('handing the same clip over twice is harmless (idempotent)', async () => {
    mockUploadFile.mockRejectedValue(new Error('offline'));
    const source = cameraClip(5);
    const clip = { kind: 'video' as const, emergencyId: EMERGENCY, sequence: 5, facing: 'back' as const, startedAt: STARTED, endedAt: ENDED, sourceUri: source };
    const first = await enqueueClip(clip);
    const second = await enqueueClip(clip);
    expect(second.localUri).toBe(first.localUri);
    expect(second.state).toBe('pending');
    expect((await stored()).filter((r: { id: string }) => r.id === first.id)).toHaveLength(1);
  });
});

describe('crash recovery at launch', () => {
  test('a clip file with no queue entry is rebuilt from its filename and uploaded', async () => {
    const name = clipFileName({ kind: 'video', emergencyId: EMERGENCY, sequence: 4, facing: 'front', startedAt: STARTED, endedAt: ENDED, ext: 'mp4' });
    mockFiles.set(`${DIR}/${name}`, 500); // crash between the move and the record write
    const result = await reconcileClipQueue();
    await runClipQueue();
    await flush();
    expect(result.recovered).toBe(1);
    expect(mockAddVideoSegment).toHaveBeenCalledWith(
      EMERGENCY,
      expect.objectContaining({ sequence: 4, facing: 'front', startedAt: STARTED, endedAt: ENDED }),
    );
  });

  test("a 'moving' record whose file is still in the camera cache is moved again", async () => {
    const source = cameraClip(3);
    const name = clipFileName({ kind: 'video', emergencyId: EMERGENCY, sequence: 3, facing: 'back', startedAt: STARTED, endedAt: ENDED, ext: 'mp4' });
    await AsyncStorage.setItem(
      SEGMENT_QUEUE_STORAGE_KEY,
      JSON.stringify([{ id: name, kind: 'video', emergencyId: EMERGENCY, sequence: 3, facing: 'back', startedAt: STARTED, endedAt: ENDED, localUri: `${DIR}/${name}`, sourceUri: source, state: 'moving', attempts: 0 }]),
    );
    mockUploadFile.mockRejectedValue(new Error('offline'));
    await reconcileClipQueue();
    expect(mockFiles.has(`${DIR}/${name}`)).toBe(true);
    expect(mockFiles.has(source)).toBe(false);
    expect((await stored())[0].state).toBe('pending');
  });

  test('a missing file is reported as lost, never silently dropped', async () => {
    const base = { kind: 'video', emergencyId: EMERGENCY, facing: 'back', startedAt: STARTED, endedAt: ENDED, attempts: 0 };
    await AsyncStorage.setItem(
      SEGMENT_QUEUE_STORAGE_KEY,
      JSON.stringify([
        { ...base, id: 'a', sequence: 1, localUri: `${DIR}/a.mp4`, sourceUri: 'file:///cache/gone.mp4', state: 'moving' },
        { ...base, id: 'b', sequence: 2, localUri: `${DIR}/b.mp4`, state: 'pending' },
      ]),
    );
    const result = await reconcileClipQueue();
    expect(result.lost).toBe(2);
    expect(await getClipQueueSummary()).toEqual(expect.objectContaining({ lost: 2 }));
  });

  test('a confirmed record is cleaned up (file deleted, record dropped)', async () => {
    mockFiles.set(`${DIR}/c.mp4`, 10);
    await AsyncStorage.setItem(
      SEGMENT_QUEUE_STORAGE_KEY,
      JSON.stringify([{ id: 'c.mp4', kind: 'video', emergencyId: EMERGENCY, sequence: 1, facing: 'back', startedAt: STARTED, endedAt: ENDED, localUri: `${DIR}/c.mp4`, state: 'confirmed', attempts: 1 }]),
    );
    await reconcileClipQueue();
    expect(mockFiles.has(`${DIR}/c.mp4`)).toBe(false);
    expect(await stored()).toEqual([]);
  });
});

test('clips of the emergency on screen are kept after confirmation until it ends', async () => {
  retainClipsFor(EMERGENCY);
  const record = await enqueueVideo(1);
  await runClipQueue();
  await flush();
  expect(mockAddVideoSegment).toHaveBeenCalled();
  expect(mockFiles.has(record.localUri)).toBe(true); // the share preview can still play it

  await releaseRetainedClips(EMERGENCY);
  expect(mockFiles.has(record.localUri)).toBe(false);
  expect(await stored()).toEqual([]);
});

test('audio goes through the same queue and is attached to the emergency', async () => {
  const source = 'file:///cache/audio/rec.m4a';
  mockFiles.set(source, 100);
  await enqueueClip({ kind: 'audio', emergencyId: EMERGENCY, startedAt: STARTED, endedAt: ENDED, sourceUri: source });
  await runClipQueue();
  await flush();
  expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio' }));
  expect(mockUpdateEmergency).toHaveBeenCalledWith(EMERGENCY, { audioUrl: 'user1/abc.mp4' });
});

test('unsent clips are only removed by the explicit discard action', async () => {
  mockUploadFile.mockRejectedValue(new Error('offline'));
  const record = await enqueueVideo(1);
  await runClipQueue();
  expect((await getClipQueueSummary()).waiting).toBe(1);
  expect(mockFiles.has(record.localUri)).toBe(true);

  expect(await discardUnuploadedClips()).toBe(1);
  expect(mockFiles.has(record.localUri)).toBe(false);
  expect((await getClipQueueSummary()).waiting).toBe(0);
});

// ── Interrupted recordings (crash / kill mid-recording) ───────────────────
const box = (type: string, payload = 0) => {
  const size = 8 + payload;
  const b = new Uint8Array(size);
  new DataView(b.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i += 1) b[4 + i] = type.charCodeAt(i);
  return b;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const completeMp4 = () => concat(box('ftyp', 16), box('mdat', 4000), box('moov', 200));
// What a recorder leaves when killed: data written, index never written.
const interruptedMp4 = () => concat(box('ftyp', 16), box('mdat', 4000));

const REC = 'file:///doc/bes-recording';
const BEFORE_LAUNCH = 1_000; // ms epoch, long before this test process started
function leftover(kind: 'Camera' | 'Audio', name: string, bytes: Uint8Array, mtime = BEFORE_LAUNCH + 30_000) {
  const uri = `${REC}/${kind}/${name}`;
  mockFiles.set(uri, bytes.length);
  mockContent.set(uri, bytes);
  mockMtime.set(uri, mtime);
  return uri;
}
const JOURNAL_STARTED = new Date(BEFORE_LAUNCH).toISOString();

describe('MP4 index check', () => {
  test('accepts a finished recording and rejects interrupted or damaged ones', () => {
    expect(hasCompleteMp4Index(leftover('Camera', 'ok.mp4', completeMp4()))).toBe(true);
    expect(hasCompleteMp4Index(leftover('Camera', 'killed.mp4', interruptedMp4()))).toBe(false);
    const truncated = completeMp4().slice(0, 4100); // moov cut off mid-box
    expect(hasCompleteMp4Index(leftover('Camera', 'cut.mp4', truncated))).toBe(false);
    expect(hasCompleteMp4Index(leftover('Camera', 'empty.mp4', new Uint8Array(0)))).toBe(false);
  });

  test('handles 64-bit box sizes', () => {
    const large = new Uint8Array(16 + 100);
    const v = new DataView(large.buffer);
    v.setUint32(0, 1);
    large.set([109, 100, 97, 116], 4); // 'mdat'
    v.setUint32(8, 0);
    v.setUint32(12, 116);
    expect(hasCompleteMp4Index(leftover('Camera', 'big.mp4', concat(box('ftyp', 8), large, box('moov', 20))))).toBe(true);
  });
});

describe('recovering recordings interrupted by a crash', () => {
  test('a finished-but-unqueued recording is matched to its emergency, queued once and uploaded', async () => {
    await journalRecordingStarted({ kind: 'video', emergencyId: EMERGENCY, sequence: 3, facing: 'front', startedAt: JOURNAL_STARTED });
    leftover('Camera', 'abc.mp4', completeMp4());
    __resetClipQueueForTests(); // app killed

    const result = await reconcileClipQueue();
    await flush();
    expect(result).toEqual(expect.objectContaining({ recovered: 1, incomplete: 0 }));
    expect(mockAddVideoSegment).toHaveBeenCalledTimes(1);
    expect(mockAddVideoSegment).toHaveBeenCalledWith(EMERGENCY, expect.objectContaining({ sequence: 3, facing: 'front' }));

    // A second launch must not recover or upload it again.
    __resetClipQueueForTests();
    expect(await reconcileClipQueue()).toEqual(expect.objectContaining({ recovered: 0, incomplete: 0 }));
    await flush();
    expect(mockAddVideoSegment).toHaveBeenCalledTimes(1);
  });

  test('an interrupted recording without an index is kept as incomplete — not uploaded, not deleted', async () => {
    mockUploadFile.mockClear();
    await journalRecordingStarted({ kind: 'audio', emergencyId: EMERGENCY, startedAt: JOURNAL_STARTED });
    leftover('Audio', 'recording-1.m4a', interruptedMp4());
    __resetClipQueueForTests();

    expect(await reconcileClipQueue()).toEqual(expect.objectContaining({ recovered: 0, incomplete: 1 }));
    await flush();
    expect(mockUploadFile).not.toHaveBeenCalled();
    const [record] = await stored();
    expect(record).toEqual(expect.objectContaining({ state: 'incomplete', kind: 'audio', emergencyId: EMERGENCY }));
    expect(mockFiles.has(record.localUri)).toBe(true);
    expect(await getClipQueueSummary()).toEqual(expect.objectContaining({ incomplete: 1 }));

    // Still kept after another launch.
    __resetClipQueueForTests();
    await reconcileClipQueue();
    expect(mockFiles.has(record.localUri)).toBe(true);
  });

  test('a leftover file with no journal entry is kept and reported, never guessed or deleted', async () => {
    const uri = leftover('Camera', 'mystery.mp4', completeMp4());
    __resetClipQueueForTests();
    expect(await reconcileClipQueue()).toEqual(expect.objectContaining({ incomplete: 1 }));
    expect(mockFiles.has(uri)).toBe(true);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  test('a recording still being written by this launch is left alone', async () => {
    await journalRecordingStarted({ kind: 'video', emergencyId: EMERGENCY, sequence: 1, facing: 'back', startedAt: JOURNAL_STARTED });
    const uri = leftover('Camera', 'live.mp4', interruptedMp4(), Date.now() + 60_000);
    __resetClipQueueForTests();
    expect(await reconcileClipQueue()).toEqual(expect.objectContaining({ recovered: 0, incomplete: 0 }));
    expect(mockFiles.has(uri)).toBe(true);
    expect(await stored()).toEqual([]);
  });

  test('recordings handed to the queue normally are not recovered again', async () => {
    mockUploadFile.mockRejectedValue(new Error('offline'));
    await journalRecordingStarted({ kind: 'video', emergencyId: EMERGENCY, sequence: 1, facing: 'back', startedAt: JOURNAL_STARTED });
    await enqueueVideo(1);
    await clearRecordingJournal(EMERGENCY);
    __resetClipQueueForTests();
    expect(await reconcileClipQueue()).toEqual(expect.objectContaining({ recovered: 0, incomplete: 0 }));
    expect(await stored()).toHaveLength(1);
    expect(await AsyncStorage.getItem('bes_recording_journal')).toBe('[]');
  });
});

test('a full disk that blocks saving the queue still moves and uploads the clip', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('database or disk is full (code 13 SQLITE_FULL)'));
  const record = await enqueueVideo(9);
  expect(record.state).toBe('pending');
  expect(record.localUri.startsWith(DIR)).toBe(true);
  await runClipQueue();
  await flush();
  expect(mockAddVideoSegment).toHaveBeenCalledWith(EMERGENCY, expect.objectContaining({ sequence: 9 }));
  setItem.mockRestore();
});

test('if the queue was never saved, the moved clip is rebuilt from its filename at the next launch', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockUploadFile.mockRejectedValue(new Error('offline'));
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('SQLITE_FULL'));
  const record = await enqueueVideo(10);
  setItem.mockRestore();
  __resetClipQueueForTests(); // app killed before any save succeeded

  mockUploadFile.mockResolvedValue({ key: 'user1/abc.mp4' });
  expect((await reconcileClipQueue()).recovered).toBe(1);
  await runClipQueue();
  await flush();
  expect(mockAddVideoSegment).toHaveBeenCalledWith(EMERGENCY, expect.objectContaining({ sequence: 10 }));
  expect(mockFiles.has(record.localUri)).toBe(false); // uploaded, then cleaned up
});

describe('an emergency recorded without signal', () => {
  test('its clips wait in the queue (kept, not lost or conflict) until the emergency is on the server', async () => {
    await registerPendingEmergency({ id: EMERGENCY, activatedAt: STARTED });
    await enqueueVideo(1);
    await runClipQueue();
    expect(mockAddVideoSegment).not.toHaveBeenCalled();
    expect((await stored())[0].state).toBe('pending');

    await syncPendingEmergencies();
    await runClipQueue();
    expect(mockCreateEmergency).toHaveBeenCalledWith(expect.objectContaining({ id: EMERGENCY, activatedAt: STARTED }));
    expect(mockAddVideoSegment).toHaveBeenCalledWith(EMERGENCY, expect.objectContaining({ sequence: 1 }));
  });

  test('if an older server returns its own id, queued clips follow it', async () => {
    await registerPendingEmergency({ id: EMERGENCY, activatedAt: STARTED });
    await enqueueVideo(1);
    mockCreateEmergency.mockResolvedValue({ id: 'server-9' });
    await syncPendingEmergencies();
    await runClipQueue();
    expect(mockAddVideoSegment).toHaveBeenCalledWith('server-9', expect.objectContaining({ sequence: 1 }));
  });
});
