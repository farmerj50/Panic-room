import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export type NativeCameraState = 'starting' | 'running' | 'waiting' | 'released' | 'preempted' | 'error';

export type CameraStateEvent = {
  state: NativeCameraState;
  sessionId: number;
  reason?: string;
  message?: string;
};

// Normalized (0..1) to the upright analysis frame.
export type NativeDetection = { x: number; y: number; width: number; height: number; score: number };

export type DetectionsEvent = {
  sessionId: number;
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
  inferenceMs: number;
  targetFps: number;
  // Max phone rotation speed (gyroscope, rad/s) since the previous result;
  // -1 when the phone has no gyroscope.
  rotationRate: number;
  detections: NativeDetection[];
};

export type BesVisionViewProps = ViewProps & {
  active: boolean;
  facing?: 'back' | 'front';
  analysisEnabled?: boolean;
  targetFps?: number;
  scoreThreshold?: number;
  // Validation only (adds latency to every inference).
  debugSlowInferenceMs?: number;
  onCameraState?: (event: NativeSyntheticEvent<CameraStateEvent>) => void;
  onDetections?: (event: NativeSyntheticEvent<DetectionsEvent>) => void;
};

type BesVisionNativeModule = {
  releaseCamera(): Promise<boolean>;
  listTestImages(): Promise<string[]>;
  detectImage(name: string, scoreThreshold?: number, sensorRotation?: number): Promise<Omit<DetectionsEvent, 'sessionId' | 'timestamp' | 'targetFps' | 'rotationRate'>>;
};

// Android only. Elsewhere the module is absent and the AI Monitor is hidden.
const nativeModule = requireOptionalNativeModule<BesVisionNativeModule>('BesVision');

export const isBesVisionAvailable = nativeModule != null;

export const BesVisionView: ComponentType<BesVisionViewProps> | null = isBesVisionAvailable
  ? requireNativeViewManager<BesVisionViewProps>('BesVision')
  : null;

// Stage-1 release of any monitor camera. Resolves true once CameraX reports
// the camera closed; true immediately when no monitor is running.
export function releaseMonitorCamera(): Promise<boolean> {
  return nativeModule ? nativeModule.releaseCamera() : Promise.resolve(true);
}

export function detectTestImage(name: string, scoreThreshold?: number, sensorRotation?: number) {
  if (!nativeModule) return Promise.reject(new Error('BesVision is not available on this platform'));
  return nativeModule.detectImage(name, scoreThreshold, sensorRotation);
}

export function listTestImages(): Promise<string[]> {
  return nativeModule ? nativeModule.listTestImages() : Promise.resolve([]);
}
