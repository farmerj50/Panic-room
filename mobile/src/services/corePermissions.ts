import { Camera } from 'expo-camera';
import * as Location from 'expo-location';

import { trackEvent } from './analyticsService';
import {
  confirmCameraDisclosure,
  confirmMicrophoneDisclosure,
} from '../utils/permissionDisclosures';
import { confirmForegroundLocationDisclosure } from '../utils/locationDisclosure';

// Shared home for the three onboarding-time permission checks/requests, used
// by both the onboarding stack (PermissionStepScreen) and SetupScreen — one
// implementation instead of the near-duplicate logic that used to live
// separately in AuthScreen.tsx and SetupScreen.tsx. Each request function
// shows its in-app disclosure, calls the OS request, fires the matching
// analytics event, and returns the resulting status.

export type PermStatus = 'unknown' | 'granted' | 'denied';

function toStatus(granted: boolean | undefined): PermStatus {
  if (granted === undefined) return 'unknown';
  return granted ? 'granted' : 'denied';
}

export async function getCameraStatus(): Promise<PermStatus> {
  const result = await Camera.getCameraPermissionsAsync();
  return toStatus(result.granted);
}

export async function requestCameraPermission(): Promise<PermStatus> {
  if (!(await confirmCameraDisclosure())) {
    trackEvent('camera_permission_denied');
    return 'denied';
  }
  const result = await Camera.requestCameraPermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'camera_permission_granted' : 'camera_permission_denied');
  return status;
}

export async function getMicrophoneStatus(): Promise<PermStatus> {
  const result = await Camera.getMicrophonePermissionsAsync();
  return toStatus(result.granted);
}

export async function requestMicrophonePermission(): Promise<PermStatus> {
  if (!(await confirmMicrophoneDisclosure())) {
    trackEvent('microphone_permission_denied');
    return 'denied';
  }
  const result = await Camera.requestMicrophonePermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'microphone_permission_granted' : 'microphone_permission_denied');
  return status;
}

export async function getForegroundLocationStatus(): Promise<PermStatus> {
  const result = await Location.getForegroundPermissionsAsync();
  return toStatus(result.granted);
}

export async function requestForegroundLocationPermission(): Promise<PermStatus> {
  if (!(await confirmForegroundLocationDisclosure())) {
    trackEvent('location_permission_denied');
    return 'denied';
  }
  const result = await Location.requestForegroundPermissionsAsync();
  const status = toStatus(result.granted);
  trackEvent(status === 'granted' ? 'location_permission_granted' : 'location_permission_denied');
  return status;
}
