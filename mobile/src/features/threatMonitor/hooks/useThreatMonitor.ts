import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { useEmergencyContext } from '../../../context/EmergencyContext';
import { trackEvent } from '../../../services/analyticsService';
import { MONITOR_CONFIG } from '../config/threatMonitorConfig';
import { acquireForMonitor, onEmergencyClaim, releaseForMonitor } from '../services/CameraOwnershipService';
import type { MonitorFrame } from '../models/types';
import { computeCrowdMetrics } from '../services/CrowdMetricsService';
import { PersonTracker } from '../services/PersonTrackingService';
import { THREAT_DETECTORS } from '../threat/detectors';
import { ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';
import type { ThreatAssessment } from '../threat/types';
import type { CameraStateEvent, DetectionsEvent } from '../services/besVision';

export type MonitorStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error';
export type StopReason = 'user' | 'blur' | 'background' | 'emergency' | 'released' | 'error';

// AI Monitor session state. The camera is on only while the screen is
// focused, the app is in the foreground and no Emergency is active — any of
// those changing stops it, as does Emergency claiming the camera.
export function useThreatMonitor() {
  const isFocused = useIsFocused();
  const { isEmergency } = useEmergencyContext();
  const [status, setStatus] = useState<MonitorStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [frame, setFrame] = useState<MonitorFrame | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);

  const activeRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const framesRef = useRef(0);
  const trackerRef = useRef(new PersonTracker());
  const engineRef = useRef(new ThreatAssessmentEngine(THREAT_DETECTORS));
  const [assessment, setAssessment] = useState<ThreatAssessment | null>(null);

  const stop = useCallback((reason: StopReason = 'user') => {
    if (!activeRef.current) return;
    activeRef.current = false;
    sessionIdRef.current = null;
    setActive(false);
    releaseForMonitor();
    setFrame(null);
    trackerRef.current.reset();
    engineRef.current.reset();
    setAssessment(null);
    if (reason !== 'error') {
      setStatus('idle');
      setMessage(reason === 'emergency' ? 'Stopped — Emergency is using the camera.' : null);
    }
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    trackEvent('ai_monitor_stopped', {
      reason,
      durationSec,
      avgFps: durationSec > 0 ? Math.round((framesRef.current / durationSec) * 10) / 10 : 0,
    });
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    if (!acquireForMonitor({ isEmergency })) {
      setStatus('idle');
      setMessage('Emergency is using the camera.');
      return;
    }
    activeRef.current = true;
    startedAtRef.current = Date.now();
    framesRef.current = 0;
    trackerRef.current.reset();
    engineRef.current.reset();
    setMessage(null);
    setStatus('starting');
    setActive(true);
    trackEvent('ai_monitor_started');
  }, [isEmergency]);

  const pause = useCallback(() => {
    if (activeRef.current) setStatus((s) => (s === 'running' ? 'paused' : s));
  }, []);

  const resume = useCallback(() => {
    if (activeRef.current) setStatus((s) => (s === 'paused' ? 'running' : s));
  }, []);

  // Emergency always wins.
  useEffect(() => onEmergencyClaim(() => stop('emergency')), [stop]);
  useEffect(() => {
    if (isEmergency) stop('emergency');
  }, [isEmergency, stop]);
  useEffect(() => {
    if (!isFocused) stop('blur');
  }, [isFocused, stop]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop('background');
    });
    return () => sub.remove();
  }, [stop]);
  // Unmount.
  useEffect(() => () => stop('blur'), [stop]);

  const onCameraState = useCallback(
    (event: NativeSyntheticEvent<CameraStateEvent>) => {
      const e = event.nativeEvent;
      if (!activeRef.current) return;
      switch (e.state) {
        case 'starting':
          sessionIdRef.current = e.sessionId;
          break;
        case 'running':
          setStatus((s) => (s === 'starting' ? 'running' : s));
          break;
        case 'waiting':
          setMessage(e.message ?? 'Waiting for the camera.');
          break;
        case 'released':
        case 'preempted':
          stop(e.reason === 'emergency' || e.state === 'preempted' ? 'emergency' : 'released');
          break;
        case 'error':
          setStatus('error');
          setMessage(e.message ?? 'The camera stopped unexpectedly.');
          stop('error');
          break;
      }
    },
    [stop],
  );

  const onDetections = useCallback((event: NativeSyntheticEvent<DetectionsEvent>) => {
    const e = event.nativeEvent;
    // Stale results from an earlier session are discarded.
    if (!activeRef.current || e.sessionId !== sessionIdRef.current) return;
    framesRef.current += 1;
    const aspect = e.frameHeight / e.frameWidth;
    const people = trackerRef.current.update(e.detections, e.timestamp, aspect);
    setFrameSize({ width: e.frameWidth, height: e.frameHeight });
    const monitorFrame = {
      timestamp: e.timestamp,
      sessionId: String(e.sessionId),
      peopleCount: people.length,
      detections: people,
      crowdMetrics: computeCrowdMetrics(people, { deviceRotationRate: e.rotationRate >= 0 ? e.rotationRate : null }),
      inferenceMs: e.inferenceMs,
    };
    setFrame(monitorFrame);
    // Advisory only: the assessment is shown to the user, never acted on.
    setAssessment(engineRef.current.update(monitorFrame));
  }, []);

  return {
    status,
    message,
    // The Phase 2 input stream: one MonitorFrame per analyzed camera frame.
    frame,
    frameSize,
    // Phase 2: explainable threat candidates for the dashboard (advisory only).
    assessment,
    start,
    pause,
    resume,
    stop,
    cameraProps: {
      active,
      analysisEnabled: MONITOR_CONFIG.detectionEnabled && active && status === 'running',
      targetFps: MONITOR_CONFIG.targetFps,
      scoreThreshold: MONITOR_CONFIG.scoreThreshold,
      model: MONITOR_CONFIG.model,
      debugSlowInferenceMs: MONITOR_CONFIG.debugSlowInferenceMs,
      onCameraState,
      onDetections,
    },
  };
}
