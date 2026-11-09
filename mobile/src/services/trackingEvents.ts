// The server attaches its view of an emergency's tracking state to
// emergency and GPS-upload responses. Published here so recoveryTracking can
// react (e.g. stop after a remote stop) without the upload queues importing
// it — that would be an import cycle.
import type { EmergencyTracking } from '../types/Emergency';

type Listener = (serverEmergencyId: string, tracking: EmergencyTracking) => void;
const listeners = new Set<Listener>();

export function subscribeToTracking(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishTracking(serverEmergencyId: string, tracking: EmergencyTracking | undefined | null) {
  if (!tracking?.state) return;
  for (const listener of listeners) {
    try {
      listener(serverEmergencyId, tracking);
    } catch (error) {
      console.warn('[Tracking] listener failed', error);
    }
  }
}
