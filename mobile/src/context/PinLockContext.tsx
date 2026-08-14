import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { clearPin as clearStoredPin, isPinSet, setPin as storeSetPin, verifyPin } from '../services/pinStorage';
import { ACTION_ACTIVATE_SOS } from '../services/lockScreenService';

// expo-notifications loads at runtime, same guarded pattern AppNavigator.tsx
// uses — this module must still boot before `npm install` provisions it.
type _NotifResponse = { actionIdentifier: string };
type _NotifModule = { getLastNotificationResponseAsync(): Promise<_NotifResponse | null> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: _NotifModule | null = null;
try { Notifications = require('expo-notifications') as _NotifModule; } catch {}  // eslint-disable-line @typescript-eslint/no-require-imports

type PinLockStatus = 'checking' | 'no-pin' | 'locked' | 'unlocked';

type PinLockContextType = {
  status: PinLockStatus;
  hasPin: boolean;
  decoyActive: boolean;
  unlock: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  removePin: (currentPin: string) => Promise<boolean>;
  /** Forgot-PIN recovery: identity was already re-verified via account login, so no current PIN is required. */
  forceClearPin: () => Promise<void>;
  /** The PinLockScreen's manual "Emergency" button — skips the PIN for this launch and asks AuthenticatedNavigator to land on Emergency once it's ready. */
  bypassToEmergency: () => void;
  /** Called once by AuthenticatedNavigator's onReady; returns true if it should navigate to Emergency. */
  consumePendingEmergencyBypass: () => boolean;
  activateDecoy: () => void;
  /** No PIN set -> always succeeds. PIN set -> requires the correct pin. */
  exitDecoy: (pin?: string) => Promise<boolean>;
};

const PinLockContext = createContext<PinLockContextType | null>(null);

async function detectEmergencyBypass(): Promise<boolean> {
  // SOS lock-screen notification cold-start tap — mirrors the check in
  // AppNavigator.tsx; calling getLastNotificationResponseAsync() twice is
  // harmless, it doesn't consume/clear the response.
  if (Notifications) {
    try {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response?.actionIdentifier === ACTION_ACTIVATE_SOS) return true;
    } catch {
      // Throws UnavailabilityError on web — fall through to the deep-link check.
    }
  }

  // Direct web deep link (bes-app.com/emergency) or a native emergency deep
  // link — matches the 'emergency' path used in AppNavigator's linking config.
  try {
    const initialUrl = await Linking.getInitialURL();
    if (initialUrl) {
      const path = initialUrl
        .split(/[?#]/)[0]
        .replace(/^[a-zA-Z0-9+.-]+:\/\/[^/]*/, '')
        .replace(/^\/+|\/+$/g, '');
      if (path === 'emergency') return true;
    }
  } catch {
    // Ignore — absence of a deep link just means a normal launch.
  }

  return false;
}

export function PinLockProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PinLockStatus>('checking');
  const [hasPin, setHasPin] = useState(false);
  const [decoyActive, setDecoyActive] = useState(false);
  const pendingEmergencyBypass = useRef(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const [pinSet, bypass] = await Promise.all([isPinSet(), detectEmergencyBypass()]);
      if (!mounted) return;

      setHasPin(pinSet);
      if (!pinSet) {
        setStatus('no-pin');
      } else if (bypass) {
        setStatus('unlocked');
      } else {
        setStatus('locked');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<PinLockContextType>(
    () => ({
      status,
      hasPin,
      decoyActive,
      async unlock(pin) {
        const ok = await verifyPin(pin);
        if (ok) setStatus('unlocked');
        return ok;
      },
      async setPin(pin) {
        await storeSetPin(pin);
        setHasPin(true);
        setStatus('unlocked');
      },
      async changePin(currentPin, newPin) {
        const ok = await verifyPin(currentPin);
        if (!ok) return false;
        await storeSetPin(newPin);
        return true;
      },
      async removePin(currentPin) {
        const ok = await verifyPin(currentPin);
        if (!ok) return false;
        await clearStoredPin();
        setHasPin(false);
        setStatus('no-pin');
        return true;
      },
      async forceClearPin() {
        await clearStoredPin();
        setHasPin(false);
        setStatus('no-pin');
      },
      bypassToEmergency() {
        pendingEmergencyBypass.current = true;
        setStatus('unlocked');
      },
      consumePendingEmergencyBypass() {
        const pending = pendingEmergencyBypass.current;
        pendingEmergencyBypass.current = false;
        return pending;
      },
      activateDecoy() {
        setDecoyActive(true);
      },
      async exitDecoy(pin) {
        if (!hasPin) {
          setDecoyActive(false);
          return true;
        }
        if (!pin) return false;
        const ok = await verifyPin(pin);
        if (ok) setDecoyActive(false);
        return ok;
      },
    }),
    [status, hasPin, decoyActive],
  );

  return <PinLockContext.Provider value={value}>{children}</PinLockContext.Provider>;
}

export function usePinLock() {
  const ctx = useContext(PinLockContext);
  if (!ctx) throw new Error('usePinLock must be used inside PinLockProvider');
  return ctx;
}
