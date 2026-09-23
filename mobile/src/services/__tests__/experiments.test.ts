// getOnboardingVariant() memoizes its assignment in a module-level promise,
// so each test needs a fresh module instance to test assignment from
// scratch. jest.resetModules() gives a fresh registry — critically, that
// means AsyncStorage must also be re-required from that same fresh
// registry in every test (not imported once at file scope), otherwise the
// test's AsyncStorage reference and experiments.ts's internal one are two
// different module instances with two different in-memory stores.
function freshModules() {
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const experiments = require('../experiments');
  return { AsyncStorage, experiments };
}

describe('experiments', () => {
  test('getOnboardingVariant assigns and persists a value when none exists', async () => {
    const { AsyncStorage, experiments } = freshModules();

    const variant = await experiments.getOnboardingVariant();

    expect(['onboarding', 'contextual']).toContain(variant);
    expect(await AsyncStorage.getItem('bes_onboarding_variant')).toBe(variant);
  });

  test('getOnboardingVariant returns the same value on repeated calls without a second setItem', async () => {
    const { AsyncStorage, experiments } = freshModules();
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    const first = await experiments.getOnboardingVariant();
    setItemSpy.mockClear();
    const second = await experiments.getOnboardingVariant();

    expect(second).toBe(first);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  test('getOnboardingVariant returns an already-persisted value without reassigning', async () => {
    const { AsyncStorage, experiments } = freshModules();
    await AsyncStorage.setItem('bes_onboarding_variant', 'contextual');
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    const variant = await experiments.getOnboardingVariant();

    expect(variant).toBe('contextual');
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  // The critical regression test this file exists to lock in: a read-only
  // lookup must never assign a bucket. Calling it for a login-only user who
  // was never registered on this install must not create a fresh
  // assignment — this is exactly the bug caught in plan review before
  // implementation, where HomeScreen/EmergencyScreen tagging call sites
  // would otherwise have silently bucketed existing users.
  test('getExistingOnboardingVariant returns null and never assigns when no value is persisted', async () => {
    const { AsyncStorage, experiments } = freshModules();
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    const variant = await experiments.getExistingOnboardingVariant();

    expect(variant).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('bes_onboarding_variant')).toBeNull();
  });

  test('getExistingOnboardingVariant returns an already-persisted value correctly', async () => {
    const { AsyncStorage, experiments } = freshModules();
    await AsyncStorage.setItem('bes_onboarding_variant', 'onboarding');

    const variant = await experiments.getExistingOnboardingVariant();

    expect(variant).toBe('onboarding');
  });

  test('getExistingOnboardingVariant reflects a value assigned earlier by getOnboardingVariant', async () => {
    const { experiments } = freshModules();

    const assigned = await experiments.getOnboardingVariant();
    const existing = await experiments.getExistingOnboardingVariant();

    expect(existing).toBe(assigned);
  });
});
