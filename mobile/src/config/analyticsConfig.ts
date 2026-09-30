// Set EXPO_PUBLIC_GA4_MEASUREMENT_ID once a GA4 property + Measurement ID
// exist for bes-app.com. Expo inlines EXPO_PUBLIC_* vars at `expo export`
// build time (see mobile/src/config/emergencyConfig.ts for the same
// pattern), so setting this in Railway requires a redeploy of the web
// build to take effect — it is not read at runtime server-side.
//
// Used only by the web gtag.js path (analyticsService.ts's
// configureAnalytics()) — a GA4 Measurement ID is meant to be public, every
// website ships it in plain HTML. Native builds proxy events through the
// Bes backend instead (see nativeAnalytics.ts) and never need this value;
// the real secret (GA4_API_SECRET) lives server-side only, never as an
// EXPO_PUBLIC_* var, since those are bundled into the client and
// extractable from the APK/AAB.
export const GA4_MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '';
