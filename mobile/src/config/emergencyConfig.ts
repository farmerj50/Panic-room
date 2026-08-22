import { Platform } from 'react-native';

// Set EXPO_PUBLIC_API_URL for deployed builds or physical-device testing.
// Use ?? rather than || so an explicit empty string (same-origin relative
// requests, e.g. the web build served by the API itself) isn't treated as
// unset and overridden by the local-dev fallback.
//
// The native fallback must be the production HTTPS backend, not a personal
// dev-machine LAN IP: any release build where EXPO_PUBLIC_API_URL wasn't set
// at bundle time (Gradle inlines it, doesn't read it at runtime) otherwise
// falls back to plain HTTP to a private address, which Android 9+'s default
// network security policy refuses to call at all (CLEARTEXT communication
// ... not permitted) — this is exactly what blocked an external QA pass.
//
// Must be the backend API's own Railway domain, not bes-app.com/www.bes-app.com:
// that custom domain is attached to the separate "panic room front end" Railway
// service (the static Expo web export), which has no /api routes and answers
// every path — including /api/auth/login — with its SPA index.html. The actual
// backend service ("Panic-room", wired to Postgres) only has its Railway-issued
// domain; no custom domain is attached to it.
const PRODUCTION_API_URL = 'https://panic-room-production.up.railway.app';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'web' ? 'http://localhost:5000' : PRODUCTION_API_URL);

export const EMERGENCY_NUMBER = '911';
export const COUNTDOWN_SECONDS = 5;

// Set to true only when ready for production testing.
// Keeps the 911 dialer disabled during development so accidental activations
// don't place real emergency calls.
export const ENABLE_EMERGENCY_DIALER = false;
