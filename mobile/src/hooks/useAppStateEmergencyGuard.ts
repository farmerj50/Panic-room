import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { getJSON, removeItem, setJSON } from '../utils/storage';

const IN_PROGRESS_EMERGENCY_KEY = 'panicroom_emergency_in_progress';

export type InProgressEmergency = {
  emergencyId: string;
  phase: string;
  elapsed: number;
  savedAt: string;
};

type ActiveEmergencyState = {
  emergencyId: string | null;
  phase: string;
  elapsed: number;
};

// No full background-recording continuity in v1 (that needs a native
// foreground-service module). This only persists enough state that a
// killed-and-relaunched app can detect "an emergency was in progress" —
// see getInProgressEmergency.
export function useAppStateEmergencyGuard(state: ActiveEmergencyState) {
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'background' && nextState !== 'inactive') return;

      const current = stateRef.current;
      if (!current.emergencyId) return;

      setJSON(IN_PROGRESS_EMERGENCY_KEY, {
        emergencyId: current.emergencyId,
        phase: current.phase,
        elapsed: current.elapsed,
        savedAt: new Date().toISOString(),
      } satisfies InProgressEmergency).catch(() => {});
    });

    return () => subscription.remove();
  }, []);
}

export function getInProgressEmergency(): Promise<InProgressEmergency | null> {
  return getJSON<InProgressEmergency>(IN_PROGRESS_EMERGENCY_KEY);
}

export function clearInProgressEmergency(): Promise<void> {
  return removeItem(IN_PROGRESS_EMERGENCY_KEY);
}

// ─── Hidden SOS pending-retry flag ───────────────────────────────────────────
// Hidden SOS activates silently with no blocking UI (see EmergencyContext's
// activateEmergencySilently) — if it fails even after its one silent retry,
// there's no alert to show without breaking the covert intent. Instead this
// flag is checked next time the Covert Messages screen opens, surfacing a
// low-key inline retry banner rather than a loud Alert.

const PENDING_HIDDEN_SOS_KEY = 'panicroom_hidden_sos_pending';

export type PendingHiddenSos = {
  attemptedAt: string;
  reason: 'create-failed' | 'notify-failed';
  linkedCovertMessageId?: string;
};

export function setPendingHiddenSos(value: PendingHiddenSos): Promise<void> {
  return setJSON(PENDING_HIDDEN_SOS_KEY, value);
}

export function getPendingHiddenSos(): Promise<PendingHiddenSos | null> {
  return getJSON<PendingHiddenSos>(PENDING_HIDDEN_SOS_KEY);
}

export function clearPendingHiddenSos(): Promise<void> {
  return removeItem(PENDING_HIDDEN_SOS_KEY);
}
