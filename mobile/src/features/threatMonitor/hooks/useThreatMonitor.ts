import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { useEmergencyContext } from '../../../context/EmergencyContext';
import { trackEvent } from '../../../services/analyticsService';
import { MONITOR_CONFIG, THREAT_EVENT_CONFIG, isThreatDetectionEnabled } from '../config/threatMonitorConfig';
import { acquireForMonitor, onEmergencyClaim, releaseForMonitor } from '../services/CameraOwnershipService';
import type { MonitorFrame } from '../models/types';
import { computeCrowdMetrics } from '../services/CrowdMetricsService';
import { PersonTracker } from '../services/PersonTrackingService';
import { NOT_YET_SUPPORTED, THREAT_DETECTORS } from '../threat/detectors';
import { detectionState, detectorStatuses } from '../threat/events/detectionState';
import { sessionThreatEvents, type ThreatEvent } from '../threat/events/ThreatEventLog';
import { PoseCarry, attachPoses, toPose } from '../threat/pose/poseAssociation';
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
  const poseCarryRef = useRef(new PoseCarry());
  const engineRef = useRef(new ThreatAssessmentEngine(THREAT_DETECTORS, { notYetSupported: NOT_YET_SUPPORTED }));
  const [assessment, setAssessment] = useState<ThreatAssessment | null>(null);
  // Threat candidates only in AI development/test builds (see config).
  const threatsEnabled = useMemo(() => isThreatDetectionEnabled(), []);
  const [threatFailed, setThreatFailed] = useState(false);
  const threatFailedRef = useRef(false);
  const firstFrameAtRef = useRef<number | null>(null);
  const [watchedMs, setWatchedMs] = useState(0);
  const [events, setEvents] = useState<ThreatEvent[]>(() => sessionThreatEvents.list());

  const stop = useCallback((reason: StopReason = 'user') => {
    if (!activeRef.current) return;
    activeRef.current = false;
    sessionIdRef.current = null;
    setActive(false);
    releaseForMonitor();
    setFrame(null);
    trackerRef.current.reset();
    engineRef.current.reset();
    poseCarryRef.current.reset();
    setAssessment(null);
    sessionThreatEvents.endAll(Date.now(), 'stopped');
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
    threatFailedRef.current = false;
    setThreatFailed(false);
    firstFrameAtRef.current = null;
    setWatchedMs(0);
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

  // Events: follow the shared log, and age them even while no frames arrive.
  useEffect(() => {
    const unsubscribe = sessionThreatEvents.subscribe(() => setEvents(sessionThreatEvents.list()));
    sessionThreatEvents.sweep(Date.now());
    setEvents(sessionThreatEvents.list());
    const timer = setInterval(() => sessionThreatEvents.sweep(Date.now()), 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

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
    const tracked = trackerRef.current.update(e.detections, e.timestamp, aspect);
    const withPoses = attachPoses(tracked, (e.poses ?? []).map(toPose));
    const people = poseCarryRef.current.apply(withPoses, e.timestamp, Boolean(e.poseRan));
    setFrameSize({ width: e.frameWidth, height: e.frameHeight });
    const monitorFrame = {
      timestamp: e.timestamp,
      sessionId: String(e.sessionId),
      peopleCount: people.length,
      detections: people,
      crowdMetrics: computeCrowdMetrics(people, { deviceRotationRate: e.rotationRate >= 0 ? e.rotationRate : null }),
      inferenceMs: e.inferenceMs,
      frameAspect: aspect,
    };
    setFrame(monitorFrame);
    firstFrameAtRef.current ??= e.timestamp;
    setWatchedMs(e.timestamp - firstFrameAtRef.current);
    if (!threatsEnabled || threatFailedRef.current) return;
    // Advisory only: the assessment is shown to the user, never acted on.
    // A failure here stops threat analysis but never people detection.
    try {
      const next = engineRef.current.update(monitorFrame);
      setAssessment(next);
      sessionThreatEvents.ingest(next, Date.now(), monitorFrame.sessionId);
    } catch (error) {
      console.warn('[AIMonitor] threat analysis failed', error);
      threatFailedRef.current = true;
      setThreatFailed(true);
      setAssessment(null);
      sessionThreatEvents.endAll(Date.now(), 'stopped');
    }
  }, [threatsEnabled]);

  const running = status === 'running';
  const detection = useMemo(
    () =>
      threatsEnabled && status === 'paused'
        ? { kind: 'off' as const, title: 'Analysis paused', detail: 'Nothing is analyzed while paused.' }
        : detectionState({
            running,
            threatsEnabled,
            failed: threatFailed,
            assessment,
            frame,
            watchedMs,
            warmUpMs: THREAT_EVENT_CONFIG.warmUpMs,
            notYetSupported: NOT_YET_SUPPORTED,
          }),
    [status, running, threatsEnabled, threatFailed, assessment, frame, watchedMs],
  );
  const detectors = useMemo(
    () => detectorStatuses(threatFailed ? null : assessment, { running, threatsEnabled, notYetSupported: NOT_YET_SUPPORTED }),
    [assessment, running, threatsEnabled, threatFailed],
  );
  const clearEvents = useCallback(() => sessionThreatEvents.clear(), []);

  return {
    status,
    message,
    // The Phase 2 input stream: one MonitorFrame per analyzed camera frame.
    frame,
    frameSize,
    // Phase 2: explainable threat candidates for the dashboard (advisory only).
    assessment,
    threatsEnabled,
    detection,
    detectors,
    events,
    clearEvents,
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
      poseEnabled: MONITOR_CONFIG.poseEnabled,
      poseEvery: MONITOR_CONFIG.poseEvery,
      debugSlowInferenceMs: MONITOR_CONFIG.debugSlowInferenceMs,
      onCameraState,
      onDetections,
    },
  };
}
