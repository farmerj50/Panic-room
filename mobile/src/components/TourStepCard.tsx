import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTour } from '../context/TourContext';

// Renders the current tour step card inline, for steps that need it inside a
// screen rather than the global overlay.
export default function TourStepCard() {
  const { currentStep, stepIndex, stepCount, next, skip } = useTour();
  if (!currentStep) return null;

  return (
    <View style={styles.card} testID="tour-inline-card">
      <Text style={styles.step}>{`${stepIndex + 1} of ${stepCount}`}</Text>
      <Text style={styles.title}>{currentStep.title}</Text>
      <Text style={styles.body}>{currentStep.body}</Text>
      <TouchableOpacity activeOpacity={0.85} style={styles.primaryBtn} onPress={next} testID="tour-next-btn" accessibilityRole="button">
        <Text style={styles.primaryText}>Next</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.7} style={styles.secondaryBtn} onPress={skip} testID="tour-skip-mid-btn" accessibilityRole="button">
        <Text style={styles.secondaryText}>Skip tour</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(199,140,255,0.4)',
    padding: 20,
    shadowColor: '#7c3aed',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  step: { color: '#9e8fc2', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', marginBottom: 8 },
  body: { color: '#d8d2e8', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  primaryBtn: { alignItems: 'center', backgroundColor: '#7c3aed', borderRadius: 14, paddingVertical: 13 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 8 },
  secondaryText: { color: '#b9adda', fontSize: 14, fontWeight: '600' },
});
