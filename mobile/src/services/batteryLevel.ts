// Battery percentage sent with GPS points, so trusted contacts can tell a
// phone that went quiet because its battery was running out. Read at most
// once a minute; null whenever it isn't available.
import * as Battery from 'expo-battery';

const MAX_AGE_MS = 60_000;
let cached: { value: number | null; at: number } | null = null;

export async function getBatteryPercent(now = Date.now()): Promise<number | null> {
  if (cached && now - cached.at < MAX_AGE_MS) return cached.value;
  let value: number | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    value = Number.isFinite(level) && level >= 0 ? Math.round(level * 100) : null;
  } catch {
    value = null;
  }
  cached = { value, at: now };
  return value;
}

export function __resetBatteryCacheForTests() {
  cached = null;
}
