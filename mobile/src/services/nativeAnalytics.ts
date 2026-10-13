import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { API_URL } from '../config/emergencyConfig';

// Analytics client for native (Android/iOS) builds, where gtag.js (the web
// SDK analyticsService.ts wraps) doesn't exist. Events are proxied through
// the Bes backend (POST /api/analytics/event), which holds the real GA4
// Measurement Protocol API secret and forwards to GA4 on our behalf — the
// secret never ships inside the app. (An earlier version of this file sent
// events directly to GA4 with the secret baked in via an EXPO_PUBLIC_* env
// var; that's exactly the kind of thing EXPO_PUBLIC_ vars shouldn't hold,
// since they're bundled into the client and extractable from the APK/AAB.)
//
// This is a fire-and-forget, best-effort client: analytics must never crash
// or block the caller, and a dropped event here isn't worth surfacing to
// the user or retrying — network failures are simply swallowed.

const CLIENT_ID_KEY = 'bes_ga4_client_id';

// GA4 only counts Measurement Protocol events toward users, sessions and
// Realtime when they carry a session_id and engagement_time_msec — without
// them events are accepted but barely show up. One session per app launch.
const SESSION_ID = String(Math.floor(Date.now() / 1000));
// Test builds can set EXPO_PUBLIC_GA4_DEBUG=1 so events appear in GA4
// DebugView. Never set for store builds.
const DEBUG_MODE = process.env.EXPO_PUBLIC_GA4_DEBUG === '1';

let clientIdPromise: Promise<string> | null = null;

async function getClientId(): Promise<string> {
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const id = Crypto.randomUUID();
      await AsyncStorage.setItem(CLIENT_ID_KEY, id);
      return id;
    })();
  }
  return clientIdPromise;
}

// Public — AuthContext needs this once at registration to associate the
// anonymous ID with the new account server-side (see authService.ts's
// registerRequest), so server-fired events like subscription_completed
// land in the same GA4 funnel as this install's client-side events.
export async function getGA4ClientId(): Promise<string> {
  return getClientId();
}

export async function trackNativeEvent(eventName: string, params?: Record<string, unknown>) {
  try {
    const clientId = await getClientId();
    await fetch(`${API_URL}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        eventName,
        params: {
          session_id: SESSION_ID,
          engagement_time_msec: 100,
          ...(DEBUG_MODE ? { debug_mode: 1 } : {}),
          ...(params ?? {}),
        },
      }),
    });
  } catch {
    // Swallow network errors — analytics must never crash or block the caller.
  }
}
