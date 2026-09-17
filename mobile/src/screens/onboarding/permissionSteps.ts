import {
  requestCameraPermission,
  requestForegroundLocationPermission,
  requestMicrophonePermission,
  type PermStatus,
} from '../../services/corePermissions';

export type PermissionStepConfig = {
  key: 'camera' | 'microphone' | 'location';
  icon: string;
  accentColor: string;
  title: string;
  body: string;
  ctaLabel: string;
  request: () => Promise<PermStatus>;
  explanationViewedEvent: string;
};

export const CAMERA_STEP: PermissionStepConfig = {
  key: 'camera',
  icon: 'C',
  accentColor: '#4aa8ff',
  title: 'Camera Access',
  body:
    "Bes uses your camera to automatically record video evidence the moment you activate an emergency, " +
    "so there's a record of what happened. Bes never records video in the background — only when you " +
    'start an emergency.',
  ctaLabel: 'Allow Camera Access',
  request: requestCameraPermission,
  explanationViewedEvent: 'camera_permission_explanation_viewed',
};

export const MICROPHONE_STEP: PermissionStepConfig = {
  key: 'microphone',
  icon: 'M',
  accentColor: '#b777ff',
  title: 'Microphone Access',
  body:
    'Bes uses your microphone to automatically record audio alongside video when you activate an ' +
    'emergency. Recording only starts when you activate an emergency — never in the background.',
  ctaLabel: 'Allow Microphone Access',
  request: requestMicrophonePermission,
  explanationViewedEvent: 'microphone_permission_explanation_viewed',
};

export const LOCATION_STEP: PermissionStepConfig = {
  key: 'location',
  icon: 'L',
  accentColor: '#ff6b9a',
  title: 'Location Access',
  body:
    'Bes uses your precise location only when you activate an emergency, to share your live location ' +
    'with your trusted contacts (and 911, if enabled). This is separate from Background Location ' +
    'Monitoring (Bes Pro), which — if you turn it on later — tracks your location continuously, even ' +
    'when the app is closed. Your location is never used for advertising.',
  ctaLabel: 'Allow Location Access',
  request: requestForegroundLocationPermission,
  explanationViewedEvent: 'location_permission_explanation_viewed',
};
