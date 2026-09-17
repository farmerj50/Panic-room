import { Platform } from 'react-native';

import { GA4_MEASUREMENT_ID } from '../config/analyticsConfig';
import { trackNativeEvent } from './nativeAnalytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

// Loads gtag.js and initializes GA4 for the web build only (bes-app.com).
// No custom web/index.html template exists in this project (expo export -p
// web generates dist/index.html purely as build output), so this injects
// the script at runtime instead of via a static template. No-ops on native
// (no window/document there) and no-ops until a Measurement ID is
// configured, mirroring configurePurchases()'s pattern in purchasesService.ts.
export function configureAnalytics() {
  if (Platform.OS !== 'web' || initialized || !GA4_MEASUREMENT_ID) return;
  initialized = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  const gtag = (...args: unknown[]) => window.dataLayer!.push(args);
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA4_MEASUREMENT_ID);
}

// Fires a GA4 event: gtag.js on web (safe no-op if configureAnalytics()
// never ran, i.e. no Measurement ID set yet — window.gtag simply won't
// exist), GA4 Measurement Protocol on native (see nativeAnalytics.ts). One
// entry point for all call sites regardless of platform.
export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params);
    return;
  }

  void trackNativeEvent(eventName, params);
}
