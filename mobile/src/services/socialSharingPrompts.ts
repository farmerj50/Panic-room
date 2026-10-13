// Discoverability prompts for emergency social sharing, outside emergencies:
// the Home card and the one-time "after the emergency" reminder. Stored per
// user, so another account on the same phone starts fresh. Never throws.
import AsyncStorage from '@react-native-async-storage/async-storage';

const CARD_KEY = (userId: string) => `bes_social_card_${userId}`;
const REMIND_KEY = (userId: string) => `bes_social_remind_${userId}`;

export const CARD_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
// The first dismissal plus at most 2 more after it come back.
export const CARD_MAX_DISMISSALS = 3;

type CardState = { dismissCount: number; dismissedAt: number };

async function readCard(userId: string): Promise<CardState | null> {
  try {
    const raw = await AsyncStorage.getItem(CARD_KEY(userId));
    return raw ? (JSON.parse(raw) as CardState) : null;
  } catch {
    return null;
  }
}

// Whether the Home card may show (the caller also hides it once connected).
// "Not now" snoozes it for 30 days; after the first dismissal it can come
// back at most 2 more times, then never again. Settings always keeps the
// feature reachable.
export async function shouldShowHomeCard(userId: string, now = Date.now()): Promise<boolean> {
  const state = await readCard(userId);
  if (!state) return true;
  if (state.dismissCount >= CARD_MAX_DISMISSALS) return false;
  return now - state.dismissedAt >= CARD_SNOOZE_MS;
}

export async function dismissHomeCard(userId: string, now = Date.now()): Promise<void> {
  const state = await readCard(userId);
  const next: CardState = { dismissCount: (state?.dismissCount ?? 0) + 1, dismissedAt: now };
  try {
    await AsyncStorage.setItem(CARD_KEY(userId), JSON.stringify(next));
  } catch {}
}

// "Remind me after" during an emergency. Home only READS this; it's cleared
// once the user acts on (or dismisses) the reminder, so a crash or an
// interrupted navigation never loses it.
export async function setRemindAfterEmergency(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(REMIND_KEY(userId), String(Date.now()));
  } catch {}
}

export async function hasRemindAfterEmergency(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REMIND_KEY(userId))) !== null;
  } catch {
    return false;
  }
}

export async function clearRemindAfterEmergency(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(REMIND_KEY(userId));
  } catch {}
}
