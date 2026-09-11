// RevenueCat's Android public SDK key — safe to ship client-side per
// RevenueCat's own docs (it is not a secret; entitlement writes are
// authenticated separately via the server-side webhook secret, not this key).
export const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '';

// Must match the entitlement identifier created in the RevenueCat dashboard.
export const PREMIUM_ENTITLEMENT_ID = 'premium';

// Must match the subscription product created in Play Console.
export const PREMIUM_PRODUCT_ID = 'bes_premium_monthly';

// Must match app.json's android.package / the app's applicationId.
export const ANDROID_PACKAGE_NAME = 'com.ginslayer.besapp';
