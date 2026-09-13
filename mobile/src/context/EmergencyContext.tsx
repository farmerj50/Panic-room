import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contact } from '../types/contact';
import { getContactsFromBackend } from '../services/contactService';
import { addVideoSegment, getEmergencies, updateEmergency } from '../services/emergencyService';
import { uploadFile } from '../services/uploadService';
import { getInProgressEmergency, clearInProgressEmergency } from '../hooks/useAppStateEmergencyGuard';
import { navigationRef } from '../navigation/navigationRef';
import type { CameraFacing, SegmentFinalizedEvent } from '../../modules/background-camera/src/BackgroundCamera.types';

// ─── Emergency settings ──────────────────────────────────────────────────────

export type EmergencySettings = {
  /** Persistent notification on lock screen — tap ACTIVATE SOS without unlocking. */
  lockScreenEnabled: boolean;
  /** Background GPS task — keeps location fresh even when app is closed. */
  backgroundLocationEnabled: boolean;
  /** Auto-start camera recording when emergency activates (default on). */
  cameraAutoRecord: boolean;
  /** Auto-start audio recording when emergency activates (default on). */
  audioAutoRecord: boolean;
  /**
   * Which call action should run automatically when emergency mode
   * activates. Deliberately has no option that auto-dials 911 — the
   * countdown's cancel window is not treated as sufficient confirmation
   * for placing a real emergency call. Calling 911 always requires an
   * explicit tap on the "Call 911" button, which itself has a confirm
   * dialog (see confirmCallEmergencyNumber in EmergencyScreen.tsx).
   */
  emergencyCallMode: 'priority' | 'contacts' | 'ask' | 'none';
};

const DEFAULT_SETTINGS: EmergencySettings = {
  lockScreenEnabled: false,
  backgroundLocationEnabled: false,
  cameraAutoRecord: true,
  audioAutoRecord: true,
  emergencyCallMode: 'ask',
};

const SETTINGS_KEY = 'panicroom_emergency_settings';

// ─── Background camera capture (Android only) ───────────────────────────────
// Loaded via a Platform-gated dynamic require, not a static import — the
// underlying native module only exists on Android (see
// modules/background-camera/expo-module.config.json's "platforms": ["android"]),
// and requireNativeModule() throws immediately if invoked where the native
// side isn't linked. Same defensive pattern already used for expo-task-manager
// in services/locationService.ts.
type BackgroundCameraModuleType = typeof import('../../modules/background-camera/src/BackgroundCameraModule').default;
let backgroundCameraModule: BackgroundCameraModuleType | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    backgroundCameraModule = require('../../modules/background-camera/src/BackgroundCameraModule').default;
  } catch {
    backgroundCameraModule = null;
  }
}

export const isAndroidBackgroundCameraAvailable = backgroundCameraModule !== null;

// Same reasoning as backgroundCameraModule above — BackgroundCameraPreviewView.tsx
// also calls requireNativeViewManager() at module scope, which throws
// immediately on a platform where the native view isn't linked.
type BackgroundCameraPreviewViewType =
  typeof import('../../modules/background-camera/src/BackgroundCameraPreviewView').default;
export let BackgroundCameraPreviewView: BackgroundCameraPreviewViewType | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackgroundCameraPreviewView = require('../../modules/background-camera/src/BackgroundCameraPreviewView').default;
  } catch {
    BackgroundCameraPreviewView = null;
  }
}

type PendingSegmentUpload = {
  segment: SegmentFinalizedEvent;
  status: 'pending' | 'done' | 'failed';
  promise?: Promise<void>;
};

// Uploads the local video file, then attaches it to the emergency as an
// ordered segment, then tells the native module it can delete its durable
// journal marker for this segment — mirrors the same
// upload-then-confirm-then-cleanup flow the native side documents:
// CameraX finalizes -> native marker written -> JS event -> upload ->
// backend confirms -> marker deleted.
async function uploadVideoSegmentEntry(entry: PendingSegmentUpload): Promise<void> {
  const { segment } = entry;
  try {
    const { key } = await uploadFile({ localUri: segment.localUri, kind: 'video' });
    await addVideoSegment(segment.emergencyId, {
      fileUrl: key,
      facing: segment.facing,
      sequence: segment.sequence,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    });
    entry.status = 'done';
    backgroundCameraModule?.markSegmentUploaded(segment.emergencyId, segment.sequence);
  } catch (error) {
    entry.status = 'failed';
    console.warn('Failed to upload video segment', error);
  }
}

// ─── Context type ────────────────────────────────────────────────────────────

interface EmergencyContextType {
  isEmergency: boolean;
  emergencyId: string | null;
  contacts: Contact[];
  priorityContact: Contact | null;
  isSetupDone: boolean;
  emergencySettings: EmergencySettings;
  setEmergencyId: (id: string | null) => void;
  setContacts: (contacts: Contact[]) => void;
  setPriorityContact: (contact: Contact | null) => void;
  triggerEmergency: () => void;
  resolveEmergency: () => void;
  markSetupDone: () => void;
  loadContacts: () => Promise<void>;
  updateEmergencySettings: (patch: Partial<EmergencySettings>) => Promise<void>;
  /**
   * Set when the user chooses "Resume" on the relaunch-recovery prompt.
   * activateEmergency() must check this before creating a new backend
   * emergency: a resume reuses the existing emergencyId and continues its
   * sequence numbering — see consumePendingResume's doc for why this is an
   * invariant, not a suggestion.
   */
  consumePendingResume: () => { emergencyId: string; startingSequence: number } | null;
  // Android background camera capture — see modules/background-camera.
  // No-ops (or resolve immediately) on other platforms.
  startAndroidCapture: (emergencyId: string, facing: CameraFacing, startingSequence?: number) => Promise<void>;
  flipAndroidCapture: (facing: CameraFacing) => Promise<void>;
  stopAndroidCapture: () => Promise<void>;
  /** Bounded wait for in-flight segment uploads, retrying failed ones once — call during exit cleanup. */
  flushPendingVideoUploads: () => Promise<void>;
  /** Fires when the notification's "Stop Recording" action stopped capture while this screen may still be mounted. */
  onExternalCaptureStop: (handler: () => void) => () => void;
}

const EmergencyContext = createContext<EmergencyContextType | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function EmergencyProvider({ children }: { children: ReactNode }) {
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [contacts, setContactsState] = useState<Contact[]>([]);
  const [priorityContact, setPriorityContact] = useState<Contact | null>(null);
  const [isSetupDone, setIsSetupDone] = useState(false);
  const [emergencySettings, setEmergencySettings] = useState<EmergencySettings>(DEFAULT_SETTINGS);

  // Owned here (not by EmergencyScreen) so upload reconciliation survives
  // navigation, backgrounding, and the screen unmounting/remounting — see
  // the plan's "the screen should not own evidence durability."
  const pendingUploadsRef = useRef<PendingSegmentUpload[]>([]);
  const externalStopHandlersRef = useRef<Set<() => void>>(new Set());
  const pendingResumeRef = useRef<{ emergencyId: string; startingSequence: number } | null>(null);

  // Load persisted data on mount
  useEffect(() => {
    loadContacts();
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          setEmergencySettings({
            ...DEFAULT_SETTINGS,
            ...parsed,
            // Migrate accounts that still have the removed auto-dial-911
            // mode persisted from before this device's settings sync.
            emergencyCallMode:
              parsed.emergencyCallMode === 'emergency' ? 'ask' : parsed.emergencyCallMode ?? 'ask',
          });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribed once, for the app's lifetime, regardless of which screen is
  // visible — see the plan's rationale for moving this out of EmergencyScreen.
  useEffect(() => {
    if (!backgroundCameraModule) return;

    const segmentSub = backgroundCameraModule.addListener('onSegmentFinalized', (segment: SegmentFinalizedEvent) => {
      const entry: PendingSegmentUpload = { segment, status: 'pending' };
      pendingUploadsRef.current.push(entry);
      entry.promise = uploadVideoSegmentEntry(entry);
    });

    const errorSub = backgroundCameraModule.addListener('onError', (event: { message: string }) => {
      console.warn('BackgroundCamera error:', event.message);
    });

    const stoppedSub = backgroundCameraModule.addListener('onStoppedExternally', () => {
      // The notification's Stop Recording action only ever stops the
      // camera — it never resolves the backend emergency (that needs JS to
      // reach the backend, which is exactly why this event exists: JS *is*
      // alive here). Route it through the same resolve path a normal
      // in-app Stop would use, and let any mounted screen react.
      externalStopHandlersRef.current.forEach((handler) => handler());
    });

    return () => {
      segmentSub.remove();
      errorSub.remove();
      stoppedSub.remove();
    };
  }, []);

  // Relaunch recovery (§5 of the plan) — getInProgressEmergency() was
  // previously written on backgrounding but never read anywhere.
  useEffect(() => {
    (async () => {
      const inProgress = await getInProgressEmergency();
      if (!inProgress) return;

      let backendMaxSequence = 0;
      let stillActive = false;
      try {
        const events = await getEmergencies();
        const match = events.find((e) => e.id === inProgress.emergencyId);
        stillActive = match?.status === 'ACTIVE';
        backendMaxSequence = (match?.videoSegments ?? []).reduce((max, s) => Math.max(max, s.sequence), 0);
      } catch {
        // Backend unreachable — leave the local flag in place and try again
        // next launch rather than silently discarding a real interruption.
        return;
      }

      // Sweep any locally-journaled segments regardless of the backend
      // status check above — a marker on disk always means "not yet
      // confirmed uploaded," whether that's from this interrupted
      // emergency or a stale one that failed to upload for other reasons.
      // Also feeds the sequence-continuity invariant below: a segment can
      // be journaled locally but not yet confirmed by the backend.
      let journalMaxSequence = 0;
      if (backgroundCameraModule) {
        try {
          const pending = await backgroundCameraModule.listPendingSegments();
          for (const segment of pending) {
            if (segment.emergencyId === inProgress.emergencyId) {
              journalMaxSequence = Math.max(journalMaxSequence, segment.sequence);
            }
            const entry: PendingSegmentUpload = { segment, status: 'pending' };
            pendingUploadsRef.current.push(entry);
            entry.promise = uploadVideoSegmentEntry(entry);
          }
        } catch {}
      }

      if (!stillActive) {
        clearInProgressEmergency().catch(() => {});
        return;
      }

      // Resuming must never restart at sequence 1 — that would collide
      // with (or shadow) segments that already exist for this emergency.
      const nextSequence = Math.max(backendMaxSequence, journalMaxSequence) + 1;

      Alert.alert(
        'Emergency still active',
        'Bes was closed while an emergency was in progress and recording was interrupted. What would you like to do?',
        [
          {
            text: 'End Emergency',
            style: 'destructive',
            onPress: async () => {
              try {
                await updateEmergency(inProgress.emergencyId, { status: 'RESOLVED' });
              } catch {}
              clearInProgressEmergency().catch(() => {});
            },
          },
          {
            text: 'Resume',
            onPress: () => {
              pendingResumeRef.current = { emergencyId: inProgress.emergencyId, startingSequence: nextSequence };
              setEmergencyId(inProgress.emergencyId);
              setIsEmergency(true);
              if (navigationRef.isReady()) {
                navigationRef.navigate('Main', { screen: 'Emergency' });
              }
            },
          },
        ],
      );
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setContacts = async (newContacts: Contact[]) => {
    setContactsState(newContacts);
    setPriorityContact(newContacts.find((c) => c.isPriority) ?? null);
  };

  const loadContacts = async () => {
    try {
      const remoteContacts = await getContactsFromBackend();
      setContactsState(remoteContacts);
      setPriorityContact(remoteContacts.find((c) => c.isPriority) ?? null);
    } catch {
      // Backend unreachable — keep whatever contacts are already in state
      // (set on a previous successful load this session) rather than wiping.
    }

    try {
      const setup = await AsyncStorage.getItem('setupDone');
      setIsSetupDone(setup === 'true');
    } catch {}
  };

  const triggerEmergency = useCallback(() => setIsEmergency(true), []);

  const consumePendingResume = useCallback(() => {
    const resume = pendingResumeRef.current;
    pendingResumeRef.current = null;
    return resume;
  }, []);

  const resolveEmergency = useCallback(() => {
    setIsEmergency(false);
    setEmergencyId(null);
  }, []);

  const markSetupDone = async () => {
    setIsSetupDone(true);
    await AsyncStorage.setItem('setupDone', 'true');
  };

  const updateEmergencySettings = async (patch: Partial<EmergencySettings>) => {
    // Use the functional updater so concurrent calls each see the latest state
    // and don't overwrite each other when two toggles fire before a re-render.
    let next!: EmergencySettings;
    setEmergencySettings((prev) => {
      next = { ...prev, ...patch };
      return next;
    });
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const startAndroidCapture = useCallback(
    async (id: string, facing: CameraFacing, startingSequence = 1) => {
      if (!backgroundCameraModule) return;
      await backgroundCameraModule.startCapture(id, facing, startingSequence);
    },
    [],
  );

  const flipAndroidCapture = useCallback(async (facing: CameraFacing) => {
    if (!backgroundCameraModule) return;
    await backgroundCameraModule.flip(facing);
  }, []);

  const stopAndroidCapture = useCallback(async () => {
    if (!backgroundCameraModule) return;
    await backgroundCameraModule.stopCapture();
  }, []);

  const flushPendingVideoUploads = useCallback(async () => {
    const pending = pendingUploadsRef.current;
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending.map((entry) => entry.promise ?? Promise.resolve())),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    const stillFailed = pending.filter((entry) => entry.status === 'failed');
    await Promise.allSettled(stillFailed.map((entry) => uploadVideoSegmentEntry(entry)));
    pendingUploadsRef.current = [];
  }, []);

  const onExternalCaptureStop = useCallback((handler: () => void) => {
    externalStopHandlersRef.current.add(handler);
    return () => {
      externalStopHandlersRef.current.delete(handler);
    };
  }, []);

  return (
    <EmergencyContext.Provider
      value={{
        isEmergency,
        emergencyId,
        contacts,
        priorityContact,
        isSetupDone,
        emergencySettings,
        setEmergencyId,
        setContacts,
        setPriorityContact,
        triggerEmergency,
        resolveEmergency,
        markSetupDone,
        loadContacts,
        updateEmergencySettings,
        consumePendingResume,
        startAndroidCapture,
        flipAndroidCapture,
        stopAndroidCapture,
        flushPendingVideoUploads,
        onExternalCaptureStop,
      }}
    >
      {children}
    </EmergencyContext.Provider>
  );
}

export function useEmergencyContext() {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergencyContext must be inside EmergencyProvider');
  return ctx;
}
