import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Vibration, type NativeSyntheticEvent } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';

import { useEmergencyContext } from '../../../context/EmergencyContext';
import { trackEvent } from '../../../services/analyticsService';
import {
  MONITOR_CONFIG,
  THREAT_EVENT_CONFIG,
  isAiCameraFlipEnabled,
  isAiProximityEnabled,
  isAiTestHooksEnabled,
  isThreatDetectionEnabled,
} from '../config/threatMonitorConfig';
import { acquireForMonitor, onEmergencyClaim, releaseForMonitor } from '../services/CameraOwnershipService';
import type { MonitorFrame } from '../models/types';
import { computeCrowdMetrics } from '../services/CrowdMetricsService';
import { PersonTracker } from '../services/PersonTrackingService';
import { ProximityEstimator, type PersonProximity, type ProximitySensitivity } from '../services/ProximityEstimator';
import { ProximityAlerter } from '../services/proximityAlerts';
import { NOT_YET_SUPPORTED, THREAT_DETECTORS } from '../threat/detectors';
import { detectionState, detectorStatuses } from '../threat/events/detectionState';
import { sessionThreatEvents, type ThreatEvent } from '../threat/events/ThreatEventLog';
import { PoseCarry, attachPoses, toPose } from '../threat/pose/poseAssociation';
import { ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';
import type { ThreatAssessment } from '../threat/types';
import type { CameraStateEvent, DetectionsEvent } from '../services/besVision';

export type MonitorStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error';
export type StopReason = 'user' | 'blur' | 'background' | 'emergency' | 'released' | 'error';
export type CameraFacing = 'back' | 'front';
export type ProximitySettings = { alertEnabled: boolean; vibrate: boolean; sensitivity: ProximitySensitivity };
export type ProximityAlert = { trackId: number; at: number };

export const FACING_KEY = 'bes_ai_monitor_facing';
export const PROXIMITY_SETTINGS_KEY = 'bes_ai_proximity_settings';
const DEFAULT_PROXIMITY_SETTINGS: ProximitySettings = { alertEnabled: false, vibrate: false, sensitivity: 'normal' };
// If the restarted camera never reports running, stop blocking further flips.
const FLIP_TIMEOUT_MS = 5000;

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
  const testHooks = useMemo(() => isAiTestHooksEnabled(), []);
  const forceFailRef = useRef(false);
  const [threatFailed, setThreatFailed] = useState(false);
  const threatFailedRef = useRef(false);
  const firstFrameAtRef = useRef<number | null>(null);
  const [watchedMs, setWatchedMs] = useState(0);
  const [events, setEvents] = useState<ThreatEvent[]>(() => sessionThreatEvents.list());

  // Camera flip (flagged). A flip restarts the native camera inside the same
  // monitoring session: the status stays as it is and Start isn't needed.
  const flipEnabled = useMemo(() => isAiCameraFlipEnabled(), []);
  const [facing, setFacing] = useState<CameraFacing>('back');
  const [flipping, setFlipping] = useState(false);
  const flippingRef = useRef(false);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on each flip. Frames count only when their native session was
  // bound in the current generation, so nothing from the old camera leaks in.
  const generationRef = useRef(0);
  const boundGenerationRef = useRef(0);
  const preFlipSessionRef = useRef<number | null>(null);

  // Per-person getting closer / moving away (flagged), with an opt-in alert.
  const proximityEnabled = useMemo(() => isAiProximityEnabled(), []);
  const proximityRef = useRef(new ProximityEstimator());
  const alerterRef = useRef(new ProximityAlerter());
  const [proximity, setProximity] = useState<Map<number, PersonProximity> | null>(null);
  const [proximityAlert, setProximityAlert] = useState<ProximityAlert | null>(null);
  const [proximitySettings, setProximitySettingsState] = useState<ProximitySettings>(DEFAULT_PROXIMITY_SETTINGS);
  const proximitySettingsRef = useRef(DEFAULT_PROXIMITY_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (flipEnabled && (await AsyncStorage.getItem(FACING_KEY)) === 'front' && !cancelled && !activeRef.current) setFacing('front');
        if (proximityEnabled) {
          const raw = await AsyncStorage.getItem(PROXIMITY_SETTINGS_KEY);
          if (raw && !cancelled) {
            const next = { ...DEFAULT_PROXIMITY_SETTINGS, ...JSON.parse(raw) } as ProximitySettings;
            proximitySettingsRef.current = next;
            setProximitySettingsState(next);
          }
        }
      } catch {
        // Defaults stand: back camera, alerts off.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flipEnabled, proximityEnabled]);

  const setProximitySettings = useCallback((patch: Partial<ProximitySettings>) => {
    const next = { ...proximitySettingsRef.current, ...patch };
    proximitySettingsRef.current = next;
    setProximitySettingsState(next);
    AsyncStorage.setItem(PROXIMITY_SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // Everything tied to one camera's view of the scene.
  const resetSceneState = useCallback(() => {
    trackerRef.current.reset();
    engineRef.current.reset();
    poseCarryRef.current.reset();
    proximityRef.current.reset();
    alerterRef.current.reset();
    setProximity(null);
    setProximityAlert(null);
    setAssessment(null);
    setFrame(null);
  }, []);

  const endFlip = useCallback(() => {
    flippingRef.current = false;
    setFlipping(false);
    if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    flipTimerRef.current = null;
  }, []);

  const stop = useCallback((reason: StopReason = 'user') => {
    if (!activeRef.current) return;
    activeRef.current = false;
    sessionIdRef.current = null;
    setActive(false);
    releaseForMonitor();
    resetSceneState();
    endFlip();
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
  }, [resetSceneState, endFlip]);

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
    resetSceneState();
    threatFailedRef.current = false;
    forceFailRef.current = false;
    setThreatFailed(false);
    firstFrameAtRef.current = null;
    setWatchedMs(0);
    setMessage(null);
    setStatus('starting');
    setActive(true);
    trackEvent('ai_monitor_started');
  }, [isEmergency, resetSceneState]);

  // Switch between the back and front camera. Ignored while the camera is
  // starting, while paused, and while an earlier flip is still restarting.
  const flip = useCallback(() => {
    if (!flipEnabled || flippingRef.current) return;
    if (status !== 'running' && status !== 'idle') return;
    const next: CameraFacing = facing === 'back' ? 'front' : 'back';
    generationRef.current += 1;
    if (activeRef.current) {
      flippingRef.current = true;
      setFlipping(true);
      flipTimerRef.current = setTimeout(endFlip, FLIP_TIMEOUT_MS);
      // Wait for the restarted camera's own session.
      preFlipSessionRef.current = sessionIdRef.current;
      sessionIdRef.current = null;
      resetSceneState();
      sessionThreatEvents.endAll(Date.now(), 'stopped');
      firstFrameAtRef.current = null;
      setWatchedMs(0);
    }
    setFacing(next);
    AsyncStorage.setItem(FACING_KEY, next).catch(() => {});
    trackEvent('ai_monitor_camera_flipped', { facing: next });
  }, [flipEnabled, status, facing, resetSceneState, endFlip]);

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
          // A late event from the camera that was just flipped away is ignored.
          if (flippingRef.current && e.sessionId === preFlipSessionRef.current) break;
          sessionIdRef.current = e.sessionId;
          boundGenerationRef.current = generationRef.current;
          break;
        case 'running':
          setStatus((s) => (s === 'starting' ? 'running' : s));
          if (flippingRef.current && sessionIdRef.current === e.sessionId) endFlip();
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
    [stop, endFlip],
  );

  const onDetections = useCallback((event: NativeSyntheticEvent<DetectionsEvent>) => {
    const e = event.nativeEvent;
    // Stale results from an earlier session are discarded.
    if (!activeRef.current || e.sessionId !== sessionIdRef.current) return;
    if (boundGenerationRef.current !== generationRef.current) return;
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
    if (proximityEnabled) {
      // Informational only: never contacts anyone or starts Emergency.
      const settings = proximitySettingsRef.current;
      const readings = proximityRef.current.update(monitorFrame, settings.sensitivity);
      setProximity(readings);
      const alertId = settings.alertEnabled ? alerterRef.current.evaluate(readings, e.timestamp) : null;
      if (alertId != null) {
        setProximityAlert({ trackId: alertId, at: Date.now() });
        if (settings.vibrate) Vibration.vibrate(250);
        trackEvent('ai_monitor_proximity_alert');
      }
    }
    if (!threatsEnabled || threatFailedRef.current) return;
    // Advisory only: the assessment is shown to the user, never acted on.
    // A failure here stops threat analysis but never people detection.
    try {
      if (forceFailRef.current) throw new Error('Simulated threat analysis failure (test build)');
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
  }, [threatsEnabled, proximityEnabled]);

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

  // Test builds only (see isAiTestHooksEnabled).
  const testReplay = useCallback(
    (scenarioId: string) => {
      if (!testHooks) return;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SCENARIOS } = require('../threat/validation/scenarios') as typeof import('../threat/validation/scenarios');
      const clip = SCENARIOS.find((s) => s.id === scenarioId)?.build(1);
      if (!clip?.length) return;
      // The clip ends now, in its own session.
      const engine = new ThreatAssessmentEngine(THREAT_DETECTORS);
      const endsAt = Date.now();
      const last = clip[clip.length - 1].timestamp;
      const sessionId = `replay-${endsAt}`;
      for (const f of clip) sessionThreatEvents.ingest(engine.update(f), endsAt - (last - f.timestamp), sessionId);
    },
    [testHooks],
  );
  const testFailAnalysis = useCallback(() => {
    if (testHooks) forceFailRef.current = true;
  }, [testHooks]);

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
    testHooks: testHooks ? { replay: testReplay, failAnalysis: testFailAnalysis } : null,
    start,
    pause,
    resume,
    stop,
    flip: flipEnabled ? flip : null,
    facing,
    flipping,
    proximityEnabled,
    proximity,
    proximityAlert,
    dismissProximityAlert: () => setProximityAlert(null),
    proximitySettings,
    setProximitySettings,
    cameraProps: {
      active,
      facing,
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
