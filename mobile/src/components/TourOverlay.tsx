import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTour } from '../context/TourContext';

export default function TourOverlay() {
  const { phase, stepIndex, stepCount, currentStep, startTour, next, skip, finish } = useTour();

  if (phase === 'idle') return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {phase === 'prompt' && (
            <>
              <Text style={styles.title}>Welcome to Bes</Text>
              <Text style={styles.body}>
                Take a 30-second tour so you know where to find the tools you may need in an
                emergency.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={startTour} testID="tour-take-btn">
                <Text style={styles.primaryText}>Take the Tour</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={skip} testID="tour-skip-btn">
                <Text style={styles.secondaryText}>Skip for Now</Text>
              </TouchableOpacity>
            </>
          )}

          {phase === 'touring' && currentStep && (
            <>
              <Text style={styles.step}>
                {stepIndex + 1} of {stepCount}
              </Text>
              <Text style={styles.title}>{currentStep.title}</Text>
              <Text style={styles.body}>{currentStep.body}</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={next} testID="tour-next-btn">
                <Text style={styles.primaryText}>Next</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => skip()} testID="tour-skip-mid-btn">
                <Text style={styles.secondaryText}>Skip tour</Text>
              </TouchableOpacity>
            </>
          )}

          {phase === 'outro' && (
            <>
              <Text style={styles.title}>You're ready.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={finish} testID="tour-done-btn">
                <Text style={styles.primaryText}>Done</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(199,140,255,0.4)',
    margin: 20,
    marginBottom: 40,
    padding: 24,
  },
  step: {
    color: '#9e8fc2',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: '#d8d2e8',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  primaryBtn: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 10,
  },
  secondaryText: {
    color: '#b9adda',
    fontSize: 14,
    fontWeight: '600',
  },
});
