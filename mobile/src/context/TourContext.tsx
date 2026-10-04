import {
  createContext,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CommonActions, type NavigationContainerRefWithCurrent } from '@react-navigation/native';

import type { RootStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { trackEvent } from '../services/analyticsService';
import { reportTourStatus } from '../services/tourService';
import { setTourActive } from '../services/tourModeState';

export type TourStepKey =
  | 'home-emergency'
  | 'emergency-evidence'
  | 'emergency-location'
  | 'emergency-911'
  | 'contacts-add'
  | 'contacts-form'
  | 'messages-covert'
  | 'messages-demo'
  | 'profile-settings'
  | 'settings-permissions'
  | 'settings-emergency'
  | 'settings-pro'
  | 'settings-tour'
  | 'settings-delete'
  | 'outro';

type NavRef = NavigationContainerRefWithCurrent<RootStackParamList>;
type Phase = 'idle' | 'prompt' | 'touring' | 'outro';

type TourStep = {
  key: TourStepKey;
  // Leaf route the step expects to be on. Leaving it pauses the tour.
  route: string | null;
  targetKey: string | null;
  title: string;
  body: string;
  enter: (nav: NavRef) => void;
};

const noop = () => {};

function goHome(nav: NavRef) {
  nav.navigate('Main', { screen: 'Home' });
}

const TOUR_STEPS: TourStep[] = [
  {
    key: 'home-emergency',
    route: 'Home',
    targetKey: 'home-help',
    title: 'Emergency Help',
    body: 'This starts Bes emergency protection. Tap it to see how activation works.',
    enter: goHome,
  },
  {
    key: 'emergency-evidence',
    route: 'Emergency',
    targetKey: 'emergency-camera',
    title: 'Evidence',
    body: 'Bes can begin recording evidence when you activate an emergency. Nothing is recorded in the tour.',
    enter: (nav) => nav.navigate('Main', { screen: 'Emergency', params: { tourMode: true } }),
  },
  {
    key: 'emergency-location',
    route: 'Emergency',
    targetKey: 'emergency-location',
    title: 'Location',
    body: 'Bes shares your live location with trusted contacts during an emergency. Nothing is shared in the tour.',
    enter: noop,
  },
  {
    key: 'emergency-911',
    route: 'Emergency',
    targetKey: 'emergency-911',
    title: 'Emergency call',
    body: 'Calling 911 always needs a manual tap. The tour can’t call anyone.',
    enter: noop,
  },
  {
    key: 'contacts-add',
    route: 'Contacts',
    targetKey: 'contacts-add',
    title: 'Trusted Contacts',
    body: 'Tap to add someone you trust. They are the people Bes can alert during an emergency.',
    enter: (nav) => nav.navigate('Contacts', { tourMode: true }),
  },
  {
    key: 'contacts-form',
    route: 'Contacts',
    targetKey: 'contacts-name-input',
    title: 'Add a contact',
    body: 'Type a name and number here. Nothing is saved during the tour.',
    enter: noop,
  },
  {
    key: 'messages-covert',
    route: 'Messages',
    targetKey: 'messages-covert',
    title: 'Covert Messaging',
    body: 'Hide a safety message inside an ordinary one when discretion matters. 🔒 Bes Pro',
    enter: (nav) => nav.navigate('Main', { screen: 'Messages' }),
  },
  {
    key: 'messages-demo',
    route: 'CovertMessageDemo',
    targetKey: 'covert-demo-bubble',
    title: 'How it works',
    body: 'This is a read-only example. Nothing is sent, encrypted, or purchased here.',
    enter: (nav) => nav.navigate('CovertMessageDemo'),
  },
  {
    key: 'profile-settings',
    route: 'Profile',
    targetKey: 'profile-settings-btn',
    title: 'Settings',
    body: 'Manage permissions, emergency settings, your subscription, and your account.',
    enter: (nav) => nav.navigate('Main', { screen: 'Profile' }),
  },
  {
    key: 'settings-permissions',
    route: 'Settings',
    targetKey: 'settings-permissions',
    title: 'Permissions',
    body: 'Review camera, microphone, and location access.',
    enter: (nav) => nav.navigate('Settings'),
  },
  {
    key: 'settings-emergency',
    route: 'Settings',
    targetKey: 'settings-emergency',
    title: 'Emergency Settings',
    body: 'Choose how Bes records and calls during an emergency.',
    enter: noop,
  },
  {
    key: 'settings-pro',
    route: 'Settings',
    targetKey: 'settings-pro',
    title: 'Bes Pro',
    body: 'Manage your Bes Pro subscription.',
    enter: noop,
  },
  {
    key: 'settings-tour',
    route: 'Settings',
    targetKey: 'settings-tour',
    title: 'Take a Tour',
    body: 'You can repeat this tour any time from here.',
    enter: noop,
  },
  {
    key: 'settings-delete',
    route: 'Settings',
    targetKey: 'settings-delete',
    title: 'Delete Account',
    body: 'Manage account deletion from here. Nothing is deleted during the tour.',
    enter: noop,
  },
  {
    key: 'outro',
    route: null,
    targetKey: null,
    title: 'You’re ready.',
    body: 'Bes is set up and ready to protect you.',
    enter: noop,
  },
];

type TourContextType = {
  phase: Phase;
  paused: boolean;
  currentStep: TourStep | null;
  stepIndex: number;
  stepCount: number;
  maybeOffer: () => void;
  startTour: () => void;
  restart: () => void;
  next: () => void;
  skip: () => void;
  finish: () => void;
  resume: () => void;
  trackInteraction: (stepKey: TourStepKey) => void;
  registerTarget: (key: string, ref: RefObject<unknown>) => () => void;
  getTarget: (key: string) => RefObject<unknown> | undefined;
  registerPress: (stepKey: TourStepKey, press: () => void) => void;
  invokeStepPress: (stepKey: TourStepKey) => void;
};

const TourContext = createContext<TourContextType | null>(null);

function activeLeafName(state: any): string | null {
  let s = state;
  while (s?.routes?.length) {
    const route = s.routes[s.index ?? s.routes.length - 1];
    if (!route.state) return route.name;
    s = route.state;
  }
  return null;
}

function findRouteKey(state: any, name: string): string | null {
  if (!state?.routes) return null;
  for (const route of state.routes) {
    if (route.name === name) return route.key;
    const found = findRouteKey(route.state, name);
    if (found) return found;
  }
  return null;
}

// Tab route params persist after the tour, so tourMode has to be cleared
// explicitly. Otherwise the Emergency tab would keep showing the demo.
function clearEmergencyTourParam(nav: NavRef) {
  const key = findRouteKey(nav.getRootState(), 'Emergency');
  if (key) nav.dispatch({ ...CommonActions.setParams({ tourMode: undefined }), source: key });
}

export function TourProvider({
  navigationRef,
  children,
}: {
  navigationRef: NavRef;
  children: ReactNode;
}) {
  const { consumeShouldOfferTour } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const targetsRef = useRef(new Map<string, RefObject<unknown>>());
  const pressesRef = useRef(new Map<TourStepKey, () => void>());

  useEffect(() => {
    setTourActive(phase === 'touring' || phase === 'outro');
    return () => setTourActive(false);
  }, [phase]);

  useEffect(() => {
    return navigationRef.addListener('state', () => {
      if (!navigationRef.isReady()) return;
      const step = TOUR_STEPS[stepIndex];
      if (phase !== 'touring' || !step?.route) {
        setPaused(false);
        return;
      }
      setPaused(activeLeafName(navigationRef.getRootState()) !== step.route);
    });
  }, [navigationRef, phase, stepIndex]);

  const registerTarget = useCallback((key: string, ref: RefObject<unknown>) => {
    targetsRef.current.set(key, ref);
    return () => {
      if (targetsRef.current.get(key) === ref) targetsRef.current.delete(key);
    };
  }, []);

  const getTarget = useCallback((key: string) => targetsRef.current.get(key), []);

  const registerPress = useCallback((stepKey: TourStepKey, press: () => void) => {
    pressesRef.current.set(stepKey, press);
  }, []);

  const invokeStepPress = useCallback((stepKey: TourStepKey) => {
    pressesRef.current.get(stepKey)?.();
  }, []);

  const enterStep = useCallback(
    (index: number) => {
      const step = TOUR_STEPS[index];
      if (!navigationRef.isReady() || !step) return;
      step.enter(navigationRef);
      setStepIndex(index);
      setPaused(false);
      trackEvent('tour_step_viewed', {
        step_key: step.key,
        route: step.route ?? 'none',
        target_key: step.targetKey ?? 'none',
      });
    },
    [navigationRef],
  );

  const endTour = useCallback(
    (outcome: 'completed' | 'skipped') => {
      if (outcome === 'completed') {
        trackEvent('tour_completed', { steps: TOUR_STEPS.length });
        reportTourStatus('completed').catch(() => {});
      } else {
        const stepKey = phase === 'touring' || phase === 'outro' ? TOUR_STEPS[stepIndex]?.key : 'prompt';
        trackEvent('tour_skipped', { step_key: stepKey ?? 'prompt' });
        reportTourStatus('skipped').catch(() => {});
      }
      if (navigationRef.isReady() && phase !== 'prompt') {
        clearEmergencyTourParam(navigationRef);
        goHome(navigationRef);
      }
      setPaused(false);
      setStepIndex(0);
      setPhase('idle');
    },
    [navigationRef, phase, stepIndex],
  );

  const value = useMemo<TourContextType>(
    () => ({
      phase,
      paused,
      currentStep: phase === 'touring' || phase === 'outro' ? TOUR_STEPS[stepIndex] : null,
      stepIndex,
      stepCount: TOUR_STEPS.length,
      maybeOffer() {
        if (consumeShouldOfferTour()) setPhase('prompt');
      },
      startTour() {
        if (!navigationRef.isReady()) return;
        trackEvent('tour_started');
        setPhase('touring');
        enterStep(0);
      },
      restart() {
        if (!navigationRef.isReady()) return;
        trackEvent('tour_started', { source: 'settings_relaunch' });
        setPhase('touring');
        enterStep(0);
      },
      next() {
        const nextIndex = stepIndex + 1;
        if (nextIndex >= TOUR_STEPS.length) return;
        if (TOUR_STEPS[nextIndex].key === 'outro') {
          setPhase('outro');
          setStepIndex(nextIndex);
          setPaused(false);
          return;
        }
        enterStep(nextIndex);
      },
      skip() {
        endTour('skipped');
      },
      finish() {
        endTour('completed');
      },
      resume() {
        enterStep(stepIndex);
      },
      trackInteraction(stepKey) {
        trackEvent('tour_step_interacted', { step_key: stepKey, interaction: 'tap' });
      },
      registerTarget,
      getTarget,
      registerPress,
      invokeStepPress,
    }),
    [consumeShouldOfferTour, enterStep, endTour, getTarget, invokeStepPress, navigationRef, paused, phase, registerPress, registerTarget, stepIndex],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside TourProvider');
  return ctx;
}

// Attach the returned ref to a real element so the overlay can measure it.
export function useTourTarget<T>(key: string) {
  const { registerTarget } = useTour();
  const ref = useRef<T>(null);
  useEffect(() => registerTarget(key, ref as RefObject<unknown>), [key, registerTarget]);
  return ref;
}

// Wraps a control's normal onPress. While its step is the active tour step,
// the normal handler runs only when safeInTour is set, and the tour advances.
export function useTourTargetPress(
  stepKey: TourStepKey,
  normalHandler: () => void,
  safeInTour = false,
) {
  const { phase, paused, currentStep, next, trackInteraction, registerPress } = useTour();
  const isActive = phase === 'touring' && !paused && currentStep?.key === stepKey;

  const press = useCallback(() => {
    if (!isActive) {
      normalHandler();
      return;
    }
    trackInteraction(stepKey);
    if (safeInTour) normalHandler();
    next();
  }, [isActive, next, normalHandler, safeInTour, stepKey, trackInteraction]);

  // The spotlight forwards taps to this handler, since touches don't pass
  // through the overlay to the control underneath.
  useEffect(() => {
    registerPress(stepKey, press);
  }, [press, registerPress, stepKey]);

  return press;
}
