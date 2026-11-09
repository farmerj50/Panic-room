// Phone recovery tracking (opt-in, Emergency Settings, off by default).
//
// When an SOS ends and the person opted in, this phone keeps sending its
// location into the same emergency — about every 30 s, through the existing
// background location task, foreground-service notification and encrypted
// offline GPS queue — until one of:
//   - "Phone recovered" on this phone,
//   - "Stop tracking" from another device signed in to the account,
//   - 72 hours after the SOS ended,
//   - the setting is turned off or location permission is taken away.
//
// The server is the authority: it only starts tracking with the account's
// recorded consent, and a remote stop or expiry is final there at once. This
// phone stops as soon as it hears about it (GPS upload replies, emergency
// replies, or the check on launch/foreground) and never restarts it.
//
// Android limits (not worked around): after a force-stop or a reboot nothing
// runs until the app is opened again; battery savers may delay updates.
// Points recorded while offline are queued and uploaded later.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { ApiError } from './apiClient';
import { getEmergencyTracking, stopRecoveryTracking } from './emergencyService';
import { flushLocationQueue, getActiveGpsEmergency, setActiveGpsEmergency } from './locationQueue';
import { BACKGROUND_LOCATION_TASK, startBackgroundLocationMonitoring } from './locationService';
import { serverIdFor } from './pendingEmergencies';
import { subscribeToTracking } from './trackingEvents';
import type { EmergencyTracking } from '../types/Emergency';

export const RECOVERY_TRACKING_KEY = 'bes_recovery_tracking';
const PENDING_STOPS_KEY = 'bes_recovery_pending_stops';
const SETTINGS_KEY = 'panicroom_emergency_settings';

export const RECOVERY_TTL_MS = 72 * 60 * 60 * 1000;
export const RECOVERY_INTERVAL_MS = 30_000;
// How often the background task asks the server whether tracking was
// stopped remotely (uploads also carry the answer, so this is a backstop).
const SERVER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type RecoveryState = {
  emergencyId: string; // the phone's id for the emergency
  startedAt: string;
  expiresAt: string;
  lastServerCheckAt?: number;
};

export type StopReason = 'recovered' | 'remote_stop' | 'expired' | 'consent_withdrawn' | 'permission_revoked' | 'server';

type Listener = (state: RecoveryState | null) => void;
const listeners = new Set<Listener>();
let chain: Promise<unknown> = Promise.resolve();

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

export function subscribeToRecoveryTracking(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(state: RecoveryState | null) {
  for (const listener of listeners) listener(state);
}

export async function getRecoveryTracking(): Promise<RecoveryState | null> {
  try {
    const raw = await AsyncStorage.getItem(RECOVERY_TRACKING_KEY);
    return raw ? (JSON.parse(raw) as RecoveryState) : null;
  } catch {
    return null;
  }
}

async function saveState(state: RecoveryState | null) {
  if (state) await AsyncStorage.setItem(RECOVERY_TRACKING_KEY, JSON.stringify(state));
  else await AsyncStorage.removeItem(RECOVERY_TRACKING_KEY);
}

async function readSettings(): Promise<{ recoveryTrackingEnabled?: boolean; backgroundLocationEnabled?: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function hasLocationPermissions(): Promise<boolean> {
  try {
    const [fg, bg] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync()]);
    return fg.status === 'granted' && bg.status === 'granted';
  } catch {
    return false;
  }
}

// Whether ending the SOS right now should go into recovery tracking.
export async function shouldStartRecoveryTracking(): Promise<boolean> {
  const settings = await readSettings();
  if (!settings.recoveryTrackingEnabled) return false;
  return hasLocationPermissions();
}

async function startRecoveryLocationUpdates(): Promise<boolean> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      // Stops are judged against 50 m, so this needs GPS, not cell/Wi-Fi.
      accuracy: Location.Accuracy.High,
      timeInterval: RECOVERY_INTERVAL_MS,
      // No distance filter: a parked phone keeps reporting, so contacts can
      // tell "still there" from "gone quiet".
      distanceInterval: 0,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Bes recovery tracking is on',
        notificationBody: "This phone's location is shared with your trusted contacts until you mark it recovered in Bes.",
        notificationColor: '#7C3AED',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch (error) {
    console.warn('[Recovery] could not start location updates', error);
    return false;
  }
}

// Back to whatever ran before: Background Location Monitoring if the person
// has it on, otherwise no background updates at all.
async function restoreNormalLocationUpdates() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {}
  if ((await readSettings()).backgroundLocationEnabled) await startBackgroundLocationMonitoring();
}

// Called as the SOS ends, after its live GPS watch stopped. endedAt is when
// the SOS ended (tracking expires 72 h after it, matching the server).
export function beginRecoveryTracking(emergencyId: string, endedAt: string): Promise<boolean> {
  return locked(async () => {
    const state: RecoveryState = {
      emergencyId,
      startedAt: endedAt,
      expiresAt: new Date(new Date(endedAt).getTime() + RECOVERY_TTL_MS).toISOString(),
    };
    await saveState(state);
    await setActiveGpsEmergency(emergencyId);
    if (!(await startRecoveryLocationUpdates())) {
      await saveState(null);
      await setActiveGpsEmergency(null);
      return false;
    }
    emit(state);
    return true;
  });
}

async function queueServerStop(emergencyId: string, reason: 'recovered' | 'permission_revoked') {
  try {
    const raw = await AsyncStorage.getItem(PENDING_STOPS_KEY);
    const pending: Array<{ emergencyId: string; reason: string }> = raw ? JSON.parse(raw) : [];
    if (!pending.some((p) => p.emergencyId === emergencyId)) pending.push({ emergencyId, reason });
    await AsyncStorage.setItem(PENDING_STOPS_KEY, JSON.stringify(pending));
  } catch {}
}

// Sends stops made on this phone while it had no signal. Final on the
// server either way, so a failed send is simply retried later.
export async function flushPendingRecoveryStops(): Promise<void> {
  let pending: Array<{ emergencyId: string; reason: 'recovered' | 'permission_revoked' }> = [];
  try {
    const raw = await AsyncStorage.getItem(PENDING_STOPS_KEY);
    pending = raw ? JSON.parse(raw) : [];
  } catch {
    return;
  }
  const remaining = [];
  for (const stop of pending) {
    try {
      await stopRecoveryTracking(await serverIdFor(stop.emergencyId), stop.reason);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) remaining.push(stop);
    }
  }
  try {
    if (remaining.length) await AsyncStorage.setItem(PENDING_STOPS_KEY, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(PENDING_STOPS_KEY);
  } catch {}
}

// Stops tracking on this phone. Stops the person made here are also sent to
// the server (queued if offline); stops that came from the server aren't.
export function endRecoveryTracking(reason: StopReason): Promise<void> {
  return locked(async () => {
    const state = await getRecoveryTracking();
    if (!state) return;
    await saveState(null);
    if ((await getActiveGpsEmergency()) === state.emergencyId) await setActiveGpsEmergency(null);
    await restoreNormalLocationUpdates();
    emit(null);
    // Upload what was recorded before the stop (the server keeps points up
    // to the moment it ended).
    void flushLocationQueue();
    if (reason === 'recovered' || reason === 'permission_revoked') {
      await queueServerStop(state.emergencyId, reason);
      void flushPendingRecoveryStops();
    }
  });
}

export const markPhoneRecovered = () => endRecoveryTracking('recovered');

async function applyServerTracking(serverEmergencyId: string, tracking: EmergencyTracking) {
  const state = await getRecoveryTracking();
  if (!state || (await serverIdFor(state.emergencyId)) !== serverEmergencyId) return;
  if (tracking.state === 'CLOSED') {
    await endRecoveryTracking('server');
  } else if (tracking.state === 'RECOVERY_TRACKING' && tracking.recovery?.expiresAt) {
    // The server's expiry is the one that counts.
    await locked(async () => {
      const current = await getRecoveryTracking();
      if (current && current.emergencyId === state.emergencyId) {
        await saveState({ ...current, expiresAt: tracking.recovery!.expiresAt, lastServerCheckAt: Date.now() });
      }
    });
  }
}

subscribeToTracking((serverEmergencyId, tracking) => {
  void applyServerTracking(serverEmergencyId, tracking);
});

// Launch / foreground / periodically from the background task: expire,
// check the server, and make sure updates are actually running.
export async function reconcileRecoveryTracking({ now = Date.now(), restartUpdates = true } = {}): Promise<void> {
  await flushPendingRecoveryStops();
  const state = await getRecoveryTracking();
  if (!state) return;
  if (now >= new Date(state.expiresAt).getTime()) {
    await endRecoveryTracking('expired');
    return;
  }
  if (!(await hasLocationPermissions())) {
    await endRecoveryTracking('permission_revoked');
    return;
  }
  if (!(await readSettings()).recoveryTrackingEnabled) {
    await endRecoveryTracking('consent_withdrawn');
    return;
  }
  try {
    const tracking = await getEmergencyTracking(await serverIdFor(state.emergencyId));
    await applyServerTracking(await serverIdFor(state.emergencyId), tracking);
  } catch (error) {
    // 404 while the emergency is still waiting to reach the server is
    // normal; any other failure (offline) is retried next time.
    if (error instanceof ApiError && error.status === 404) {
      /* not on the server yet */
    }
  }
  if (!(await getRecoveryTracking())) return;
  if (restartUpdates) {
    // After a reboot, a force-stop or an OS kill the updates are gone until
    // the app runs again — resume them now.
    let running = false;
    try {
      running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {}
    if (!running) await startRecoveryLocationUpdates();
    if ((await getActiveGpsEmergency()) !== state.emergencyId) await setActiveGpsEmergency(state.emergencyId);
  }
}

// From the background location task, on every fix while tracking: enforces
// the expiry locally and asks the server now and then.
export async function onRecoveryFix(now = Date.now()): Promise<void> {
  const state = await getRecoveryTracking();
  if (!state) return;
  if (now >= new Date(state.expiresAt).getTime()) {
    await endRecoveryTracking('expired');
    return;
  }
  if (!state.lastServerCheckAt || now - state.lastServerCheckAt >= SERVER_CHECK_INTERVAL_MS) {
    await locked(async () => {
      const current = await getRecoveryTracking();
      if (current) await saveState({ ...current, lastServerCheckAt: now });
    });
    await reconcileRecoveryTracking({ now, restartUpdates: false });
  }
}
