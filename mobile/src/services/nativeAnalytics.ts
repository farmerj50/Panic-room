import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { GA4_API_SECRET, GA4_MEASUREMENT_ID } from '../config/analyticsConfig';

// GA4 Measurement Protocol client for native (Android/iOS) builds, where
// gtag.js (the web SDK analyticsService.ts wraps) doesn't exist. Sends
// events via plain `fetch` to the same GA4 property already configured for
// the web build, so native + web funnel data land in one place. No new
// native SDK dependency required.
//
// This is a fire-and-forget, best-effort client: analytics must never crash
// or block the caller, and a dropped event here isn't worth surfacing to
// the user or retrying — network failures are simply swallowed.

const COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
const CLIENT_ID_KEY = 'bes_ga4_client_id';

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

export async function trackNativeEvent(eventName: string, params?: Record<string, unknown>) {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) return;

  try {
    const client_id = await getClientId();
    await fetch(`${COLLECT_URL}?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`, {
      method: 'POST',
      body: JSON.stringify({
        client_id,
        events: [{ name: eventName, params: params ?? {} }],
      }),
    });
  } catch {
    // Swallow network errors — analytics must never crash or block the caller.
  }
}
