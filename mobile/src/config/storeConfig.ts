// Overridable via EXPO_PUBLIC_GOOGLE_PLAY_URL so the destination can change
// without a code edit; falls back to the live Bes listing.
export const GOOGLE_PLAY_URL =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_URL ??
  'https://play.google.com/store/apps/details?id=com.ginslayer.besapp';
