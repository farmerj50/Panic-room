import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import LiveLocationMap from '../components/LiveLocationMap';
import { useEmergencyContext, isAndroidBackgroundCameraAvailable, BackgroundCameraPreviewView } from '../context/EmergencyContext';
import { COUNTDOWN_SECONDS, EMERGENCY_NUMBER, ENABLE_EMERGENCY_DIALER } from '../config/emergencyConfig';
import {
  addVideoSegment,
  callEmergencyContacts,
  createEmergency,
  createRecording,
  notifyEmergencyContacts,
  updateEmergency,
} from '../services/emergencyService';
import { getCurrentLocation, getLastKnownLocation, watchLocation } from '../services/locationService';
import { uploadFile } from '../services/uploadService';
import { clearInProgressEmergency, useAppStateEmergencyGuard } from '../hooks/useAppStateEmergencyGuard';
import type { Contact } from '../types/contact';

// Best-effort, fire-and-forget — no offline queue in v1. A failure here just
// means EvidenceScreen shows nothing for that asset; it never blocks the UI.
// Used for audio only — video goes through uploadVideoSegmentEntry below,
// since camera-flip splits video into ordered segments per emergency.
async function uploadEmergencyAsset(emergencyId: string, localUri: string, kind: 'audio' | 'video') {
  try {
    const { key } = await uploadFile({ localUri, kind });
    await Promise.allSettled([
      updateEmergency(emergencyId, kind === 'audio' ? { audioUrl: key } : { videoUrl: key }),
      createRecording({ fileUrl: key, type: kind }),
    ]);
  } catch (error) {
    console.warn(`Failed to upload emergency ${kind}`, error);
  }
}

type CameraFacing = 'front' | 'back';

type VideoSegmentInfo = {
  facing: CameraFacing;
  sequence: number;
  startedAt: string;
  finalized: boolean;
};

type PendingSegmentUpload = {
  segment: VideoSegmentInfo;
  localUri: string;
  endedAt: string;
  storageKey?: string;
  status: 'pending' | 'done' | 'failed';
  promise?: Promise<void>;
};

// Uploads the local video file (once — the storage key is retained on the
// entry so a retry after a metadata-POST failure never re-uploads the
// file, only re-POSTs the metadata), then attaches it to the emergency as
// an ordered segment. The backend endpoint is itself idempotent on
// (emergencyId, sequence), so a retry after a lost response is safe too.
async function uploadVideoSegmentEntry(emergencyId: string, entry: PendingSegmentUpload) {
  try {
    if (!entry.storageKey) {
      const { key } = await uploadFile({ localUri: entry.localUri, kind: 'video' });
      entry.storageKey = key;
    }
    await addVideoSegment(emergencyId, {
      fileUrl: entry.storageKey,
      facing: entry.segment.facing,
      sequence: entry.segment.sequence,
      startedAt: entry.segment.startedAt,
      endedAt: entry.endedAt,
    });
    entry.status = 'done';
  } catch (error) {
    entry.status = 'failed';
    console.warn('Failed to upload video segment', error);
  }
}

type EmergencyPhase = 'countdown' | 'activating' | 'recording' | 'error';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_CAMERA_FACING: CameraFacing = Platform.OS === 'web' ? 'front' : 'back';

// Android drives video capture through the background-surviving native
// module (see modules/background-camera) instead of expo-camera's
// Activity-bound CameraView — everything else (web, iOS) keeps the
// existing CameraView-based path unchanged.
const USE_ANDROID_BACKGROUND_CAMERA = Platform.OS === 'android' && isAndroidBackgroundCameraAvailable;

type BrowserMediaCaptureState = {
  captureActive: boolean;
  releaseVersion: number;
  streams: Set<MediaStream>;
};

const MEDIA_CAPTURE_STATE_KEY = '__panicRoomMediaCaptureState';
const MEDIA_CAPTURE_PATCHED_KEY = '__panicRoomTrackedGetUserMedia';

function getBrowserMediaCaptureState(): BrowserMediaCaptureState | null {
  if (Platform.OS !== 'web') return null;
  const root = globalThis as any;

  if (!root[MEDIA_CAPTURE_STATE_KEY]) {
    root[MEDIA_CAPTURE_STATE_KEY] = {
      captureActive: false,
      releaseVersion: 0,
      streams: new Set<MediaStream>(),
    } satisfies BrowserMediaCaptureState;
  }

  return root[MEDIA_CAPTURE_STATE_KEY] as BrowserMediaCaptureState;
}

function stopBrowserMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

function trackBrowserMediaStream(stream: MediaStream) {
  const state = getBrowserMediaCaptureState();
  if (!state) return;

  state.streams.add(stream);

  const cleanup = () => {
    const allEnded = stream.getTracks().every((track) => track.readyState === 'ended');
    if (allEnded) state.streams.delete(stream);
  };

  stream.getTracks().forEach((track) => {
    try {
      track.addEventListener('ended', cleanup);
    } catch {}
  });
}

function patchGetUserMedia() {
  if (Platform.OS !== 'web') return;
  const nav = (globalThis as any).navigator;
  if (!nav?.mediaDevices?.getUserMedia) return;

  const current = nav.mediaDevices.getUserMedia;
  if ((current as any)[MEDIA_CAPTURE_PATCHED_KEY]) return;

  const original = current.bind(nav.mediaDevices);
  const trackedGetUserMedia = async (...args: Parameters<MediaDevices['getUserMedia']>) => {
    const stateAtCall = getBrowserMediaCaptureState();
    const releaseVersionAtCall = stateAtCall?.releaseVersion ?? 0;
    const stream: MediaStream = await original(...args);
    const state = getBrowserMediaCaptureState();
    trackBrowserMediaStream(stream);

    if (state && (!state.captureActive || state.releaseVersion !== releaseVersionAtCall)) {
      stopBrowserMediaStream(stream);
    }

    return stream;
  };

  (trackedGetUserMedia as any)[MEDIA_CAPTURE_PATCHED_KEY] = true;
  nav.mediaDevices.getUserMedia = trackedGetUserMedia;
}

patchGetUserMedia();

function setBrowserMediaCaptureActive(active: boolean) {
  const state = getBrowserMediaCaptureState();
  if (!state) return;

  patchGetUserMedia();
  state.captureActive = active;

  if (!active) {
    state.releaseVersion += 1;
  }
}

function scheduleBrowserMediaRelease() {
  if (Platform.OS !== 'web') return;
  const scheduledReleaseVersion = getBrowserMediaCaptureState()?.releaseVersion;

  [0, 100, 500, 1500, 3000].forEach((delay) => {
    setTimeout(() => {
      const state = getBrowserMediaCaptureState();
      if (state?.captureActive || state?.releaseVersion !== scheduledReleaseVersion) return;
      releaseBrowserMediaStreams();
    }, delay);
  });
}

function releaseBrowserMediaStreams() {
  if (Platform.OS !== 'web') return;
  patchGetUserMedia();

  const state = getBrowserMediaCaptureState();
  if (state?.captureActive) return;

  state?.streams.forEach(stopBrowserMediaStream);
  state?.streams.clear();

  // Also sweep any remaining <video>/<audio> elements still in the DOM
  const doc = (globalThis as any).document;
  if (doc?.querySelectorAll) {
    doc.querySelectorAll('video, audio').forEach((el: any) => {
      const stream = el.srcObject;
      if (stream?.getTracks) stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      el.pause?.();
      el.srcObject = null;
      el.removeAttribute?.('src');
      el.load?.();
    });
  }
}

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function mapUrl(location: { latitude: number; longitude: number } | null) {
  if (!location) return 'Location unavailable';
  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}

function phoneUrlTarget(phone: string) {
  return phone.replace(/[^\d+]/g, '');
}

function isCapturingPhase(phase: EmergencyPhase) {
  return phase === 'activating' || phase === 'recording';
}

export default function EmergencyScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const {
    contacts,
    priorityContact,
    emergencyId,
    setEmergencyId,
    triggerEmergency,
    resolveEmergency,
    emergencySettings,
    consumePendingResume,
    startAndroidCapture,
    flipAndroidCapture,
    stopAndroidCapture,
    flushPendingVideoUploads,
    onExternalCaptureStop,
  } = useEmergencyContext();

  const {
    cameraAutoRecord,
    audioAutoRecord,
    emergencyCallMode,
  } = emergencySettings;

  const cameraRef = useRef<CameraView>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [phase, setPhase] = useState<EmergencyPhase>('countdown');
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Emergency activation starting.');
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const [facing, setFacing] = useState<CameraFacing>(DEFAULT_CAMERA_FACING);
  const [cameraSwitching, setCameraSwitching] = useState(false);

  const activationStarted = useRef(false);
  const sessionRef = useRef(0);
  const stopping = useRef(false);
  const locationSub = useRef<{ remove: () => void } | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Independent of EmergencyContext's emergencyId (which gets nulled out by
  // resolveEmergency() before stopEmergencyAssets finishes) — this is what
  // stopEmergencyAssets uses to know which event to attach uploaded assets to.
  const activeEmergencyIdRef = useRef<string | null>(null);
  const videoRecordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  // Ref mirrors location state so callbacks closed over in useCallback always
  // see the latest value without needing location in their dependency arrays.
  const currentLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  // ── Camera-flip / video-segment bookkeeping ─────────────────────────────
  const currentSegmentRef = useRef<VideoSegmentInfo | null>(null);
  const sequenceCounterRef = useRef(1);
  const pendingSegmentUploadsRef = useRef<PendingSegmentUpload[]>([]);
  // Exit must always win over an in-flight flip. captureGenerationRef is
  // bumped every time capture is torn down; a flip captures the generation
  // it started with and bails at every checkpoint if it's changed.
  const captureGenerationRef = useRef(0);
  const emergencyStoppingRef = useRef(false);
  // Re-entrancy guard for flipCamera(). Must be a ref, not the
  // `cameraSwitching` state var: state updates aren't synchronous, so two
  // taps arriving before the first render commits could both read a stale
  // `cameraSwitching === false` and run concurrently, racing two
  // recordAsync() calls against each other and silently losing a segment.
  const flippingRef = useRef(false);
  // Resolves once the current CameraView instance reports ready — reset
  // right before every (re)mount (initial start and every flip), awaited
  // (with a bounded timeout) before ever calling recordAsync.
  const cameraReadyResolverRef = useRef<(() => void) | null>(null);
  const cameraReadyPromiseRef = useRef<Promise<void>>(Promise.resolve());

  const previewWidth = Math.min(width - 32, 420);
  const previewHeight = Math.round(previewWidth * 0.56);
  const orderedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(b.isPriority) - Number(a.isPriority)),
    [contacts],
  );
  const callTargetContact = priorityContact ?? orderedContacts[0] ?? null;

  useAppStateEmergencyGuard({ emergencyId, phase, elapsed });

  // Call right before every CameraView (re)mount (initial start, and every
  // flip) so anything awaiting readiness is waiting on a fresh promise, not
  // one already resolved by the previous CameraView instance.
  const resetCameraReadyGate = useCallback(() => {
    cameraReadyPromiseRef.current = new Promise<void>((resolve) => {
      cameraReadyResolverRef.current = resolve;
    });
  }, []);

  const handleCameraReady = useCallback(() => {
    cameraReadyResolverRef.current?.();
    cameraReadyResolverRef.current = null;
  }, []);

  // Bounded wait — expo-camera's own docs say to wait for onCameraReady
  // before calling recordAsync, but a missing/late ready event must never
  // hang the emergency flow. Returns false on timeout; callers must not
  // call recordAsync in that case.
  const waitForCameraReady = useCallback(async (timeoutMs = 6000) => {
    let timedOut = false;
    await Promise.race([
      cameraReadyPromiseRef.current,
      wait(timeoutMs).then(() => {
        timedOut = true;
      }),
    ]);
    return !timedOut;
  }, []);

  // A camera session occasionally never fires onCameraReady after a rapid
  // successive remount (observed on-device: 1st and 2nd mounts ready in
  // ~1-2s, an immediately-following 3rd mount can hang indefinitely) —
  // bumping the key again to force an entirely fresh native mount reliably
  // recovers it, so retry once via a full remount before giving up.
  const remountCameraAndWaitReady = useCallback(
    async (timeoutMs = 6000) => {
      setCameraSessionKey((v) => v + 1);
      resetCameraReadyGate();
      return waitForCameraReady(timeoutMs);
    },
    [resetCameraReadyGate, waitForCameraReady],
  );

  // Shared by flipCamera() and stopEmergencyAssets() — both need to "stop
  // whatever's currently recording and queue its upload." The synchronous
  // check-and-set of `finalized` (before any await) is what makes this
  // safe to call from both without double-stopping: JS's single-threaded
  // execution means whichever caller reaches this first "wins," and the
  // other becomes a no-op for that segment.
  const finalizeCurrentSegment = useCallback(async () => {
    const segment = currentSegmentRef.current;
    if (!segment || segment.finalized) return;
    segment.finalized = true;

    try { cameraRef.current?.stopRecording(); } catch {}
    let uri: string | null = null;
    try {
      // Bounded so a stuck recordAsync promise can never hang the flow —
      // but generous, since encoding-to-disk can genuinely take a few
      // seconds and a segment dropped here is lost with no retry path
      // (finalized is already true above).
      const result = await Promise.race([
        videoRecordingPromiseRef.current ?? Promise.resolve(undefined),
        wait(8000).then(() => undefined),
      ]);
      uri = result?.uri ?? null;
    } catch {}
    videoRecordingPromiseRef.current = null;

    if (!uri) {
      console.warn(`Segment ${segment.sequence} (${segment.facing}) produced no video URI — dropped.`);
      return;
    }
    const emergencyId = activeEmergencyIdRef.current;
    const entry: PendingSegmentUpload = {
      segment,
      localUri: uri,
      endedAt: new Date().toISOString(),
      status: 'pending',
    };
    pendingSegmentUploadsRef.current.push(entry);
    if (emergencyId) {
      entry.promise = uploadVideoSegmentEntry(emergencyId, entry).catch(() => {});
    } else {
      entry.status = 'failed';
    }
  }, []);

  const stopEmergencyAssets = useCallback(async () => {
    sessionRef.current += 1;
    activationStarted.current = false;
    // Discard a resume that was requested but never actually consumed by
    // activateEmergency (e.g. the countdown was cancelled) — otherwise it
    // would silently corrupt the *next*, unrelated emergency activation by
    // reusing a stale id/sequence.
    consumePendingResume();
    // Exit always wins over an in-flight flip — see captureGenerationRef's
    // comment above. Set before anything else so any flip checkpoint that
    // runs after this point bails out immediately.
    emergencyStoppingRef.current = true;
    captureGenerationRef.current += 1;
    setCountdownEnabled(false);
    setBrowserMediaCaptureActive(false);
    setCameraActive(false);
    setCameraMounted(false);
    setCameraSessionKey((v) => v + 1);
    releaseBrowserMediaStreams();
    scheduleBrowserMediaRelease();

    // Always resolve emergency state regardless of re-entrancy so isEmergency
    // never gets stuck as true after the screen exits.
    resolveEmergency();

    if (stopping.current) return;
    stopping.current = true;

    let audioUri: string | null = null;

    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      locationSub.current?.remove();
      locationSub.current = null;

      // Finalizes whatever the current video segment is. On Android the
      // native service owns finalize/journal/unbind (idempotent — a no-op
      // if nothing's recording); elsewhere this is the CameraView-based
      // finalizeCurrentSegment (idempotent for the same reason — a
      // concurrent flip may have already finalized it).
      if (USE_ANDROID_BACKGROUND_CAMERA) {
        try { await stopAndroidCapture(); } catch {}
      } else {
        await finalizeCurrentSegment();
      }

      try { await Promise.race([cameraRef.current?.pausePreview?.() ?? Promise.resolve(), wait(500)]); } catch {}
      try { await Promise.race([audioRecorder.stop().catch(() => {}), wait(750)]); } catch {}
      audioUri = audioRecorder.uri ?? null;

      cameraRef.current = null;
    } finally {
      stopping.current = false;
      scheduleBrowserMediaRelease();
    }

    clearInProgressEmergency().catch(() => {});

    const emergencyIdForUpload = activeEmergencyIdRef.current;
    activeEmergencyIdRef.current = null;
    if (emergencyIdForUpload && audioUri) {
      uploadEmergencyAsset(emergencyIdForUpload, audioUri, 'audio');
    }
    // The backend record otherwise stays ACTIVE forever — nothing else in
    // the app ever marks an emergency resolved. This also makes the
    // relaunch-recovery check ("is it still ACTIVE?") in EmergencyContext
    // meaningful instead of matching every past emergency.
    if (emergencyIdForUpload) {
      updateEmergency(emergencyIdForUpload, { status: 'RESOLVED' }).catch(() => {});
    }

    if (USE_ANDROID_BACKGROUND_CAMERA) {
      // Segment uploads are owned by EmergencyContext (see its rationale)
      // — just give in-flight/retry uploads a bounded chance to finish.
      await flushPendingVideoUploads();
    } else {
      // Sweep video-segment uploads: give in-flight ones a bounded chance to
      // finish, then retry anything that already failed exactly once. This
      // is in-session only — no durable queue across an app restart.
      const pending = pendingSegmentUploadsRef.current;
      if (emergencyIdForUpload && pending.length > 0) {
        await Promise.race([
          Promise.allSettled(pending.map((entry) => entry.promise ?? Promise.resolve())),
          wait(5000),
        ]);
        const stillFailed = pending.filter((entry) => entry.status === 'failed');
        await Promise.allSettled(
          stillFailed.map((entry) => uploadVideoSegmentEntry(emergencyIdForUpload, entry)),
        );
      }
      pendingSegmentUploadsRef.current = [];
    }
  }, [audioRecorder, consumePendingResume, finalizeCurrentSegment, flushPendingVideoUploads, resolveEmergency, stopAndroidCapture]);

  const returnHome = useCallback(async () => {
    // Stop media streams synchronously BEFORE React unmounts the CameraView
    // so the tracked streams are still stoppable even if the DOM element is gone.
    setCountdownEnabled(false);
    setBrowserMediaCaptureActive(false);
    releaseBrowserMediaStreams();
    scheduleBrowserMediaRelease();
    setCameraActive(false);
    setCameraMounted(false);
    setPhase('countdown');
    setCount(COUNTDOWN_SECONDS);
    setElapsed(0);
    setLocation(null);
    setLocationUnavailable(false);
    setNotificationStatus(null);
    setEmergencyId(null);
    await stopEmergencyAssets();
    navigation.navigate('Home');
  }, [navigation, setEmergencyId, stopEmergencyAssets]);

  // The notification's "Stop Recording" action (Android) only ever stops
  // the camera natively — it can't resolve the backend emergency or stop
  // GPS on its own. When JS is alive to hear about it, treat it exactly
  // like the in-app Stop/Exit button.
  useEffect(() => {
    return onExternalCaptureStop(() => {
      returnHome();
    });
  }, [onExternalCaptureStop, returnHome]);

  useFocusEffect(
    useCallback(() => {
      activationStarted.current = false;
      stopping.current = false;
      sessionRef.current += 1;
      setCountdownEnabled(true);
      setBrowserMediaCaptureActive(false);
      releaseBrowserMediaStreams();
      scheduleBrowserMediaRelease();
      setPhase('countdown');
      setCount(COUNTDOWN_SECONDS);
      setElapsed(0);
      setLocation(null);
      setLocationUnavailable(false);
      setEmergencyId(null);
      setNotificationStatus(null);
      setStatusMessage('Emergency activation starting.');
      setCameraActive(false);
      setCameraMounted(false);
      return () => { stopEmergencyAssets(); };
    }, [setEmergencyId, stopEmergencyAssets]),
  );

  // Returns { cameraOk, audioOk } — never throws.
  // Camera/audio denial is non-fatal: emergency continues with GPS only.
  const ensurePermissions = useCallback(async (): Promise<{ cameraOk: boolean; audioOk: boolean }> => {
    let cameraOk = Boolean(cameraPermission?.granted);
    let audioOk = Boolean(micPermission?.granted);

    // Request at emergency time if not yet granted (e.g. user skipped Setup).
    if (cameraAutoRecord && !cameraOk) {
      try { const r = await requestCameraPermission(); cameraOk = r.granted; } catch { cameraOk = false; }
    }
    if (audioAutoRecord && !audioOk) {
      try { const r = await requestMicPermission(); audioOk = r.granted; } catch { audioOk = false; }
    }

    return {
      cameraOk: cameraAutoRecord && cameraOk,
      audioOk: audioAutoRecord && audioOk,
    };
  }, [cameraAutoRecord, audioAutoRecord, cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const openExternalCallAction = useCallback(async (
    url: string,
    testMessage: string,
    unavailableMessage: string,
  ) => {
    if (Platform.OS === 'web') {
      setStatusMessage(`Desktop web cannot ${testMessage}. Use a phone build or dial manually.`);
      return false;
    }

    if (!ENABLE_EMERGENCY_DIALER) {
      setStatusMessage(`[TEST MODE] Would ${testMessage}.`);
      return true;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      setStatusMessage(unavailableMessage);
      return false;
    }

    await Linking.openURL(url);
    return true;
  }, []);

  const callEmergencyNumber = useCallback(async () => {
    if (Platform.OS === 'web') {
      setStatusMessage(`Desktop web cannot place a ${EMERGENCY_NUMBER} call. Dial ${EMERGENCY_NUMBER} from a phone now.`);
      return false;
    }

    return openExternalCallAction(
      `tel:${EMERGENCY_NUMBER}`,
      `dial ${EMERGENCY_NUMBER}`,
      `Emergency mode active. Dial ${EMERGENCY_NUMBER} immediately.`,
    );
  }, [openExternalCallAction]);

  const confirmCallEmergencyNumber = useCallback(() => {
    Alert.alert(
      `Call ${EMERGENCY_NUMBER}?`,
      `This will open your phone dialer with ${EMERGENCY_NUMBER} filled in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Call ${EMERGENCY_NUMBER}`, style: 'destructive', onPress: () => { void callEmergencyNumber(); } },
      ],
    );
  }, [callEmergencyNumber]);

  const callContactsFromServer = useCallback(async (contactsToCall: Contact[], label: string) => {
    try {
      const response = await callEmergencyContacts({
        contacts: contactsToCall,
        // Use ref so the message always contains the latest GPS fix regardless
        // of whether React has committed the location state update yet.
        message: `Bes emergency activated. Location: ${mapUrl(currentLocationRef.current)}. Please check on this person immediately.`,
      });

      if (response.called) {
        setNotificationStatus(
          response.calledCount === contactsToCall.length
            ? `Voice call started for ${label}.`
            : `Voice calls started for ${response.calledCount}/${contactsToCall.length} contacts.`,
        );
        return true;
      }

      setNotificationStatus(response.error || 'Voice call provider is not configured.');
      return false;
    } catch {
      setNotificationStatus('Could not start a server-side voice call.');
      return false;
    }
  }, []);

  const callContactFromServer = useCallback(
    (contact: Contact) => callContactsFromServer([contact], contact.name),
    [callContactsFromServer],
  );

  const callAllContacts = useCallback(async () => {
    if (orderedContacts.length === 0) {
      setNotificationStatus('No trusted contacts saved. Add one in Contacts.');
      return false;
    }

    setStatusMessage(`Starting voice calls to ${orderedContacts.length} trusted contact${orderedContacts.length === 1 ? '' : 's'}.`);
    return callContactsFromServer(orderedContacts, 'trusted contacts');
  }, [callContactsFromServer, orderedContacts]);

  const callPriorityContact = useCallback(async () => {
    if (!callTargetContact) {
      setNotificationStatus('No trusted contacts saved. Add one in Contacts.');
      return false;
    }

    if (!priorityContact) {
      setNotificationStatus(`No priority contact set. Using ${callTargetContact.name} as fallback.`);
    }

    if (Platform.OS === 'web') {
      setStatusMessage(`Starting voice call to ${callTargetContact.name}.`);
      return callContactFromServer(callTargetContact);
    }

    return openExternalCallAction(
      `tel:${phoneUrlTarget(callTargetContact.phoneNumber)}`,
      `call ${callTargetContact.name}`,
      `Could not open the dialer for ${callTargetContact.name}.`,
    );
  }, [callContactFromServer, callTargetContact, openExternalCallAction, priorityContact]);

  const facetimePriorityContact = useCallback(async () => {
    if (!callTargetContact) {
      setNotificationStatus('No trusted contacts saved. Add one in Contacts.');
      return false;
    }

    if (Platform.OS === 'web') {
      setStatusMessage('FaceTime is only available from a device that has FaceTime configured.');
      return false;
    }

    return openExternalCallAction(
      `facetime:${phoneUrlTarget(callTargetContact.phoneNumber)}`,
      `FaceTime ${callTargetContact.name}`,
      'FaceTime is not available on this device.',
    );
  }, [callTargetContact, openExternalCallAction]);

  // Deliberately has no path that dials 911 on its own — the countdown's
  // cancel window isn't treated as confirmation for an actual emergency
  // call. Calling 911 always requires an explicit tap on the "Call 911"
  // button, which itself confirms via confirmCallEmergencyNumber.
  const runConfiguredCallAction = useCallback(async () => {
    if (emergencyCallMode === 'none') {
      setStatusMessage('Emergency mode active. Alerts sent.');
      return;
    }

    if (emergencyCallMode === 'ask') {
      setStatusMessage('Emergency mode active. Choose a call option if safe.');
      return;
    }

    if (emergencyCallMode === 'priority') {
      setStatusMessage('Opening priority contact dialer.');
      await callPriorityContact();
      return;
    }

    await callAllContacts();
  }, [callAllContacts, callPriorityContact, emergencyCallMode]);

  // Flip is available any time the camera is live, including mid-recording
  // — expo-camera stops a recording the instant `facing` changes, so this
  // finalizes+uploads the current segment, then starts a fresh recording
  // on the flipped camera. The next recording never waits on the previous
  // segment's upload (step 6 below is fire-and-forget, already queued
  // inside finalizeCurrentSegment). Every checkpoint re-checks the
  // cancellation guard so an exit that happens mid-flip always wins.
  const flipCamera = useCallback(async () => {
    if (!cameraMounted || flippingRef.current || emergencyStoppingRef.current) return;
    flippingRef.current = true;
    const generation = captureGenerationRef.current;
    setCameraSwitching(true);

    try {
      const newFacing: CameraFacing = facing === 'back' ? 'front' : 'back';

      if (USE_ANDROID_BACKGROUND_CAMERA) {
        // The native service owns segment finalize/rebind/restart and its
        // own stopRequested guard (the flip-vs-exit race) — see
        // BackgroundCameraService.kt. JS here only drives the button's
        // re-entrancy guard and "Switching camera…" UI state.
        try {
          await flipAndroidCapture(newFacing);
          if (emergencyStoppingRef.current || generation !== captureGenerationRef.current) return;
          setFacing(newFacing);
        } catch {
          setStatusMessage('Camera flip failed — continuing with current camera.');
        }
        return;
      }

      // 1-2: finalize whatever's currently recording, queue its upload.
      await finalizeCurrentSegment();
      if (emergencyStoppingRef.current || generation !== captureGenerationRef.current) return;

      // 3: flip facing.
      setFacing(newFacing);

      // 4: remount and wait for ready (bounded, retried once on timeout —
      // see remountCameraAndWaitReady's comment).
      let ready = await remountCameraAndWaitReady();
      if (emergencyStoppingRef.current || generation !== captureGenerationRef.current) return;
      if (!ready) {
        ready = await remountCameraAndWaitReady();
        if (emergencyStoppingRef.current || generation !== captureGenerationRef.current) return;
      }
      if (!ready) {
        setStatusMessage('Camera restart failed — continuing without video for this segment.');
        return;
      }

      // 5: start the next segment's recording.
      const sequence = sequenceCounterRef.current + 1;
      sequenceCounterRef.current = sequence;
      currentSegmentRef.current = {
        facing: newFacing,
        sequence,
        startedAt: new Date().toISOString(),
        finalized: false,
      };
      const recordingPromise = cameraRef.current?.recordAsync({ maxDuration: 300 });
      videoRecordingPromiseRef.current = recordingPromise ?? null;
      recordingPromise?.catch(() => {});
    } finally {
      flippingRef.current = false;
      setCameraSwitching(false);
    }
  }, [cameraMounted, facing, finalizeCurrentSegment, flipAndroidCapture, remountCameraAndWaitReady]);

  const activateEmergency = useCallback(async () => {
    if (activationStarted.current) return;
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    activationStarted.current = true;
    stopping.current = false;
    setCountdownEnabled(false);
    setPhase('activating');

    // Fresh capture state for this activation — a session can go through
    // multiple activate/exit cycles without this screen unmounting, so
    // these must reset per-emergency, not just once at mount.
    emergencyStoppingRef.current = false;
    captureGenerationRef.current += 1;
    sequenceCounterRef.current = 1;
    currentSegmentRef.current = null;
    pendingSegmentUploadsRef.current = [];
    flippingRef.current = false;
    setFacing(DEFAULT_CAMERA_FACING);

    triggerEmergency();

    // Resuming an emergency the relaunch-recovery flow surfaced (see
    // EmergencyContext.tsx) must reuse its id and continue its sequence
    // numbering — never create a second backend emergency or restart at
    // segment 1, which would collide with segments that already exist.
    const resume = consumePendingResume();

    let currentLocation: { latitude: number; longitude: number } | null = null;
    let activeEmergencyId: string | null = resume?.emergencyId ?? null;
    if (activeEmergencyId) activeEmergencyIdRef.current = activeEmergencyId;
    const isCurrentSession = () => sessionRef.current === sessionId && !stopping.current;

    try {
      let camOk = false;
      let audOk = false;

      if (cameraAutoRecord || audioAutoRecord) {
        setStatusMessage('Preparing camera and microphone.');
        const perms = await ensurePermissions();
        if (!isCurrentSession()) return;
        camOk = cameraAutoRecord && perms.cameraOk;
        audOk = audioAutoRecord && perms.audioOk;

        if (camOk || audOk) {
          setBrowserMediaCaptureActive(true);
        }

        if (camOk) {
          // Only mount the CameraView after we know permission is granted.
          // Mounting before this causes the browser to fire its own
          // getUserMedia request which logs a second "Permission denied" error.
          setCameraSessionKey((v) => v + 1);
          resetCameraReadyGate();
          setCameraMounted(true);
          setCameraActive(true);
        }

        if (!perms.cameraOk && cameraAutoRecord) {
          setStatusMessage('Camera was not enabled during setup. Continuing with GPS and audio.');
          await new Promise((r) => setTimeout(r, 1200));
          if (!isCurrentSession()) return;
        }
        if (!perms.audioOk && audioAutoRecord) {
          setStatusMessage('Microphone was not enabled during setup. Continuing with GPS only.');
          await new Promise((r) => setTimeout(r, 1200));
          if (!isCurrentSession()) return;
        }
      }

      setStatusMessage('Getting GPS location.');
      // Try live GPS first; fall back to the last background-task location
      currentLocation = await getCurrentLocation();
      if (!currentLocation) currentLocation = await getLastKnownLocation();
      if (!isCurrentSession()) return;
      currentLocationRef.current = currentLocation;
      setLocation(currentLocation);
      if (!currentLocation) {
        setLocationUnavailable(true);
        setStatusMessage('Location unavailable. Continuing without GPS.');
      }
      const sub = (await watchLocation((loc) => {
        currentLocationRef.current = loc;
        setLocation(loc);
      })) as any;
      // Check session AFTER the async call — stopEmergencyAssets may have run
      // and nulled locationSub.current while watchLocation was in-flight.
      if (!isCurrentSession()) {
        sub?.remove();
        return;
      }
      locationSub.current = sub;

      if (resume) {
        setEmergencyId(resume.emergencyId);
      } else {
        setStatusMessage('Creating emergency event.');
        try {
          const emergency = await createEmergency({
            latitude: currentLocation?.latitude,
            longitude: currentLocation?.longitude,
          });
          activeEmergencyId = emergency.id;
          activeEmergencyIdRef.current = emergency.id;
          if (!isCurrentSession()) return;
          setEmergencyId(emergency.id);
        } catch {
          setNotificationStatus('Backend event failed — recording and dialer still active.');
        }
      }

      if (audOk) {
        setStatusMessage('Starting audio recording.');
        await audioRecorder.prepareToRecordAsync();
        if (!isCurrentSession()) return;
        audioRecorder.record();
        await wait(300);
        if (!isCurrentSession()) return;
      }

      if (camOk && USE_ANDROID_BACKGROUND_CAMERA) {
        setStatusMessage('Starting video recording.');
        // Requires a real emergencyId — the native journal tags every
        // segment with it immediately. If backend creation failed above,
        // video is skipped for this session; audio/GPS/notifications
        // still proceed exactly as the CameraView path already tolerates.
        if (activeEmergencyId) {
          try {
            await startAndroidCapture(activeEmergencyId, DEFAULT_CAMERA_FACING, resume?.startingSequence ?? 1);
          } catch {
            setStatusMessage('Camera did not start — continuing without video.');
          }
        }
      } else if (camOk) {
        setStatusMessage('Starting video recording.');
        let ready = await waitForCameraReady();
        if (!isCurrentSession()) return;
        if (!ready) {
          ready = await remountCameraAndWaitReady();
          if (!isCurrentSession()) return;
        }
        if (ready) {
          currentSegmentRef.current = {
            facing: DEFAULT_CAMERA_FACING,
            sequence: sequenceCounterRef.current,
            startedAt: new Date().toISOString(),
            finalized: false,
          };
          const recordingPromise = cameraRef.current?.recordAsync({ maxDuration: 300 });
          videoRecordingPromiseRef.current = recordingPromise ?? null;
          recordingPromise?.catch(() => {});
        } else {
          setStatusMessage('Camera did not become ready in time — continuing without video.');
        }
      }

      recordingTimerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
      setPhase('recording');

      if (activeEmergencyId && orderedContacts.length > 0) {
        setStatusMessage('Notifying trusted contacts.');
        const response = await notifyEmergencyContacts({
          emergencyId: activeEmergencyId,
          contacts: orderedContacts,
          message: `Bes emergency activated. Location: ${mapUrl(currentLocation)}`,
        });
        if (!isCurrentSession()) return;
        setNotificationStatus(
          response.sent
            ? `Trusted contacts notified: ${response.notifiedCount}`
            : response.error || 'Trusted contact SMS provider is not configured.',
        );
      } else if (orderedContacts.length === 0) {
        setNotificationStatus('No trusted contacts saved. Add them in Contacts.');
      }

      await runConfiguredCallAction();
      if (!isCurrentSession()) return;

      if (emergencyCallMode !== 'ask' && emergencyCallMode !== 'none' && Platform.OS !== 'web') {
        setStatusMessage('Emergency mode active.');
      }
    } catch (error) {
      setCountdownEnabled(false);
      setBrowserMediaCaptureActive(false);
      setCameraActive(false);
      setCameraMounted(false);
      releaseBrowserMediaStreams();
      scheduleBrowserMediaRelease();
      activationStarted.current = false;
      resolveEmergency();
      setPhase('error');
      setStatusMessage(error instanceof Error ? error.message : 'Emergency activation failed.');
    }
  }, [
    audioRecorder,
    audioAutoRecord,
    cameraAutoRecord,
    consumePendingResume,
    contacts,
    emergencyCallMode,
    ensurePermissions,
    remountCameraAndWaitReady,
    resetCameraReadyGate,
    resolveEmergency,
    runConfiguredCallAction,
    setEmergencyId,
    startAndroidCapture,
    triggerEmergency,
    waitForCameraReady,
  ]);

  useEffect(() => {
    if (!countdownEnabled || phase !== 'countdown') return;
    if (count <= 0) { activateEmergency(); return; }
    const t = setTimeout(() => setCount((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [activateEmergency, count, countdownEnabled, phase]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#070817" />

      {phase === 'countdown' ? (
        <View style={styles.countdownWrap} testID="emergency-countdown-screen" accessible accessibilityLabel="emergency-countdown-screen">
          <View style={styles.countdownCard}>
            <Text style={styles.countdownLabel}>Emergency activates in</Text>
            <Text style={styles.countdownNumber} testID="emergency-countdown-number" accessibilityLabel="emergency-countdown-number">{count}</Text>
            <Text style={styles.countdownText}>
              {[
                cameraAutoRecord && 'Camera',
                audioAutoRecord && 'Audio',
                'GPS',
                'trusted contact alerts',
                emergencyCallMode === 'priority' && 'a call to your priority contact',
                emergencyCallMode === 'contacts' && 'calls to your trusted contacts',
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              will start automatically. Calling {EMERGENCY_NUMBER} always needs a manual tap.
            </Text>
            <TouchableOpacity activeOpacity={0.82} style={styles.cancelBtn} onPress={returnHome} testID="emergency-cancel-btn" accessibilityLabel="emergency-cancel-btn">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.liveLayout} testID="emergency-live-screen" accessible accessibilityLabel="emergency-live-screen">
          <View style={styles.topRow}>
            <View style={styles.topBar}>
              <View style={styles.recDot} />
              <Text style={styles.recLabel} testID="emergency-rec-label" accessibilityLabel="emergency-rec-label">
                {phase === 'recording' ? `LIVE ${fmt(elapsed)}` : 'ACTIVATING'}
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.82} style={styles.exitBtn} onPress={returnHome} testID="emergency-exit-btn" accessibilityLabel="emergency-exit-btn">
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </View>

          {cameraAutoRecord && (
            <View style={[styles.cameraPanel, { width: previewWidth, height: previewHeight }]} testID="emergency-camera-panel" accessible accessibilityLabel="emergency-camera-panel">
              {isCapturingPhase(phase) && cameraMounted ? (
                <>
                  {USE_ANDROID_BACKGROUND_CAMERA && BackgroundCameraPreviewView ? (
                    // Displays the live feed from BackgroundCameraService's
                    // own Preview use case (bound to the service's
                    // lifecycle, not this component's) — (re)mounting this
                    // just reconnects to whatever session is already
                    // running, it never starts a second camera binding.
                    <BackgroundCameraPreviewView
                      style={styles.cameraPreview}
                      testID="emergency-camera-view"
                      accessibilityLabel="emergency-camera-view"
                    />
                  ) : (
                    <CameraView
                      key={cameraSessionKey}
                      ref={cameraRef}
                      active={cameraActive}
                      style={styles.cameraPreview}
                      facing={facing}
                      mode="video"
                      mute={false}
                      testID="emergency-camera-view"
                      accessibilityLabel="emergency-camera-view"
                      onCameraReady={handleCameraReady}
                      onMountError={(e) => setStatusMessage(e.message || 'Camera preview could not start.')}
                    />
                  )}
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={styles.flipCameraBtn}
                    onPress={flipCamera}
                    disabled={cameraSwitching}
                    testID="emergency-flip-camera-btn"
                    accessibilityLabel="emergency-flip-camera-btn"
                  >
                    <Text style={styles.flipCameraIcon}>⟲</Text>
                  </TouchableOpacity>
                  {cameraSwitching && (
                    <View
                      style={styles.switchingOverlay}
                      testID="emergency-camera-switching"
                      accessible
                      accessibilityLabel="emergency-camera-switching"
                    >
                      <Text style={styles.switchingText}>Switching camera…</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.cameraFallback} testID="emergency-camera-fallback" accessible accessibilityLabel="emergency-camera-fallback">
                  <Text style={styles.cameraFallbackText}>
                    {cameraPermission?.status === 'denied'
                      ? 'Camera blocked in setup'
                      : 'Camera not enabled during setup'}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.statusPanel}>
            <Text style={styles.statusText} testID="emergency-status-text" accessibilityLabel="emergency-status-text">{statusMessage}</Text>
            {notificationStatus && <Text style={styles.notificationText}>{notificationStatus}</Text>}
            {location ? (
              <Text style={styles.locationText} testID="emergency-gps-text" accessibilityLabel="emergency-gps-text">
                GPS {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
              </Text>
            ) : locationUnavailable ? (
              <Text style={styles.locationUnavailableText} testID="emergency-gps-unavailable-text" accessibilityLabel="emergency-gps-unavailable-text">
                GPS unavailable
              </Text>
            ) : null}
          </View>

          {location ? (
            <LiveLocationMap latitude={location.latitude} longitude={location.longitude} />
          ) : locationUnavailable ? (
            <View style={styles.mapFallback} testID="emergency-map-fallback" accessible accessibilityLabel="emergency-map-fallback">
              <Text style={styles.mapFallbackText}>
                Location unavailable — your emergency contacts were still alerted.
              </Text>
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.mapFallbackBtn}
                onPress={() => {
                  Alert.alert(
                    'Location Access Required',
                    'Bes needs location access to share your position. Open Settings to enable it.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Open Settings', onPress: () => Linking.openSettings() },
                    ],
                  );
                }}
                testID="emergency-map-fallback-settings-btn"
                accessibilityLabel="emergency-map-fallback-settings-btn"
              >
                <Text style={styles.mapFallbackBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.controls}>
            <TouchableOpacity activeOpacity={0.82} style={styles.actionBtn} onPress={confirmCallEmergencyNumber} testID="emergency-call911-btn" accessibilityLabel="emergency-call911-btn">
              <Text style={styles.actionIcon}>!</Text>
              <Text style={styles.actionLabel}>Call {EMERGENCY_NUMBER}</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.stopBtn]} onPress={returnHome} testID="emergency-stop-btn" accessibilityLabel="emergency-stop-btn">
              <View style={styles.stopSquare} />
              <Text style={styles.actionLabel}>Stop</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.contactBtn]} onPress={callPriorityContact}>
              <Text style={styles.actionIcon}>C</Text>
              <Text style={styles.actionLabel}>{callTargetContact ? callTargetContact.name : 'Contact'}</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.allContactsBtn]} onPress={callAllContacts}>
              <Text style={styles.actionIcon}>A</Text>
              <Text style={styles.actionLabel}>All Contacts</Text>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.videoBtn]} onPress={facetimePriorityContact}>
              <Text style={styles.actionIcon}>F</Text>
              <Text style={styles.actionLabel}>FaceTime</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070817' },
  countdownWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 18 },
  countdownCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 14, 35, 0.96)',
    borderColor: '#ef445b',
    borderRadius: 24,
    borderWidth: 2,
    maxWidth: 360,
    padding: 28,
    width: '100%',
  },
  countdownLabel: { color: '#f2d9df', fontSize: 15, fontWeight: '800' },
  countdownNumber: { color: '#ef445b', fontSize: 88, fontWeight: '900', lineHeight: 100, marginVertical: 8 },
  countdownText: { color: '#d8d3e8', fontSize: 14, lineHeight: 21, marginBottom: 22, textAlign: 'center' },
  cancelBtn: { alignItems: 'center', backgroundColor: '#282c43', borderRadius: 24, paddingHorizontal: 34, paddingVertical: 13 },
  cancelText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  liveLayout: { alignItems: 'center', flex: 1, gap: 16, padding: 16 },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', maxWidth: 720, width: '100%', zIndex: 5 },
  topBar: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.66)', borderRadius: 20, flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  recDot: { backgroundColor: '#ef445b', borderRadius: 5, height: 10, width: 10 },
  recLabel: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  exitBtn: { backgroundColor: '#2b2f43', borderColor: '#555b73', borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  exitText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  cameraPanel: { backgroundColor: '#000', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  cameraPreview: { height: '100%', width: '100%' },
  cameraFallback: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 18 },
  cameraFallbackText: { color: '#a8a0bf', fontSize: 13, fontWeight: '700' },
  flipCameraBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    width: 44,
  },
  flipCameraIcon: { color: '#fff', fontSize: 22, fontWeight: '900' },
  switchingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  switchingText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  statusPanel: { backgroundColor: 'rgba(0,0,0,0.56)', borderColor: 'rgba(255,255,255,0.14)', borderRadius: 16, borderWidth: 1, maxWidth: 520, padding: 12, width: '100%' },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  notificationText: { color: '#f7ca75', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  locationText: { color: '#4ee1d5', fontSize: 12, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  locationUnavailableText: { color: '#f7ca75', fontSize: 12, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  mapFallback: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    justifyContent: 'center',
    maxWidth: 400,
    padding: 18,
    width: '100%',
  },
  mapFallbackText: { color: '#a8a0bf', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  mapFallbackBtn: { backgroundColor: 'rgba(239,68,91,0.18)', borderColor: '#ef445b', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 20, paddingVertical: 10 },
  mapFallbackBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 620, width: '100%', zIndex: 5 },
  actionBtn: { alignItems: 'center', backgroundColor: 'rgba(239,68,91,0.18)', borderColor: '#ef445b', borderRadius: 14, borderWidth: 1.5, gap: 4, justifyContent: 'center', minHeight: 58, minWidth: 132, paddingHorizontal: 16, paddingVertical: 10 },
  stopBtn: { backgroundColor: 'rgba(100,100,100,0.28)', borderColor: '#777' },
  contactBtn: { backgroundColor: 'rgba(245,158,11,0.18)', borderColor: '#f59e0b' },
  allContactsBtn: { backgroundColor: 'rgba(78,225,213,0.14)', borderColor: '#4ee1d5' },
  videoBtn: { backgroundColor: 'rgba(74,168,255,0.18)', borderColor: '#4aa8ff' },
  stopSquare: { backgroundColor: '#fff', borderRadius: 4, height: 18, width: 18 },
  actionIcon: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 22 },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
});
