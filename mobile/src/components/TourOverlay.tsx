import { ReactNode, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTour } from '../context/TourContext';

type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

const CARD_MAX_WIDTH = 420;
const GAP = 16;
const MEASURE_ATTEMPTS = 6;
const MEASURE_DELAY_MS = 150;

export default function TourOverlay() {
  const tour = useTour();
  const { phase, paused, currentStep, stepIndex, stepCount } = tour;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);
  const [measureFailed, setMeasureFailed] = useState(false);
  const rootRef = useRef<View>(null);

  const targetKey = currentStep?.targetKey ?? null;
  const spotlightActive = phase === 'touring' && !paused && targetKey !== null;

  useEffect(() => {
    if (!spotlightActive || !targetKey) {
      setRect(null);
      setMeasureFailed(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;

    const tryMeasure = () => {
      const node: any = tour.getTarget(targetKey)?.current;
      if (node?.measureInWindow && rootRef.current) {
        // measureInWindow is relative to the window, but the overlay starts at
        // the screen origin, so subtract the overlay's own window offset.
        rootRef.current.measureInWindow((rx: number, ry: number) => {
          node.measureInWindow((x: number, y: number, width: number, height: number) => {
            if (cancelled) return;
            if (width > 0 && height > 0) {
              setRect({ x: x - rx, y: y - ry, width, height });
              setMeasureFailed(false);
            } else {
              retry();
            }
          });
        });
      } else {
        retry();
      }
    };

    const retry = () => {
      attempts += 1;
      if (attempts >= MEASURE_ATTEMPTS) {
        if (!cancelled) {
          setRect(null);
          setMeasureFailed(true);
        }
        return;
      }
      setTimeout(() => {
        if (!cancelled) tryMeasure();
      }, MEASURE_DELAY_MS);
    };

    tryMeasure();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlightActive, targetKey, screenW, screenH, stepIndex]);

  useEffect(() => {
    if (phase === 'idle') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'outro') {
        tour.finish();
      } else {
        tour.skip();
      }
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Steps shown inline by their screen (see TourStepCard) skip the overlay.
  if (phase === 'idle' || (phase === 'touring' && currentStep?.key === 'contacts-form')) return null;

  // Touches don't pass through the overlay to the control underneath, so the
  // spotlight hole forwards the tap to the step's press handler. Only the
  // name field focuses directly, since host views also expose focus().
  function onHolePress() {
    if (!currentStep) return;
    const node: any = targetKey ? tour.getTarget(targetKey)?.current : null;
    if (currentStep.key === 'contacts-form' && typeof node?.focus === 'function') {
      node.focus();
      return;
    }
    tour.invokeStepPress(currentStep.key);
  }

  // Prompt and outro are decisions, not walkthrough steps, so they block the screen.
  if (phase === 'prompt' || phase === 'outro' || (phase === 'touring' && paused)) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.blockingScrim]} pointerEvents="auto">
        <View style={styles.bottomCardWrap}>
          <TourCard>{renderCardBody()}</TourCard>
        </View>
      </View>
    );
  }

  function renderCardBody() {
    if (phase === 'prompt') {
      return (
        <>
          <Text style={styles.title}>Welcome to Bes</Text>
          <Text style={styles.body}>Take a 30-second tour so you know where to find the tools you may need in an emergency.</Text>
          <PrimaryButton label="Take the Tour" onPress={tour.startTour} testID="tour-take-btn" />
          <SecondaryButton label="Skip for Now" onPress={tour.skip} testID="tour-skip-btn" />
        </>
      );
    }
    if (phase === 'outro') {
      return (
        <>
          <Text style={styles.title}>You’re ready.</Text>
          <Text style={styles.body}>Bes is set up and ready to protect you.</Text>
          <PrimaryButton label="Done" onPress={tour.finish} testID="tour-done-btn" />
        </>
      );
    }
    if (paused) {
      return (
        <>
          <Text style={styles.step}>Tour paused</Text>
          <Text style={styles.body}>You left the walkthrough. Resume to continue from here.</Text>
          <PrimaryButton label="Resume tour" onPress={tour.resume} testID="tour-resume-btn" />
          <SecondaryButton label="End tour" onPress={tour.skip} testID="tour-end-btn" />
        </>
      );
    }
    return (
      <>
        <Text style={styles.step}>{`${stepIndex + 1} of ${stepCount}`}</Text>
        <Text style={styles.title}>{currentStep?.title}</Text>
        <Text style={styles.body}>{currentStep?.body}</Text>
        {measureFailed && (
          <Text style={styles.note}>This part of the screen isn’t visible right now.</Text>
        )}
        <PrimaryButton label="Next" onPress={tour.next} testID="tour-next-btn" />
        <SecondaryButton label="Skip tour" onPress={tour.skip} testID="tour-skip-mid-btn" />
      </>
    );
  }

  // Spotlight path: the four dim rectangles surround the target, which has no
  // view of its own, so the real control stays tappable.
  if (spotlightActive && rect) {
    const cardWidth = Math.min(CARD_MAX_WIDTH, screenW - 32);
    const cardLeft = Math.min(
      Math.max(rect.x + rect.width / 2 - cardWidth / 2, insets.left + 16),
      screenW - insets.right - cardWidth - 16,
    );
    // Anchored by top or bottom, so the card's height never has to be measured.
    const placeBelow = rect.y + rect.height / 2 < screenH / 2;
    const verticalPos = placeBelow
      ? { top: rect.y + rect.height + GAP }
      : { bottom: screenH - rect.y + GAP };
    return (
      <View ref={rootRef} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={[styles.dim, { top: 0, left: 0, width: screenW, height: rect.y }]} pointerEvents="auto" />
        <View
          style={[styles.dim, { top: rect.y + rect.height, left: 0, width: screenW, height: Math.max(0, screenH - rect.y - rect.height) }]}
          pointerEvents="auto"
        />
        <View style={[styles.dim, { top: rect.y, left: 0, width: rect.x, height: rect.height }]} pointerEvents="auto" />
        <View
          style={[styles.dim, { top: rect.y, left: rect.x + rect.width, width: Math.max(0, screenW - rect.x - rect.width), height: rect.height }]}
          pointerEvents="auto"
        />
        <Pressable
          style={[styles.hole, { top: rect.y, left: rect.x, width: rect.width, height: rect.height }]}
          onPress={onHolePress}
          accessibilityRole="button"
        />
        <View
          style={[styles.ring, { top: rect.y - 2, left: rect.x - 2, width: rect.width + 4, height: rect.height + 4 }]}
          pointerEvents="none"
        />
        <View
          style={[styles.floating, verticalPos, { left: cardLeft, width: cardWidth }]}
          pointerEvents="auto"
        >
          <TourCard>{renderCardBody()}</TourCard>
        </View>
      </View>
    );
  }

  // No measurable target: non-blocking bottom card with Next, so the tour never hangs.
  return (
    <View ref={rootRef} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        style={[styles.floating, { top: screenH * 0.4, left: Math.max(16, (screenW - CARD_MAX_WIDTH) / 2), width: Math.min(CARD_MAX_WIDTH, screenW - 32) }]}
        pointerEvents="auto"
      >
        <TourCard>{renderCardBody()}</TourCard>
      </View>
    </View>
  );
}

function TourCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function PrimaryButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.primaryBtn} onPress={onPress} testID={testID} accessibilityRole="button">
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.secondaryBtn} onPress={onPress} testID={testID} accessibilityRole="button">
      <Text style={styles.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  blockingScrim: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
    elevation: 100,
    zIndex: 1000,
  },
  bottomFallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    elevation: 100,
    zIndex: 1000,
  },
  bottomCardWrap: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.78)',
    elevation: 100,
    zIndex: 1000,
  },
  hole: {
    position: 'absolute',
    backgroundColor: 'transparent',
    elevation: 101,
    zIndex: 1001,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#c78cff',
    borderRadius: 14,
    elevation: 101,
    zIndex: 1001,
  },
  floating: {
    position: 'absolute',
    elevation: 102,
    zIndex: 1002,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(199,140,255,0.4)',
    padding: 20,
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    shadowColor: '#7c3aed',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  step: {
    color: '#9e8fc2',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', marginBottom: 8 },
  body: { color: '#d8d2e8', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  note: { color: '#9e8fc2', fontSize: 12, marginBottom: 12 },
  primaryBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 13,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 8 },
  secondaryText: { color: '#b9adda', fontSize: 14, fontWeight: '600' },
});
