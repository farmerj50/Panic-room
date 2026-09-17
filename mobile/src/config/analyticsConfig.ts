// Set EXPO_PUBLIC_GA4_MEASUREMENT_ID once a GA4 property + Measurement ID
// exist for bes-app.com. Expo inlines EXPO_PUBLIC_* vars at `expo export`
// build time (see mobile/src/config/emergencyConfig.ts for the same
// pattern), so setting this in Railway requires a redeploy of the web
// build to take effect — it is not read at runtime server-side.
export const GA4_MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '';

// Used only by nativeAnalytics.ts (GA4 Measurement Protocol) — native builds
// have no backend proxy for this, so the secret ships inside the public
// APK/bundle same as GA4_MEASUREMENT_ID. That's an accepted tradeoff: GA4
// Measurement Protocol API secrets are rate-limit/routing tokens, not
// authentication credentials, per Google's own docs — not a real secret
// needing rotation-on-leak handling.
export const GA4_API_SECRET = process.env.EXPO_PUBLIC_GA4_API_SECRET ?? '';
