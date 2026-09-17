import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = {
  icon?: string;
  iconColor?: string;
  title: string;
  body: string;
  footnote?: string;
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryTestID: string;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  secondaryTestID?: string;
  children?: ReactNode;
};

// Shared layout for every onboarding screen (Welcome, each permission step,
// Complete) — on a phone-width viewport the content sits centered with the
// primary action anchored near the bottom (thumb-reachable, full width,
// matching the rest of the app's mobile screens); on a wide/desktop web
// viewport everything — icon, copy, and actions — sits together inside one
// ~560px card, centered both ways, so a normal button doesn't stretch
// across a whole monitor and the screen doesn't read as unfinished.
export default function OnboardingCard({
  icon,
  iconColor = '#7c3aed',
  title,
  body,
  footnote,
  primaryLabel,
  onPrimaryPress,
  primaryTestID,
  primaryDisabled,
  secondaryLabel,
  onSecondaryPress,
  secondaryTestID,
  children,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 820;

  const iconEl = icon ? (
    <View style={[styles.iconCircle, { backgroundColor: `${iconColor}24`, borderColor: `${iconColor}55` }]}>
      <Text style={[styles.iconText, { color: iconColor }]}>{icon}</Text>
    </View>
  ) : null;

  const actionsEl = (
    <View style={[styles.actions, isWide ? styles.actionsWide : styles.actionsNarrow]}>
      <TouchableOpacity
        activeOpacity={0.86}
        disabled={primaryDisabled}
        onPress={onPrimaryPress}
        style={[styles.ctaButton, { backgroundColor: iconColor }, primaryDisabled && styles.ctaButtonDisabled]}
        testID={primaryTestID}
        accessibilityLabel={primaryTestID}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>{primaryLabel}</Text>
      </TouchableOpacity>
      {secondaryLabel && (
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={primaryDisabled}
          onPress={onSecondaryPress}
          style={styles.skipButton}
          testID={secondaryTestID}
          accessibilityLabel={secondaryTestID}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      )}
      {footnote && <Text style={styles.footnote}>{footnote}</Text>}
    </View>
  );

  if (isWide) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.wideOuter}>
          <View style={styles.card}>
            {iconEl}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            {children}
            {actionsEl}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.narrowContent}>
        {iconEl}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {children}
      </View>
      {actionsEl}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  narrowContent: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  wideOuter: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  card: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 40, 0.94)',
    borderColor: 'rgba(199,140,255,0.26)',
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 560,
    padding: 40,
    width: '100%',
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 44,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    marginBottom: 28,
    width: 88,
  },
  iconText: { fontSize: 34, fontWeight: '900' },
  title: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
  body: { color: '#cfc8dd', fontSize: 15, lineHeight: 23, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 12 },
  actionsNarrow: { paddingBottom: 24, paddingHorizontal: 24, paddingTop: 24 },
  actionsWide: { paddingTop: 24 },
  ctaButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaButtonDisabled: { opacity: 0.62 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  skipButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  skipText: { color: '#918aaa', fontSize: 13, fontWeight: '800' },
  footnote: { color: '#8b84aa', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
