import AsyncStorage from '@react-native-async-storage/async-storage';

// In-memory file system standing in for expo-file-system.
const mockFiles = new Map<string, number>(); // uri -> size
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
    async move(target: File) {
      if (!mockFiles.has(this.uri)) throw new Error('missing');
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
    }
    async copy(target: File) {
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
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

const mockUploadFile = jest.fn();
const mockAddVideoSegment = jest.fn();
const mockUpdateEmergency = jest.fn();
jest.mock('../uploadService', () => ({ uploadFile: (...args: unknown[]) => mockUploadFile(...args) }));
jest.mock('../emergencyService', () => ({
  addVideoSegment: (...args: unknown[]) => mockAddVideoSegment(...args),
  updateEmergency: (...args: unknown[]) => mockUpdateEmergency(...args),
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
  getClipQueueSummary,
  parseClipFileName,
  reconcileClipQueue,
  releaseRetainedClips,
  resumeClipQueue,
  retainClipsFor,
  runClipQueue,
} from '../segmentQueue';

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
  await AsyncStorage.clear();
  __resetClipQueueForTests();
  mockUploadFile.mockReset().mockResolvedValue({ key: 'user1/abc.mp4' });
  mockAddVideoSegment.mockReset().mockResolvedValue({});
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
