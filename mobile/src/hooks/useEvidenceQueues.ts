import { useEffect } from 'react';
import { AppState } from 'react-native';

import { resumeLocationQueue } from '../services/locationQueue';
import { resumePendingEmergencies, subscribeToPendingEmergencies } from '../services/pendingEmergencies';
import { reconcileClipQueue, resumeClipQueue } from '../services/segmentQueue';

// Signed-in app shell: recovers emergency evidence left by a crash or
// restart (clips and GPS points still waiting to upload) and retries
// whenever the app returns to the foreground. Emergencies recorded without
// signal are created on the server first; their clips and GPS points follow
// the moment that succeeds. Never blocks the UI.
export function useEvidenceQueues() {
  useEffect(() => {
    reconcileClipQueue()
      .then(({ recovered, lost, incomplete }) => {
        if (recovered || lost || incomplete) {
          console.warn(`Evidence queue: recovered ${recovered} clip(s), ${incomplete} incomplete (kept), ${lost} missing.`);
        }
      })
      .catch((error) => console.warn('Evidence queue reconcile failed', error));
    void resumeLocationQueue();
    void resumePendingEmergencies();

    // An emergency reached the server: upload what was waiting for it.
    const unsubscribe = subscribeToPendingEmergencies((event) => {
      if (event.type !== 'synced') return;
      void resumeClipQueue();
      void resumeLocationQueue();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void resumePendingEmergencies();
      void resumeClipQueue();
      void resumeLocationQueue();
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);
}
