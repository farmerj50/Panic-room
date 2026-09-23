import AsyncStorage from '@react-native-async-storage/async-storage';

// A/B bucketing for the registration → onboarding-vs-contextual experiment.
// Deliberately tiny and single-purpose (not a general feature-flag
// framework) — there is exactly one experiment today. Mirrors
// nativeAnalytics.ts's getClientId() pattern: memoized promise, persisted
// in AsyncStorage, assigned once per install.

export type OnboardingVariant = 'onboarding' | 'contextual';

const VARIANT_KEY = 'bes_onboarding_variant';

let variantPromise: Promise<OnboardingVariant> | null = null;

// Creates and persists a bucket assignment if none exists yet. Call this
// ONLY from AuthContext.register() — every other call site must use
// getExistingOnboardingVariant() below, which never assigns. Calling this
// version from e.g. HomeScreen or EmergencyScreen would silently bucket a
// login-only user into the experiment, which must never happen.
export async function getOnboardingVariant(): Promise<OnboardingVariant> {
  if (!variantPromise) {
    variantPromise = (async () => {
      const existing = await AsyncStorage.getItem(VARIANT_KEY);
      if (existing === 'onboarding' || existing === 'contextual') return existing;
      const variant: OnboardingVariant = Math.random() < 0.5 ? 'onboarding' : 'contextual';
      await AsyncStorage.setItem(VARIANT_KEY, variant);
      return variant;
    })();
  }
  return variantPromise;
}

// Read-only lookup for every non-registration call site (HomeScreen,
// EmergencyScreen, analytics tagging, etc.) — returns null rather than
// assigning if this install was never bucketed (e.g. an existing user who
// only ever logged in). Never writes to AsyncStorage.
export async function getExistingOnboardingVariant(): Promise<OnboardingVariant | null> {
  const value = await AsyncStorage.getItem(VARIANT_KEY);
  return value === 'onboarding' || value === 'contextual' ? value : null;
}
