import { Camera } from 'expo-camera';
import * as Location from 'expo-location';

import { trackEvent } from './analyticsService';
import type { OnboardingVariant } from './experiments';
import {
  confirmCameraDisclosure,
  confirmMicrophoneDisclosure,
} from '../utils/permissionDisclosures';
import { confirmForegroundLocationDisclosure } from '../utils/locationDisclosure';

// Shared home for every camera/mic/location permission check + request in
// the app — the onboarding stack, SetupScreen, and every contextual
// (on-demand) call site all go through this one implementation instead of
// near-duplicate logic scattered across screens. Each request function
// shows its in-app disclosure, calls the OS request, fires the matching
// analytics event (including the explanation-viewed event, so this is the
// single source of truth for the whole permission-ask funnel), and returns
// the resulting status.

export type PermStatus = 'unknown' | 'granted' | 'denied';

export type RequestOpts = {
  // Where the ask originated (e.g. 'onboarding', 'emergency_activation',
  // 'covert_setup', 'setup_screen') — lets the funnel distinguish *why* a
  // permission was requested without inventing new event names.
  context?: string;
  // The A/B variant this install is bucketed into, if any. Onboarding call
  // sites pass the literal 'onboarding' (they're unreachable otherwise);
  // contextual call sites should read this via the read-only
  // getExistingOnboardingVariant() from services/experiments.ts.
  variant?: OnboardingVariant;
};

function toStatus(granted: boolean | undefined): PermStatus {
  if (granted === undefined) return 'unknown';
  return granted ? 'granted' : 'denied';
}

export async function getCameraStatus(): Promise<PermStatus> {
  const result = await Camera.getCameraPermissionsAsync();
  return toStatus(result.granted);
}

export async function requestCameraPermission(opts?: RequestOpts): Promise<PermStatus> {
  trackEvent('camera_permission_explanation_viewed', opts);
  if (!(await confirmCameraDisclosure())) {
    trackEvent('camera_permission_denied', opts);
    return 'denied';
  }
  const result = await Camera.requestCameraPermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'camera_permission_granted' : 'camera_permission_denied', opts);
  return status;
}

export async function getMicrophoneStatus(): Promise<PermStatus> {
  const result = await Camera.getMicrophonePermissionsAsync();
  return toStatus(result.granted);
}

export async function requestMicrophonePermission(opts?: RequestOpts): Promise<PermStatus> {
  trackEvent('microphone_permission_explanation_viewed', opts);
  if (!(await confirmMicrophoneDisclosure())) {
    trackEvent('microphone_permission_denied', opts);
    return 'denied';
  }
  const result = await Camera.requestMicrophonePermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'microphone_permission_granted' : 'microphone_permission_denied', opts);
  return status;
}

export async function getForegroundLocationStatus(): Promise<PermStatus> {
  const result = await Location.getForegroundPermissionsAsync();
  return toStatus(result.granted);
}

export async function requestForegroundLocationPermission(opts?: RequestOpts): Promise<PermStatus> {
  trackEvent('location_permission_explanation_viewed', opts);
  if (!(await confirmForegroundLocationDisclosure())) {
    trackEvent('location_permission_denied', opts);
    return 'denied';
  }
  const result = await Location.requestForegroundPermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'location_permission_granted' : 'location_permission_denied', opts);
  return status;
}
