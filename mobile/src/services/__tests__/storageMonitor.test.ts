import { shouldRecordVideo, storageLevel } from '../storageMonitor';

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
