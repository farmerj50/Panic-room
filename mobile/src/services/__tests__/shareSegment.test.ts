import {
  createShareSegmentResolver,
  selectShareSegment,
  type ShareableSegmentEntry,
  type ShareSegmentDeps,
} from '../shareSegment';

type Entry = ShareableSegmentEntry;

function entry(sequence: number, status: Entry['status'], promise?: Promise<void>): Entry {
  return { segment: { sequence }, localUri: `file:///seg-${sequence}.mp4`, status, promise };
}

// A pending entry whose upload the test settles by hand.
function deferredEntry(sequence: number) {
  let settle!: (status: 'done' | 'failed') => void;
  const e = entry(sequence, 'pending');
  e.promise = new Promise<void>((resolve) => {
    settle = (status) => {
      e.status = status;
      resolve();
    };
  });
  return { entry: e, settle };
}

describe('selectShareSegment (pure decision)', () => {
  test('newest done → use_done', () => {
    const done = entry(2, 'done');
    expect(selectShareSegment([entry(1, 'done'), done])).toEqual({ action: 'use_done', entry: done });
  });

  test('newest pending → wait_pending', () => {
    const pending = entry(1, 'pending');
    expect(selectShareSegment([pending])).toEqual({ action: 'wait_pending', entry: pending });
  });

  test('newest failed → retry_failed', () => {
    const failed = entry(1, 'failed');
    expect(selectShareSegment([failed])).toEqual({ action: 'retry_failed', entry: failed });
  });

  test('no entries → cut_required', () => {
    expect(selectShareSegment([])).toEqual({ action: 'cut_required' });
  });

  test('older done + newer pending → waits on the newer one first', () => {
    const older = entry(1, 'done');
    const newer = entry(2, 'pending');
    expect(selectShareSegment([older, newer])).toEqual({ action: 'wait_pending', entry: newer });
  });

  test('older done + newer pending that already timed out → falls back to the older done one', () => {
    const older = entry(1, 'done');
    const newer = entry(2, 'pending');
    expect(selectShareSegment([older, newer], new Set([newer]))).toEqual({ action: 'use_done', entry: older });
  });

  test('every non-done entry exhausted and nothing done → cut_required', () => {
    const failed = entry(1, 'failed');
    expect(selectShareSegment([failed], new Set([failed]))).toEqual({ action: 'cut_required' });
  });

  test('does not depend on array order', () => {
    const newest = entry(3, 'done');
    expect(selectShareSegment([newest, entry(1, 'failed'), entry(2, 'done')])).toEqual({
      action: 'use_done',
      entry: newest,
    });
  });
});

describe('createShareSegmentResolver (async orchestration)', () => {
  function makeDeps(entries: Entry[], overrides: Partial<ShareSegmentDeps<Entry>> = {}) {
    const deps: ShareSegmentDeps<Entry> = {
      getEntries: () => entries,
      retryUpload: jest.fn(async () => {}),
      requestCut: jest.fn(async () => {}),
      isStopping: () => false,
      timeoutMs: 1000,
      ...overrides,
    };
    return deps;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test('an uploaded segment is reused — no cut, no retry', async () => {
    const done = entry(1, 'done');
    const deps = makeDeps([done]);
    await expect(createShareSegmentResolver(deps)()).resolves.toBe(done);
    expect(deps.requestCut).not.toHaveBeenCalled();
    expect(deps.retryUpload).not.toHaveBeenCalled();
  });

  test('a pending upload is waited on, then used — no cut', async () => {
    const { entry: pending, settle } = deferredEntry(1);
    const deps = makeDeps([pending]);
    const result = createShareSegmentResolver(deps)();
    settle('done');
    await expect(result).resolves.toBe(pending);
    expect(deps.requestCut).not.toHaveBeenCalled();
  });

  test('a pending upload that times out falls back to an older uploaded one — no cut', async () => {
    jest.useFakeTimers();
    const older = entry(1, 'done');
    const { entry: stuck } = deferredEntry(2);
    const deps = makeDeps([older, stuck]);
    const result = createShareSegmentResolver(deps)();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(older);
    expect(deps.requestCut).not.toHaveBeenCalled();
  });

  test('a failed upload is retried once, and used if the retry succeeds — no cut', async () => {
    const failed = entry(1, 'failed');
    const deps = makeDeps([failed], {
      retryUpload: jest.fn(async (e: Entry) => {
        e.status = 'done';
      }),
    });
    await expect(createShareSegmentResolver(deps)()).resolves.toBe(failed);
    expect(deps.retryUpload).toHaveBeenCalledTimes(1);
    expect(deps.requestCut).not.toHaveBeenCalled();
  });

  test('a pending upload that ends in failure gets its one retry before any cut', async () => {
    const { entry: pending, settle } = deferredEntry(1);
    const deps = makeDeps([pending], {
      retryUpload: jest.fn(async (e: Entry) => {
        e.status = 'done';
      }),
    });
    const result = createShareSegmentResolver(deps)();
    settle('failed');
    await expect(result).resolves.toBe(pending);
    expect(deps.retryUpload).toHaveBeenCalledTimes(1);
    expect(deps.requestCut).not.toHaveBeenCalled();
  });

  test('no segment at all → exactly one cut, and the new segment is awaited', async () => {
    const entries: Entry[] = [];
    const { entry: fresh, settle } = deferredEntry(1);
    const deps = makeDeps(entries, {
      requestCut: jest.fn(async () => {
        entries.push(fresh);
        setTimeout(() => settle('done'), 0);
      }),
    });
    await expect(createShareSegmentResolver(deps)()).resolves.toBe(fresh);
    expect(deps.requestCut).toHaveBeenCalledTimes(1);
  });

  test('if the cut segment still cannot upload → null, never a second cut', async () => {
    const entries: Entry[] = [];
    const deps = makeDeps(entries, {
      requestCut: jest.fn(async () => {
        entries.push(entry(1, 'failed'));
      }),
      retryUpload: jest.fn(async (e: Entry) => {
        e.status = 'failed';
      }),
    });
    await expect(createShareSegmentResolver(deps)()).resolves.toBeNull();
    expect(deps.requestCut).toHaveBeenCalledTimes(1);
    expect(deps.retryUpload).toHaveBeenCalledTimes(1);
  });

  test('if the cut produces nothing (e.g. no camera) → null, never a second cut', async () => {
    const deps = makeDeps([]);
    await expect(createShareSegmentResolver(deps)()).resolves.toBeNull();
    expect(deps.requestCut).toHaveBeenCalledTimes(1);
  });

  test('two concurrent callers share one resolve → only one cut', async () => {
    const entries: Entry[] = [];
    const deps = makeDeps(entries, {
      requestCut: jest.fn(async () => {
        await Promise.resolve();
        entries.push(entry(1, 'done'));
      }),
    });
    const resolve = createShareSegmentResolver(deps);
    const [a, b] = await Promise.all([resolve(), resolve()]);
    expect(a).toBe(b);
    expect(a?.segment.sequence).toBe(1);
    expect(deps.requestCut).toHaveBeenCalledTimes(1);
  });

  test('a cut that throws → null, and the guard is released so a later share can cut again', async () => {
    const entries: Entry[] = [];
    const requestCut = jest
      .fn()
      .mockRejectedValueOnce(new Error('camera remount failed'))
      .mockImplementationOnce(async () => {
        entries.push(entry(1, 'done'));
      });
    const resolve = createShareSegmentResolver(makeDeps(entries, { requestCut }));

    await expect(resolve()).resolves.toBeNull();
    await expect(resolve()).resolves.toEqual(expect.objectContaining({ segment: { sequence: 1 } }));
    expect(requestCut).toHaveBeenCalledTimes(2);
  });

  test('a cut that throws synchronously is handled the same way', async () => {
    const requestCut = jest.fn(() => {
      throw new Error('sync failure');
    });
    const resolve = createShareSegmentResolver(makeDeps([], { requestCut }));
    await expect(resolve()).resolves.toBeNull();
    await expect(resolve()).resolves.toBeNull();
    expect(requestCut).toHaveBeenCalledTimes(2);
  });

  test('a cut that hangs times out → null, and the guard is released', async () => {
    jest.useFakeTimers();
    const requestCut = jest.fn(() => new Promise<void>(() => {})); // never settles
    const resolve = createShareSegmentResolver(makeDeps([], { requestCut, cutTimeoutMs: 5000 }));

    const first = resolve();
    await jest.advanceTimersByTimeAsync(5000);
    await expect(first).resolves.toBeNull();

    const second = resolve();
    expect(second).not.toBe(first); // a fresh attempt, not the stuck one
    await jest.advanceTimersByTimeAsync(5000);
    await expect(second).resolves.toBeNull();
    expect(requestCut).toHaveBeenCalledTimes(2);
  });

  test('stops immediately (no cut) once the emergency is being torn down', async () => {
    const deps = makeDeps([], { isStopping: () => true });
    await expect(createShareSegmentResolver(deps)()).resolves.toBeNull();
    expect(deps.requestCut).not.toHaveBeenCalled();
  });
});
