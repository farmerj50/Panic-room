// Set EXPO_PUBLIC_GA4_MEASUREMENT_ID once a GA4 property + Measurement ID
// exist for bes-app.com. Expo inlines EXPO_PUBLIC_* vars at `expo export`
// build time (see mobile/src/config/emergencyConfig.ts for the same
// pattern), so setting this in Railway requires a redeploy of the web
// build to take effect — it is not read at runtime server-side.
export const GA4_MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '';
