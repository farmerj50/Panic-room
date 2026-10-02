import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

import type { RootStackParamList } from '../navigation/types';
import { useAuth } from './AuthContext';
import { trackEvent } from '../services/analyticsService';
import { reportTourStatus } from '../services/tourService';

type TourPhase = 'idle' | 'prompt' | 'touring' | 'outro';

type TourStep = {
  key: string;
  title: string;
  body: string;
  navigate: (nav: NavigationContainerRefWithCurrent<RootStackParamList>) => void;
};

const TOUR_STEPS: TourStep[] = [
  {
    key: 'home',
    title: 'This is Bes',
    body: 'Your safety tools live right here — we’ll show you where.',
    navigate: (nav) => nav.navigate('Main', { screen: 'Home' }),
  },
  {
    key: 'emergency',
    title: 'Emergency',
    body: 'Tap "I Need Help Now" to start an emergency. Bes can begin evidence capture, location sharing, and trusted-contact alerts. Calling 911 still requires a manual tap.',
    navigate: (nav) => nav.navigate('Main', { screen: 'Home' }),
  },
  {
    key: 'contacts',
    title: 'Trusted Contacts',
    body: 'This is who gets alerted when you activate an emergency.',
    navigate: (nav) => nav.navigate('Contacts'),
  },
  {
    key: 'messages',
    title: 'Messages',
    body: 'Covert Messaging lets you hide a safety message inside an ordinary one. 🔒 Bes Pro',
    navigate: (nav) => nav.navigate('Main', { screen: 'Messages' }),
  },
  {
    key: 'profile',
    title: 'Profile',
    body: 'Check your permissions and account settings here anytime.',
    navigate: (nav) => nav.navigate('Main', { screen: 'Profile' }),
  },
];

type TourContextType = {
  phase: TourPhase;
  stepIndex: number;
  stepCount: number;
  currentStep: TourStep | null;
  maybeOffer: () => void;
  startTour: () => void;
  next: () => void;
  skip: () => void;
  finish: () => void;
  restart: () => void;
};

const TourContext = createContext<TourContextType | null>(null);

export function TourProvider({
  navigationRef,
  children,
}: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
  children: ReactNode;
}) {
  const { consumeShouldOfferTour } = useAuth();
  const [phase, setPhase] = useState<TourPhase>('idle');
  const [stepIndex, setStepIndex] = useState(0);

  const value = useMemo<TourContextType>(
    () => ({
      phase,
      stepIndex,
      stepCount: TOUR_STEPS.length,
      currentStep: phase === 'touring' ? TOUR_STEPS[stepIndex] : null,
      maybeOffer() {
        if (consumeShouldOfferTour()) setPhase('prompt');
      },
      startTour() {
        if (!navigationRef.isReady()) return;
        trackEvent('tour_started');
        TOUR_STEPS[0].navigate(navigationRef);
        setStepIndex(0);
        setPhase('touring');
      },
      next() {
        if (!navigationRef.isReady()) return;
        const nextIndex = stepIndex + 1;
        if (nextIndex >= TOUR_STEPS.length) {
          setPhase('outro');
          return;
        }
        TOUR_STEPS[nextIndex].navigate(navigationRef);
        setStepIndex(nextIndex);
      },
      skip() {
        trackEvent('tour_skipped', { step: stepIndex });
        reportTourStatus('skipped').catch(() => {});
        setPhase('idle');
      },
      finish() {
        trackEvent('tour_completed', { steps: TOUR_STEPS.length });
        reportTourStatus('completed').catch(() => {});
        setPhase('idle');
      },
      restart() {
        if (!navigationRef.isReady()) return;
        trackEvent('tour_started', { source: 'profile_relaunch' });
        TOUR_STEPS[0].navigate(navigationRef);
        setStepIndex(0);
        setPhase('touring');
      },
    }),
    [consumeShouldOfferTour, navigationRef, phase, stepIndex],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside TourProvider');
  return ctx;
}
