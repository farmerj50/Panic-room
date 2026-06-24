import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contact } from '../types/contact';
import { getContactsFromBackend } from '../services/contactService';

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
  /** After dialing 911, automatically open the priority contact's dialer too. */
  autoCallContact: boolean;
  /** Which call action should run when emergency mode activates. */
  emergencyCallMode: 'emergency' | 'priority' | 'contacts' | 'ask' | 'none';
  /** Optional priority-contact follow-up after opening the emergency-number dialer. */
  contactFollowUpAction: 'none' | 'call' | 'callAll' | 'facetime';
};

const DEFAULT_SETTINGS: EmergencySettings = {
  lockScreenEnabled: false,
  backgroundLocationEnabled: false,
  cameraAutoRecord: true,
  audioAutoRecord: true,
  autoCallContact: false,
  emergencyCallMode: 'emergency',
  contactFollowUpAction: 'none',
};

const SETTINGS_KEY = 'panicroom_emergency_settings';

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
            contactFollowUpAction:
              parsed.contactFollowUpAction ?? (parsed.autoCallContact ? 'call' : 'none'),
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
