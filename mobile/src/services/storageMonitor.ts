// Device-storage policy for emergency recording. Evidence already on the
// device is NEVER deleted to make room — low storage only changes what new
// video is recorded:
//   < 1 GB    warn (banner), keep recording normally
//   < 250 MB  record new clips at reduced quality
//   < 100 MB  pause new video (audio + GPS continue)
//   > 150 MB  resume video automatically (gap above 100 MB so it doesn't flap)
import { Paths } from 'expo-file-system';

const MB = 1024 * 1024;
export const WARN_BELOW_BYTES = 1024 * MB;
export const REDUCED_QUALITY_BELOW_BYTES = 250 * MB;
export const PAUSE_VIDEO_BELOW_BYTES = 100 * MB;
export const RESUME_VIDEO_ABOVE_BYTES = 150 * MB;
// Effectively full: even audio may not be saved.
export const FULL_BELOW_BYTES = 10 * MB;

export type StorageLevel = 'ok' | 'low' | 'reduced' | 'critical';

// null when the platform can't tell us (e.g. web) — treated as "ok". 0 is a
// real answer (a full disk) and must not be mistaken for "unknown".
export function getFreeBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return typeof free === 'number' && Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

export function storageLevel(freeBytes: number | null): StorageLevel {
  if (freeBytes === null) return 'ok';
  if (freeBytes < PAUSE_VIDEO_BELOW_BYTES) return 'critical';
  if (freeBytes < REDUCED_QUALITY_BELOW_BYTES) return 'reduced';
  if (freeBytes < WARN_BELOW_BYTES) return 'low';
  return 'ok';
}

// Whether new video should be recorded, with hysteresis: once paused, video
// stays paused until free space is back above RESUME_VIDEO_ABOVE_BYTES.
export function shouldRecordVideo(freeBytes: number | null, currentlyPaused: boolean): boolean {
  if (freeBytes === null) return true;
  if (currentlyPaused) return freeBytes > RESUME_VIDEO_ABOVE_BYTES;
  return freeBytes >= PAUSE_VIDEO_BELOW_BYTES;
}

// expo-camera / CameraX refusing to record because the disk is full.
export function isInsufficientStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /insufficient storage|no space left|ENOSPC|disk is full/i.test(message);
}

export function formatMegabytes(bytes: number) {
  return `${Math.max(0, Math.round(bytes / MB))} MB`;
}
