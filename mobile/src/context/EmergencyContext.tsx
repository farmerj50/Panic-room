import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Contact } from '../types/contact';
import { getContactsFromBackend } from '../services/contactService';
import { createEmergency, notifyEmergencyContacts } from '../services/emergencyService';
import { getCurrentLocation, getLastKnownLocation, watchLocation } from '../services/locationService';
import { mapUrl } from '../utils/mapUrl';
import { setPendingHiddenSos } from '../hooks/useAppStateEmergencyGuard';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LatLng = { latitude: number; longitude: number };
type NotifyResponse = {
  sent: boolean;
  notifiedCount: number;
  providerConfigured: boolean;
  error?: string;
};

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

// ─── Context type ────────────────────────────────────────────────────────────

export type CoreActivationParams = {
  startAudio: boolean;
  onLocationUpdate?: (loc: LatLng | null) => void;
  onStatus?: (message: string) => void;
  onNotifyResult?: (response: NotifyResponse) => void;
};

export type CoreActivationResult =
  | { ok: true; emergencyId: string; location: LatLng | null }
  | { ok: false; error: 'CREATE_FAILED' };

export type SilentActivationParams = {
  /** Logging/analytics only — must never be used to branch activation logic. */
  reason: string;
  linkedCovertMessageId?: string;
};

export type SilentActivationResult =
  | { ok: true; emergencyId: string; reused: boolean }
  | { ok: false; error: 'ALREADY_PENDING' | 'CREATE_FAILED' };

interface EmergencyContextType {
  isEmergency: boolean;
  emergencyId: string | null;
  contacts: Contact[];
  orderedContacts: Contact[];
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
  runCoreActivation: (params: CoreActivationParams) => Promise<CoreActivationResult>;
  activateEmergencySilently: (params: SilentActivationParams) => Promise<SilentActivationResult>;
  stopAudioCapture: () => Promise<string | null>;
  stopLocationWatch: () => void;
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

  const orderedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(b.isPriority) - Number(a.isPriority)),
    [contacts],
  );

  // useAudioRecorder/useState/useRef live here (not in EmergencyScreen) so
  // Hidden SOS can record audio without mounting any screen — see
  // runCoreActivation/activateEmergencySilently below.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const locationSubRef = useRef<{ remove: () => void } | null>(null);
  const silentActivationInFlight = useRef(false);
  const lastSilentNotifyAt = useRef(0);
  // Mirrors state for use inside callbacks without adding them to every
  // dependency array — same pattern EmergencyScreen already uses for
  // currentLocationRef/activeEmergencyIdRef.
  const isEmergencyRef = useRef(isEmergency);
  isEmergencyRef.current = isEmergency;
  const emergencyIdRef = useRef(emergencyId);
  emergencyIdRef.current = emergencyId;
  const orderedContactsRef = useRef(orderedContacts);
  orderedContactsRef.current = orderedContacts;

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

  const resolveEmergency = useCallback(() => {
    setIsEmergency(false);
    setEmergencyId(null);
  }, []);

  const stopLocationWatch = useCallback(() => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
  }, []);

  const stopAudioCapture = useCallback(async (): Promise<string | null> => {
    try {
      await Promise.race([audioRecorder.stop().catch(() => {}), wait(750)]);
    } catch {}
    return audioRecorder.uri ?? null;
  }, [audioRecorder]);

  // The one, shared implementation of "acquire GPS, create/reuse the backend
  // emergency, start audio, kick off contact notification" — called by both
  // EmergencyScreen's countdown-based activateEmergency and the headless
  // activateEmergencySilently below, so there is exactly one place that does
  // this rather than two parallel implementations.
  //
  // Video capture is deliberately NOT part of this shared core — it stays
  // entirely owned by EmergencyScreen (JS CameraView requires a mounted
  // view). Hidden SOS never starts video in this version.
  //
  // Notify is fire-and-forget: this function resolves as soon as the
  // emergency exists and audio capture has started, without waiting on the
  // SMS round-trip, so a slow/unavailable provider never blocks activation
  // success. The notify outcome is delivered later via onNotifyResult.
  const runCoreActivation = useCallback(
    async (params: CoreActivationParams): Promise<CoreActivationResult> => {
      params.onStatus?.('Getting GPS location.');
      let currentLocation = await getCurrentLocation();
      if (!currentLocation) currentLocation = await getLastKnownLocation();
      params.onLocationUpdate?.(currentLocation);

      try {
        const sub = await watchLocation((loc) => params.onLocationUpdate?.(loc));
        locationSubRef.current?.remove();
        locationSubRef.current = sub;
      } catch {
        // Live watch failing isn't fatal — the one-shot fix above still
        // goes to createEmergency and the initial notify message.
      }

      let newEmergencyId: string;
      try {
        params.onStatus?.('Creating emergency event.');
        const emergency = await createEmergency({
          latitude: currentLocation?.latitude,
          longitude: currentLocation?.longitude,
        });
        newEmergencyId = emergency.id;
        setEmergencyId(emergency.id);
      } catch {
        return { ok: false, error: 'CREATE_FAILED' };
      }

      if (params.startAudio) {
        params.onStatus?.('Starting audio recording.');
        try {
          await audioRecorder.prepareToRecordAsync();
          audioRecorder.record();
        } catch {
          // Best-effort — losing audio doesn't fail the whole activation.
        }
      }

      const contactsToNotify = orderedContactsRef.current;
      if (contactsToNotify.length > 0) {
        notifyEmergencyContacts({
          emergencyId: newEmergencyId,
          contacts: contactsToNotify,
          message: `Bes emergency activated. Location: ${mapUrl(currentLocation)}`,
        })
          .then((response) => params.onNotifyResult?.(response))
          .catch((error) => {
            params.onNotifyResult?.({
              sent: false,
              notifiedCount: 0,
              providerConfigured: false,
              error: error instanceof Error ? error.message : 'Notify failed',
            });
          });
      }

      return { ok: true, emergencyId: newEmergencyId, location: currentLocation };
    },
    [audioRecorder],
  );

  const activateEmergencySilently = useCallback(
    async (params: SilentActivationParams): Promise<SilentActivationResult> => {
      // Already active — don't create a second EmergencyEvent. A repeat
      // Hidden SOS tap is still meaningful (the sender may have moved), so
      // re-notify with a fresh location rather than silently no-opping, but
      // debounce so a panicked repeated tap doesn't spam contacts with SMS.
      if (isEmergencyRef.current && emergencyIdRef.current) {
        const currentEmergencyId = emergencyIdRef.current;
        const now = Date.now();
        if (now - lastSilentNotifyAt.current >= 30_000) {
          lastSilentNotifyAt.current = now;
          const contactsToNotify = orderedContactsRef.current;
          if (contactsToNotify.length > 0) {
            (async () => {
              const loc = (await getCurrentLocation()) ?? (await getLastKnownLocation());
              notifyEmergencyContacts({
                emergencyId: currentEmergencyId,
                contacts: contactsToNotify,
                message: `Bes emergency activated. Location: ${mapUrl(loc)}`,
              }).catch(() => {});
            })();
          }
        }
        return { ok: true, emergencyId: currentEmergencyId, reused: true };
      }

      if (silentActivationInFlight.current) {
        return { ok: false, error: 'ALREADY_PENDING' };
      }
      silentActivationInFlight.current = true;
      try {
        triggerEmergency();
        let result = await runCoreActivation({ startAudio: true });
        if (!result.ok) {
          await wait(2000);
          result = await runCoreActivation({ startAudio: true });
        }
        if (!result.ok) {
          resolveEmergency();
          await setPendingHiddenSos({
            attemptedAt: new Date().toISOString(),
            reason: 'create-failed',
            linkedCovertMessageId: params.linkedCovertMessageId,
          }).catch(() => {});
          return { ok: false, error: 'CREATE_FAILED' };
        }
        return { ok: true, emergencyId: result.emergencyId, reused: false };
      } finally {
        silentActivationInFlight.current = false;
      }
    },
    [runCoreActivation, triggerEmergency, resolveEmergency],
  );

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

  return (
    <EmergencyContext.Provider
      value={{
        isEmergency,
        emergencyId,
        contacts,
        orderedContacts,
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
        runCoreActivation,
        activateEmergencySilently,
        stopAudioCapture,
        stopLocationWatch,
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
