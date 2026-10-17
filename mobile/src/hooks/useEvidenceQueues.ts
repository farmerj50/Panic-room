import { useEffect } from 'react';
import { AppState } from 'react-native';

import { resumeLocationQueue } from '../services/locationQueue';
import { reconcileClipQueue, resumeClipQueue } from '../services/segmentQueue';

// Signed-in app shell: recovers emergency evidence left by a crash or
// restart (clips and GPS points still waiting to upload) and retries
// whenever the app returns to the foreground. Never blocks the UI.
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

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void resumeClipQueue();
      void resumeLocationQueue();
    });
    return () => subscription.remove();
  }, []);
}
