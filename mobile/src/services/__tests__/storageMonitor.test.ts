import { getFreeBytes, isInsufficientStorageError, shouldRecordVideo, storageLevel } from '../storageMonitor';

let mockAvailable: unknown = 0;
jest.mock('expo-file-system', () => ({ Paths: { get availableDiskSpace() { return mockAvailable; } } }));

const MB = 1024 * 1024;

test('storage levels', () => {
  expect(storageLevel(null)).toBe('ok');
  expect(storageLevel(2048 * MB)).toBe('ok');
  expect(storageLevel(900 * MB)).toBe('low');
  expect(storageLevel(200 * MB)).toBe('reduced');
  expect(storageLevel(80 * MB)).toBe('critical');
});

test('video pauses below 100 MB and resumes only above 150 MB (no flapping)', () => {
  expect(shouldRecordVideo(120 * MB, false)).toBe(true);
  expect(shouldRecordVideo(90 * MB, false)).toBe(false);
  expect(shouldRecordVideo(120 * MB, true)).toBe(false);
  expect(shouldRecordVideo(160 * MB, true)).toBe(true);
  expect(shouldRecordVideo(null, true)).toBe(true);
});

test('a full disk (0 bytes) is reported as 0, not as "unknown"', () => {
  mockAvailable = 0;
  expect(getFreeBytes()).toBe(0);
  expect(storageLevel(getFreeBytes())).toBe('critical');
  expect(shouldRecordVideo(getFreeBytes(), false)).toBe(false);
  mockAvailable = undefined;
  expect(getFreeBytes()).toBeNull();
  mockAvailable = -1;
  expect(getFreeBytes()).toBeNull();
});

test('recognizes out-of-space recording errors', () => {
  expect(
    isInsufficientStorageError(
      new Error('Video recording failed: Insufficient storage space. The available storage (0 bytes) is below the required threshold'),
    ),
  ).toBe(true);
  expect(isInsufficientStorageError(new Error('write failed: ENOSPC (No space left on device)'))).toBe(true);
  expect(isInsufficientStorageError(new Error('Starting video recording failed - could not create video file.'))).toBe(false);
});
