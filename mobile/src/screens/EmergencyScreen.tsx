import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import EmergencyTourDemo from './EmergencyTourDemo';
import { SafeAreaView } from 'react-native-safe-area-context';

import LiveLocationMap from '../components/LiveLocationMap';
import { useEmergencyContext } from '../context/EmergencyContext';
import {
  requestCameraPermission as requestCameraPermissionCore,
  requestMicrophonePermission as requestMicrophonePermissionCore,
} from '../services/corePermissions';
import { getExistingOnboardingVariant } from '../services/experiments';
import { COUNTDOWN_SECONDS, EMERGENCY_NUMBER, ENABLE_EMERGENCY_DIALER } from '../config/emergencyConfig';
import {
  callEmergencyContacts,
  getLiveViewStatus,
  revokeLiveView,
  rotateLiveView,
  shareLiveView,
  updateEmergency,
  type LiveViewLinkStatus,
} from '../services/emergencyService';
import { describeSmsResult } from '../utils/smsStatus';
import {
  enqueueClip,
  releaseRetainedClips,
  resumeClipQueue,
  retainClipsFor,
  runClipQueue,
  waitForClipAttempt,
  type ClipOutcome,
} from '../services/segmentQueue';
import { formatMegabytes, getFreeBytes, shouldRecordVideo, storageLevel } from '../services/storageMonitor';
import { clearInProgressEmergency, useAppStateEmergencyGuard } from '../hooks/useAppStateEmergencyGuard';
import { mapUrl } from '../utils/mapUrl';
import type { Contact } from '../types/contact';
import {
  listConnections,
  type SocialConnection,
  type SocialProvider,
  type SocialShareResult,
} from '../services/socialSharingService';
import { createShareSegmentResolver } from '../services/shareSegment';
import SocialShareOverlay from '../components/SocialShareOverlay';
import SocialSetupNote, { type SocialSetupState } from '../components/SocialSetupNote';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { trackEvent } from '../services/analyticsService';
import { setRemindAfterEmergency } from '../services/socialSharingPrompts';
import { claimForEmergency } from '../features/threatMonitor/services/CameraOwnershipService';

const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = { tiktok: 'TikTok', instagram: 'Instagram' };

type CameraFacing = 'front' | 'back';

type VideoSegmentInfo = {
  facing: CameraFacing;
  sequence: number;
  startedAt: string;
  finalized: boolean;
  // recordAsync attempts for this segment (a start can fail right after a
  // camera remount — see beginSegmentRecording).
  startAttempts?: number;
};

// Starting a recording right after a remount can fail natively ("could not
// create video file") even after onCameraReady. Retry on the same camera
// this many times before falling back to a full restart.
const MAX_START_ATTEMPTS = 3;
const START_RETRY_MS = 750;
// Remounts tried when the camera preview fails to start (e.g. still held).
const CAMERA_MOUNT_RETRIES = 3;
const CAMERA_MOUNT_RETRY_MS = 750;

// In-session view of a finished segment (the social-share resolver reads
// these). The durable upload itself is owned by segmentQueue.ts: the clip is
// stored safely on the device, uploaded in the background with retries
// (including after a restart), and its local file kept until the server
// confirms it. `status` mirrors the most recent upload attempt.
type PendingSegmentUpload = {
  segment: VideoSegmentInfo;
  localUri: string;
  endedAt: string;
  clipId?: string;
  status: 'pending' | 'done' | 'failed';
  promise?: Promise<void>;
};

// Video is cut into clips so evidence reaches the server DURING the
// emergency: every 30s when Live View is on (near-live for contacts),
// otherwise every 120s. Always on — not gated by Live View.
const LIVE_VIEW_SEGMENT_MS = 30_000;
const DEFAULT_SEGMENT_MS = 120_000;
// expo-camera's hard cap per recording. If it's ever reached, recording
// restarts automatically (it used to silently stop at 5 minutes).
const MAX_SEGMENT_SECONDS = 300;
const SEGMENT_CHECK_MS = 5_000;
const LIVE_VIEW_POLL_MS = 20_000;

function trackAttempt(entry: PendingSegmentUpload) {
  let settle: () => void = () => {};
  entry.status = 'pending';
  entry.promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return (outcome: ClipOutcome) => {
    entry.status = outcome === 'confirmed' ? 'done' : 'failed';
    settle();
  };
}

function queueSegmentEntry(emergencyId: string, entry: PendingSegmentUpload) {
  const onOutcome = trackAttempt(entry);
  enqueueClip(
    {
      kind: 'video',
      emergencyId,
      sequence: entry.segment.sequence,
      facing: entry.segment.facing,
      startedAt: entry.segment.startedAt,
      endedAt: entry.endedAt,
      sourceUri: entry.localUri,
    },
    onOutcome,
  )
    .then((record) => {
      entry.clipId = record.id;
      entry.localUri = record.localUri;
    })
    .catch((error) => {
      console.warn('Could not queue video segment', error);
      onOutcome('failed');
    });
}

// Retry requested by the share resolver: wake the queue now and report the
// outcome of the next attempt.
function retrySegmentEntry(entry: PendingSegmentUpload) {
  if (!entry.clipId) return Promise.resolve();
  const onOutcome = trackAttempt(entry);
  void waitForClipAttempt(entry.clipId).then(onOutcome);
  void resumeClipQueue();
  return entry.promise!;
}

// NOTE: This screen's layout (countdown/activating/recording/error states) was
// authored and only verified in portrait. The app's hard portrait lock was
// removed from app.json (2026-09) to satisfy Play Console's static manifest
// scan; targetSdk 36's large-screen policy already overrode/ignored the lock
// on large screens regardless. Landscape/large-screen layout on this specific
// screen is unverified — follow-up, not a blocker.
type EmergencyPhase = 'countdown' | 'activating' | 'recording' | 'error';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_CAMERA_FACING: CameraFacing = Platform.OS === 'web' ? 'front' : 'back';

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

function phoneUrlTarget(phone: string) {
  return phone.replace(/[^\d+]/g, '');
}

function isCapturingPhase(phase: EmergencyPhase) {
  return phase === 'activating' || phase === 'recording';
}

function EmergencyLiveScreen() {
  const navigation = useNavigation<any>();
  const { width, height } = useWindowDimensions();
  // Short phones (e.g. 360x720dp) couldn't fit the whole live layout: the
  // last rows of actions (Contact, FaceTime, Share) fell off-screen with no
  // way to scroll to them. Compact sizing makes every action fit on typical
  // phones; the ScrollView below guarantees they're reachable on any screen.
  const compact = height < 800;
  const {
    orderedContacts,
    priorityContact,
    emergencyId,
    setEmergencyId,
    triggerEmergency,
    resolveEmergency,
    emergencySettings,
    runCoreActivation,
    stopAudioCapture,
    stopLocationWatch,
  } = useEmergencyContext();

  const {
    cameraAutoRecord,
    audioAutoRecord,
    emergencyCallMode,
  } = emergencySettings;

  const cameraRef = useRef<CameraView>(null);
  // Only the reactive status is used here — the request functions the hooks
  // also return are ignored; requests go through corePermissions.ts's
  // disclosure-wrapped versions instead (see ensurePermissions below).
  const [cameraPermission] = useCameraPermissions();
  const [micPermission] = useMicrophonePermissions();

  const [phase, setPhase] = useState<EmergencyPhase>('countdown');
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Emergency activation starting.');
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  // Voice-call outcome gets its own line: it used to share notificationStatus
  // with the SMS result, which arrives later and overwrote it.
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const [facing, setFacing] = useState<CameraFacing>(DEFAULT_CAMERA_FACING);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [reducedVideoQuality, setReducedVideoQuality] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [liveViewEnabled, setLiveViewEnabled] = useState(false);
  const [liveViewLinks, setLiveViewLinks] = useState<LiveViewLinkStatus[]>([]);
  const [liveViewBusy, setLiveViewBusy] = useState(false);

  const activationStarted = useRef(false);
  const sessionRef = useRef(0);
  const stopping = useRef(false);
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
  // Continuous recording: periodic segment cuts, the maxDuration restart,
  // and the low-storage pause/resume (see runSegmentCheck).
  const segmentIntervalMsRef = useRef(DEFAULT_SEGMENT_MS);
  const segmentCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentCheckBusyRef = useRef(false);
  const videoPausedForStorageRef = useRef(false);
  const activationStartedAtRef = useRef<string>(new Date().toISOString());
  const facingRef = useRef<CameraFacing>(DEFAULT_CAMERA_FACING);
  facingRef.current = facing;

  const previewWidth = Math.min(width - 32, 420);
  const previewHeight = Math.round(previewWidth * (compact ? 0.42 : 0.56));
  const callTargetContact = priorityContact ?? orderedContacts[0] ?? null;

  useAppStateEmergencyGuard({ emergencyId, phase, elapsed });

  // Only providers that are both connected and enabled for emergency sharing
  // are offered here. Reloaded at every activation (and on a Share tap with
  // nothing loaded): this tab stays mounted for the whole app session, so a
  // load done once at mount went stale when an account was connected later
  // in Settings, or when that first request failed — and the prompt and
  // Share button then never appeared until the app was restarted.
  const [shareableProviders, setShareableProviders] = useState<SocialConnection[]>([]);
  const [shareOpenRequest, setShareOpenRequest] = useState(0);
  const [sharedTo, setSharedTo] = useState<SocialProvider[]>([]);
  const allConnectionsRef = useRef<SocialConnection[]>([]);
  // null until a load succeeds — a failed load never produces a message.
  const [allConnections, setAllConnections] = useState<SocialConnection[] | null>(null);
  const refreshShareableProviders = useCallback(async () => {
    try {
      const result = await listConnections();
      allConnectionsRef.current = result.connections;
      setAllConnections(result.connections);
      const shareable = result.connections.filter((c) => c.status === 'connected' && c.enabledForEmergency);
      setShareableProviders(shareable);
      return shareable;
    } catch {
      return null;
    }
  }, []);

  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const [setupNoteDismissed, setSetupNoteDismissed] = useState(false);
  const setupNoteTrackedRef = useRef(false);
  // Why sharing isn't available right now (null = available, unknown, or the
  // user deliberately switched it off — nothing to say).
  const sharingSetupState = useMemo<SocialSetupState | null>(() => {
    if (allConnections === null || shareableProviders.length > 0) return null;
    if (allConnections.some((c) => ['reauth_required', 'error', 'revoked'].includes(c.status))) return 'reconnect_needed';
    if (allConnections.some((c) => c.status === 'connected' && !c.enabledForEmergency)) return null;
    return isPremium ? 'not_connected' : 'premium_required';
  }, [allConnections, isPremium, shareableProviders.length]);

  const remindAfterEmergency = useCallback(() => {
    trackEvent('social_setup_note_remind', { state: sharingSetupState });
    setSetupNoteDismissed(true);
    if (user?.id) void setRemindAfterEmergency(user.id);
  }, [sharingSetupState, user?.id]);
  useEffect(() => {
    void refreshShareableProviders();
  }, [refreshShareableProviders]);

  // Fully isolated from the activation pipeline, same shape as
  // callPriorityContact/facetimePriorityContact: never calls or is called by
  // runCoreActivation/triggerEmergency/resolveEmergency. The button this is
  // wired to only renders once `emergencyId` is set (see the controls row
  // below), so this can never run before activation has happened. Posting
  // itself happens in SocialShareOverlay, behind an explicit review step.
  const shareToSocial = useCallback(async () => {
    let shareable: SocialConnection[] | null = shareableProviders;
    if (shareable.length === 0) shareable = await refreshShareableProviders();
    if (shareable && shareable.length > 0) {
      setShareOpenRequest((v) => v + 1);
      return;
    }
    if (shareable === null) {
      Alert.alert('Sharing unavailable', 'Could not check your connected accounts. Check your connection and try again. Recording continues.');
      return;
    }
    // Say exactly why nothing can be shared. Never navigates or shows a
    // paywall mid-emergency — "Remind me after" brings it up on Home later.
    const all = allConnectionsRef.current;
    const label = (c: SocialConnection) => SOCIAL_PROVIDER_LABELS[c.provider];
    const needsReconnect = all.filter((c) => c.status === 'reauth_required' || c.status === 'error' || c.status === 'revoked');
    const turnedOff = all.filter((c) => c.status === 'connected' && !c.enabledForEmergency);
    const buttons = [
      { text: 'OK', style: 'cancel' as const },
      { text: 'Remind me after', onPress: remindAfterEmergency },
    ];
    if (needsReconnect.length > 0) {
      Alert.alert('Reconnect needed', `Reconnect ${needsReconnect.map(label).join(' and ')} in Settings → Social Sharing to share emergency video. Recording continues.`, buttons);
    } else if (turnedOff.length > 0) {
      Alert.alert('Emergency sharing is off', `Turn on emergency sharing for ${turnedOff.map(label).join(' and ')} in Settings → Social Sharing.`);
    } else if (!isPremium) {
      Alert.alert('Premium feature', 'Sharing emergency video to TikTok or Instagram is part of Bes Premium. Recording continues.', buttons);
    } else {
      Alert.alert('Not connected', 'Connect TikTok or Instagram in Settings → Social Sharing to share emergency video. Recording continues.', buttons);
    }
  }, [isPremium, refreshShareableProviders, remindAfterEmergency, shareableProviders]);

  // A share that failed because the account needs reconnecting: reload so the
  // note switches to "reconnect", even if an earlier note was dismissed.
  const handleShareResult = useCallback((result: { code?: string }) => {
    if (result.code !== 'reauth_required') return;
    setSetupNoteDismissed(false);
    void refreshShareableProviders();
  }, [refreshShareableProviders]);

  const handleShared = useCallback((result: SocialShareResult) => {
    if (result.status === 'posted') {
      setSharedTo((prev) => (prev.includes(result.provider) ? prev : [...prev, result.provider]));
    } else if (result.status === 'processing') {
      setStatusMessage(`${SOCIAL_PROVIDER_LABELS[result.provider]} is still processing the video.`);
    }
  }, []);

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

  // The camera can be briefly unavailable (e.g. the AI Monitor is still
  // letting go of it). Remount a few times before giving up; the ready gate
  // is left as is, so the start flow's bounded wait still resolves on the
  // retried mount.
  const mountRetriesRef = useRef(0);
  const handleMountError = useCallback((message?: string) => {
    if (mountRetriesRef.current < CAMERA_MOUNT_RETRIES) {
      mountRetriesRef.current += 1;
      setTimeout(() => setCameraSessionKey((v) => v + 1), CAMERA_MOUNT_RETRY_MS);
      return;
    }
    setStatusMessage(message || 'Camera preview could not start.');
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

  // Every finished segment goes to the durable queue — whether we cut it
  // (flip, timer, share, exit) or the camera stopped on its own.
  const queueFinishedSegment = (segment: VideoSegmentInfo, uri: string) => {
    const emergencyId = activeEmergencyIdRef.current;
    const entry: PendingSegmentUpload = {
      segment,
      localUri: uri,
      endedAt: new Date().toISOString(),
      status: 'pending',
    };
    pendingSegmentUploadsRef.current.push(entry);
    if (emergencyId) {
      queueSegmentEntry(emergencyId, entry);
    } else {
      entry.status = 'failed';
    }
  };

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
    queueFinishedSegment(segment, uri);
  }, []);

  const stopEmergencyAssets = useCallback(async () => {
    sessionRef.current += 1;
    activationStarted.current = false;
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
      if (segmentCheckTimerRef.current) {
        clearInterval(segmentCheckTimerRef.current);
        segmentCheckTimerRef.current = null;
      }

      stopLocationWatch();

      // Finalizes whatever the current video segment is (idempotent — a
      // no-op if a concurrent flip already finalized it) and queues its
      // upload before continuing.
      await finalizeCurrentSegment();

      try { await Promise.race([cameraRef.current?.pausePreview?.() ?? Promise.resolve(), wait(500)]); } catch {}
      audioUri = await stopAudioCapture();

      cameraRef.current = null;
    } finally {
      stopping.current = false;
      scheduleBrowserMediaRelease();
    }

    clearInProgressEmergency().catch(() => {});

    const emergencyIdForUpload = activeEmergencyIdRef.current;
    activeEmergencyIdRef.current = null;
    // Best-effort, like the uploads below: without this the server kept
    // every past emergency as ACTIVE forever (Evidence showed them all as
    // still active). Status is display-only server-side.
    if (emergencyIdForUpload) {
      updateEmergency(emergencyIdForUpload, { status: 'RESOLVED' }).catch(() => {});
    }
    if (emergencyIdForUpload && audioUri) {
      // Same durable queue as video: kept on the device until uploaded.
      enqueueClip({
        kind: 'audio',
        emergencyId: emergencyIdForUpload,
        startedAt: activationStartedAtRef.current,
        endedAt: new Date().toISOString(),
        sourceUri: audioUri,
      }).catch((error) => console.warn('Could not queue emergency audio', error));
    }

    // Exit never waits on the network: queued clips keep uploading in the
    // background (and after a restart). Clips the server already confirmed
    // are no longer needed on the device.
    pendingSegmentUploadsRef.current = [];
    videoPausedForStorageRef.current = false;
    if (emergencyIdForUpload) void releaseRetainedClips(emergencyIdForUpload);
    void runClipQueue();
  }, [finalizeCurrentSegment, resolveEmergency, stopAudioCapture, stopLocationWatch]);

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
    setCallStatus(null);
    setStorageNotice(null);
    setLiveViewEnabled(false);
    setLiveViewLinks([]);
    setEmergencyId(null);
    await stopEmergencyAssets();
    navigation.navigate('Home');
  }, [navigation, setEmergencyId, stopEmergencyAssets]);

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
      setCallStatus(null);
      setStatusMessage('Emergency activation starting.');
      setCameraActive(false);
      setCameraMounted(false);
      return () => { stopEmergencyAssets(); };
    }, [setEmergencyId, stopEmergencyAssets]),
  );

  // Returns { cameraOk, audioOk } — never throws.
  // Camera/audio denial is non-fatal: emergency continues with GPS only.
  // Requests are routed through corePermissions.ts (disclosure-wrapped) —
  // this is the primary ask for anyone in the contextual-onboarding variant
  // (or anyone who skipped/declined during onboarding), not just a fallback.
  const ensurePermissions = useCallback(async (): Promise<{ cameraOk: boolean; audioOk: boolean }> => {
    let cameraOk = Boolean(cameraPermission?.granted);
    let audioOk = Boolean(micPermission?.granted);
    const variant = await getExistingOnboardingVariant().catch(() => null);

    // Request at emergency time if not yet granted (e.g. user skipped Setup,
    // or is in the contextual variant where nothing was asked upfront).
    if (cameraAutoRecord && !cameraOk) {
      try {
        const status = await requestCameraPermissionCore({ context: 'emergency_activation', variant: variant ?? undefined });
        cameraOk = status === 'granted';
      } catch { cameraOk = false; }
    }
    if (audioAutoRecord && !audioOk) {
      try {
        const status = await requestMicrophonePermissionCore({ context: 'emergency_activation', variant: variant ?? undefined });
        audioOk = status === 'granted';
      } catch { audioOk = false; }
    }

    return {
      cameraOk: cameraAutoRecord && cameraOk,
      audioOk: audioAutoRecord && audioOk,
    };
  }, [cameraAutoRecord, audioAutoRecord, cameraPermission, micPermission]);

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

    // No canOpenURL pre-check: on Android 11+ it reports false for tel:
    // without a manifest <queries> entry, even though the dialer opens fine.
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      setStatusMessage(unavailableMessage);
      return false;
    }
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
        setCallStatus(
          response.calledCount === contactsToCall.length
            ? `Voice call started for ${label}.`
            : `Voice calls started for ${response.calledCount}/${contactsToCall.length} contacts.`,
        );
        return true;
      }

      setCallStatus(response.error ? `Call failed: ${response.error}` : 'Voice call provider is not configured.');
      return false;
    } catch {
      setCallStatus('Could not start a server-side voice call.');
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
  //
  // cutToNewSegment is that whole sequence; flipCamera passes the opposite
  // facing, requestShareSegmentCut passes the same facing (a forced cut
  // with no visible flip — still the same brief recording gap).
  // inPlace: a routine same-camera cut (timer / maxDuration). The next
  // recording starts on the SAME camera instance — remounting re-binds the
  // camera, and a recording started during that re-bind can silently produce
  // no data. Flips and recovery still remount.
  const cutToNewSegment = useCallback(async (newFacing: CameraFacing, { inPlace = false }: { inPlace?: boolean } = {}) => {
    if (!cameraMounted || flippingRef.current || emergencyStoppingRef.current) return;
    flippingRef.current = true;
    const generation = captureGenerationRef.current;
    const remount = !inPlace || newFacing !== facingRef.current;
    if (remount) setCameraSwitching(true);

    try {
      // 1-2: finalize whatever's currently recording, queue its upload.
      await finalizeCurrentSegment();
      if (emergencyStoppingRef.current || generation !== captureGenerationRef.current) return;

      if (remount) {
        // 3: set facing (unchanged for a share cut).
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
      }

      // 5: start the next segment's recording.
      const sequence = sequenceCounterRef.current + 1;
      sequenceCounterRef.current = sequence;
      beginSegmentRecordingRef.current({
        facing: newFacing,
        sequence,
        startedAt: new Date().toISOString(),
        finalized: false,
      });
    } finally {
      flippingRef.current = false;
      if (remount) setCameraSwitching(false);
    }
  }, [cameraMounted, finalizeCurrentSegment, remountCameraAndWaitReady]);

  // Starts recording one segment. If the camera ends it by itself
  // (maxDuration, or the OS stopping it) — i.e. nobody finalized it — the clip
  // is queued and recording continues in a new segment.
  const beginSegmentRecording = (segment: VideoSegmentInfo) => {
    currentSegmentRef.current = segment;
    segment.startAttempts = (segment.startAttempts ?? 0) + 1;
    const recordingPromise = cameraRef.current?.recordAsync({ maxDuration: MAX_SEGMENT_SECONDS });
    videoRecordingPromiseRef.current = recordingPromise ?? null;
    const isCurrent = () => !segment.finalized && currentSegmentRef.current === segment && !emergencyStoppingRef.current;
    const retryStart = () => {
      // Recording failed to start (or died) — never sit idle until the next
      // scheduled cut. Retry on this camera, then fall back to a full restart.
      if (!isCurrent()) return;
      if ((segment.startAttempts ?? 0) < MAX_START_ATTEMPTS) {
        setTimeout(() => {
          if (isCurrent()) beginSegmentRecordingRef.current({ ...segment, startedAt: new Date().toISOString() });
        }, START_RETRY_MS);
        return;
      }
      segment.finalized = true;
      videoRecordingPromiseRef.current = null;
      void cutToNewSegmentRef.current(facingRef.current);
    };
    if (!recordingPromise) {
      retryStart();
      return;
    }
    recordingPromise.then(
      (result) => {
        if (!isCurrent()) return;
        if (!result?.uri) {
          retryStart();
          return;
        }
        // Ended by itself (maxDuration or the OS) — queue it, keep recording.
        segment.finalized = true;
        videoRecordingPromiseRef.current = null;
        queueFinishedSegment(segment, result.uri);
        void cutToNewSegmentRef.current(facingRef.current, { inPlace: true });
      },
      (error) => {
        console.warn(`Segment ${segment.sequence} recording failed to start — retrying`, error);
        retryStart();
      },
    );
  };
  const beginSegmentRecordingRef = useRef(beginSegmentRecording);
  beginSegmentRecordingRef.current = beginSegmentRecording;
  const cutToNewSegmentRef = useRef(cutToNewSegment);
  cutToNewSegmentRef.current = cutToNewSegment;

  const describeStorage = (free: number | null) => {
    const level = storageLevel(free);
    if (level === 'ok' || free === null) return null;
    if (level === 'critical') return `Storage almost full (${formatMegabytes(free)} left) — video paused. Audio and GPS continue. Free up space to resume.`;
    if (level === 'reduced') return `Storage low (${formatMegabytes(free)} left) — recording video at lower quality.`;
    return `Storage low (${formatMegabytes(free)} left). Recordings are kept until they upload — connect to Wi-Fi or free up space.`;
  };

  // Runs every few seconds while the camera session is live: cuts a new
  // segment on schedule, applies the low-storage policy (never deleting
  // evidence), and resumes video automatically once space is back.
  const runSegmentCheck = async () => {
    if (segmentCheckBusyRef.current || emergencyStoppingRef.current || flippingRef.current) return;
    segmentCheckBusyRef.current = true;
    try {
      const free = getFreeBytes();
      setStorageNotice(describeStorage(free));
      const segment = currentSegmentRef.current;
      const recording = Boolean(segment && !segment.finalized);

      if (!shouldRecordVideo(free, videoPausedForStorageRef.current)) {
        if (recording) {
          videoPausedForStorageRef.current = true;
          await finalizeCurrentSegment();
          setStatusMessage('Storage almost full — video paused. Audio and GPS continue.');
        }
        return;
      }
      if (videoPausedForStorageRef.current) {
        videoPausedForStorageRef.current = false;
        setReducedVideoQuality(storageLevel(free) !== 'ok' && storageLevel(free) !== 'low');
        await cutToNewSegment(facingRef.current);
        setStatusMessage('Recording resumed.');
        return;
      }
      setReducedVideoQuality(storageLevel(free) === 'reduced');
      // Self-heal: video should be recording but isn't (a start that kept
      // failing, or the camera dropped it) — restart now.
      if (!recording) {
        await cutToNewSegment(facingRef.current);
        return;
      }
      if (segment && Date.now() - Date.parse(segment.startedAt) >= segmentIntervalMsRef.current) {
        await cutToNewSegment(facingRef.current, { inPlace: true });
      }
    } finally {
      segmentCheckBusyRef.current = false;
    }
  };
  const runSegmentCheckRef = useRef(runSegmentCheck);
  runSegmentCheckRef.current = runSegmentCheck;

  const flipCamera = useCallback(
    () => cutToNewSegment(facing === 'back' ? 'front' : 'back'),
    [cutToNewSegment, facing],
  );

  // Only ever called by the share resolver below, and only when there is no
  // uploaded, uploading, or retryable segment to use instead. If a flip is
  // already in progress, that flip is itself producing a segment — wait for
  // it rather than cutting again.
  const requestShareSegmentCut = useCallback(async () => {
    if (flippingRef.current) {
      for (let i = 0; i < 40 && flippingRef.current; i += 1) await wait(250);
      return;
    }
    await cutToNewSegment(facing);
  }, [cutToNewSegment, facing]);

  // The resolver is created once and reads everything through refs, so the
  // one-in-flight dedupe it provides survives re-renders.
  const requestShareSegmentCutRef = useRef(requestShareSegmentCut);
  requestShareSegmentCutRef.current = requestShareSegmentCut;
  const resolveShareSegment = useMemo(
    () =>
      createShareSegmentResolver<PendingSegmentUpload>({
        getEntries: () => pendingSegmentUploadsRef.current,
        isStopping: () => emergencyStoppingRef.current,
        requestCut: () => requestShareSegmentCutRef.current(),
        retryUpload: (entry) => retrySegmentEntry(entry),
      }),
    [],
  );

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
    segmentIntervalMsRef.current = DEFAULT_SEGMENT_MS;
    videoPausedForStorageRef.current = false;
    activationStartedAtRef.current = new Date().toISOString();
    setReducedVideoQuality(false);
    setStorageNotice(null);
    setLiveViewEnabled(false);
    setLiveViewLinks([]);
    setFacing(DEFAULT_CAMERA_FACING);
    setSharedTo([]);
    setSetupNoteDismissed(false);
    setupNoteTrackedRef.current = false;
    void refreshShareableProviders();

    triggerEmergency();

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
          // Emergency always gets the camera: the AI Monitor (if running)
          // releases it first; this waits at most ~1 s and never throws.
          await claimForEmergency();
          if (!isCurrentSession()) return;
          mountRetriesRef.current = 0;
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

      // GPS acquisition, emergency creation, and audio start are the shared
      // core (EmergencyContext.runCoreActivation) — the same implementation
      // Hidden SOS uses headlessly. Video capture stays entirely here since
      // it needs this screen's own mounted CameraView.
      const result = await runCoreActivation({
        startAudio: audOk,
        onStatus: setStatusMessage,
        onLocationUpdate: (loc) => {
          currentLocationRef.current = loc;
          setLocation(loc);
          if (!loc) setLocationUnavailable(true);
        },
        onNotifyResult: (response) => {
          if (!isCurrentSession()) return;
          setNotificationStatus(describeSmsResult(response));
        },
      });
      if (!isCurrentSession()) {
        // Exited while the create request was in flight: stopEmergencyAssets
        // never saw this id, so close it out here rather than leave an
        // orphaned ACTIVE event in the user's Evidence history.
        if (result.ok) updateEmergency(result.emergencyId, { status: 'RESOLVED' }).catch(() => {});
        return;
      }

      if (result.ok) {
        activeEmergencyIdRef.current = result.emergencyId;
        // Keep this emergency's uploaded clips on the device while it's on
        // screen (the social-share preview plays them).
        retainClipsFor(result.emergencyId);
        // Live View decides the clip length; never blocks activation.
        getLiveViewStatus(result.emergencyId)
          .then((liveView) => {
            if (!isCurrentSession()) return;
            segmentIntervalMsRef.current = liveView.enabled ? LIVE_VIEW_SEGMENT_MS : DEFAULT_SEGMENT_MS;
            setLiveViewEnabled(liveView.enabled);
            setLiveViewLinks(liveView.links);
          })
          .catch(() => {});
      } else {
        setNotificationStatus('Backend event failed — recording and dialer still active.');
      }
      if (orderedContacts.length === 0) {
        setNotificationStatus('No trusted contacts saved. Add them in Contacts.');
      }

      if (camOk) {
        setStatusMessage('Starting video recording.');
        let ready = await waitForCameraReady();
        if (!isCurrentSession()) return;
        if (!ready) {
          ready = await remountCameraAndWaitReady();
          if (!isCurrentSession()) return;
        }
        if (ready) {
          const free = getFreeBytes();
          setStorageNotice(describeStorage(free));
          setReducedVideoQuality(storageLevel(free) === 'reduced');
          if (shouldRecordVideo(free, false)) {
            beginSegmentRecordingRef.current({
              facing: DEFAULT_CAMERA_FACING,
              sequence: sequenceCounterRef.current,
              startedAt: new Date().toISOString(),
              finalized: false,
            });
          } else {
            // Resumes automatically once space is available (runSegmentCheck).
            videoPausedForStorageRef.current = true;
            setStatusMessage('Storage almost full — video paused. Audio and GPS continue.');
          }
          segmentCheckTimerRef.current = setInterval(() => {
            void runSegmentCheckRef.current();
          }, SEGMENT_CHECK_MS);
        } else {
          setStatusMessage('Camera did not become ready in time — continuing without video.');
        }
      }

      recordingTimerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
      setPhase('recording');

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
    audioAutoRecord,
    cameraAutoRecord,
    orderedContacts,
    emergencyCallMode,
    ensurePermissions,
    remountCameraAndWaitReady,
    resetCameraReadyGate,
    refreshShareableProviders,
    resolveEmergency,
    runConfiguredCallAction,
    runCoreActivation,
    triggerEmergency,
    waitForCameraReady,
  ]);

  // ── Live View: private browser links for trusted contacts ─────────────
  // Only shown when the server has Live View switched on. Sharing again
  // always returns the SAME link (nobody watching is disconnected); a reset
  // is a separate, confirmed action.
  useEffect(() => {
    if (!liveViewEnabled || phase !== 'recording' || !emergencyId) return;
    const id = emergencyId;
    const timer = setInterval(() => {
      getLiveViewStatus(id)
        .then((liveView) => setLiveViewLinks(liveView.links))
        .catch(() => {});
    }, LIVE_VIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [emergencyId, liveViewEnabled, phase]);

  useEffect(() => {
    if (phase !== 'recording' || !sharingSetupState || setupNoteDismissed || setupNoteTrackedRef.current) return;
    setupNoteTrackedRef.current = true;
    trackEvent('social_setup_note_shown', { state: sharingSetupState });
  }, [phase, setupNoteDismissed, sharingSetupState]);

  const openedBy = useMemo(() => {
    const names = liveViewLinks
      .filter((link) => link.viewCount > 0)
      .map((link) => orderedContacts.find((c) => c.id === link.contactId)?.name)
      .filter(Boolean) as string[];
    return names.length > 0 ? `Live view opened by ${names.join(', ')}` : null;
  }, [liveViewLinks, orderedContacts]);

  const sendLiveView = useCallback(async (contact: Contact, reset = false) => {
    const id = activeEmergencyIdRef.current;
    if (!id || liveViewBusy) return;
    setLiveViewBusy(true);
    try {
      const link = reset ? await rotateLiveView(id, contact.id) : await shareLiveView(id, contact.id);
      await Share.share({ message: link.shareMessage });
    } catch {
      Alert.alert('Live view unavailable', 'Could not create a live view link. Calls and recording are unaffected.');
    } finally {
      setLiveViewBusy(false);
    }
  }, [liveViewBusy]);

  const confirmResetLiveView = useCallback((contact: Contact) => {
    Alert.alert(
      `Reset ${contact.name}'s link?`,
      'Anyone with the old link loses access. You can then send the new link.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset and send', style: 'destructive', onPress: () => { void sendLiveView(contact, true); } },
      ],
    );
  }, [sendLiveView]);

  const confirmStopLiveView = useCallback(() => {
    const id = activeEmergencyIdRef.current;
    if (!id) return;
    Alert.alert(
      'Stop sharing live view?',
      'Every live view link for this emergency stops working right away. Recording, GPS and calls continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop sharing',
          style: 'destructive',
          onPress: () => {
            revokeLiveView(id)
              .then(() => getLiveViewStatus(id))
              .then((liveView) => {
                setLiveViewLinks(liveView.links);
                setStatusMessage('Live view links turned off.');
              })
              .catch(() => Alert.alert('Could not stop sharing', 'Check your connection and try again.'));
          },
        },
      ],
    );
  }, []);

  useEffect(() => {
    if (!countdownEnabled || phase !== 'countdown') return;
    if (count <= 0) { activateEmergency(); return; }
    const t = setTimeout(() => setCount((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [activateEmergency, count, countdownEnabled, phase]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

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
        <View style={styles.liveRoot}>
          <ScrollView
            style={styles.liveScroll}
            contentContainerStyle={styles.liveScrollContent}
            testID="emergency-live-scroll"
          >
            <View style={[styles.liveLayout, compact && styles.liveLayoutCompact]} testID="emergency-live-screen" accessible accessibilityLabel="emergency-live-screen">
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
                      <CameraView
                        key={cameraSessionKey}
                        ref={cameraRef}
                        active={cameraActive}
                        style={styles.cameraPreview}
                        facing={facing}
                        mode="video"
                        videoQuality={reducedVideoQuality ? '480p' : undefined}
                        mute={false}
                        testID="emergency-camera-view"
                        accessibilityLabel="emergency-camera-view"
                        onCameraReady={handleCameraReady}
                        onMountError={(e) => handleMountError(e.message)}
                      />
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
                {callStatus && (
                  <Text style={styles.notificationText} testID="emergency-call-status-text" accessibilityLabel="emergency-call-status-text">
                    {callStatus}
                  </Text>
                )}
                {storageNotice && (
                  <Text style={styles.storageText} testID="emergency-storage-text" accessibilityLabel="emergency-storage-text">
                    {storageNotice}
                  </Text>
                )}
                {openedBy && (
                  <Text style={styles.sharedText} testID="emergency-live-view-opened-text" accessibilityLabel="emergency-live-view-opened-text">
                    {openedBy}
                  </Text>
                )}
                {sharedTo.length > 0 && (
                  <Text style={styles.sharedText} testID="emergency-shared-text" accessibilityLabel="emergency-shared-text">
                    ✓ Shared to {sharedTo.map((p) => SOCIAL_PROVIDER_LABELS[p]).join(' and ')}
                  </Text>
                )}
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
                <LiveLocationMap latitude={location.latitude} longitude={location.longitude} compact={compact} />
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

              {liveViewEnabled && emergencyId && orderedContacts.length > 0 && (
                <View style={styles.liveViewPanel} testID="emergency-live-view-panel" accessibilityLabel="emergency-live-view-panel">
                  <Text style={styles.liveViewTitle}>Send live view</Text>
                  <Text style={styles.liveViewHint}>
                    A private link to your video and location. Long-press a name to reset their link.
                  </Text>
                  <View style={styles.liveViewRow}>
                    {orderedContacts.map((contact) => (
                      <TouchableOpacity
                        key={contact.id}
                        activeOpacity={0.82}
                        style={styles.liveViewBtn}
                        disabled={liveViewBusy}
                        onPress={() => { void sendLiveView(contact); }}
                        onLongPress={() => confirmResetLiveView(contact)}
                        testID="emergency-live-view-send-btn"
                        accessibilityLabel={`emergency-live-view-send-${contact.name}`}
                      >
                        <Text style={styles.liveViewBtnText}>{contact.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={confirmStopLiveView}
                    testID="emergency-live-view-stop-btn"
                    accessibilityLabel="emergency-live-view-stop-btn"
                  >
                    <Text style={styles.liveViewStopText}>Stop sharing live view</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.controls}>
                <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, compact && styles.actionBtnCompact]} onPress={confirmCallEmergencyNumber} testID="emergency-call911-btn" accessibilityLabel="emergency-call911-btn">
                  <Text style={styles.actionIcon}>!</Text>
                  <Text style={styles.actionLabel}>Call {EMERGENCY_NUMBER}</Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.stopBtn, compact && styles.actionBtnCompact]} onPress={returnHome} testID="emergency-stop-btn" accessibilityLabel="emergency-stop-btn">
                  <View style={styles.stopSquare} />
                  <Text style={styles.actionLabel}>Stop</Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.contactBtn, compact && styles.actionBtnCompact]} onPress={callPriorityContact}>
                  <Text style={styles.actionIcon}>C</Text>
                  <Text style={styles.actionLabel}>{callTargetContact ? callTargetContact.name : 'Contact'}</Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.allContactsBtn, compact && styles.actionBtnCompact]} onPress={callAllContacts}>
                  <Text style={styles.actionIcon}>A</Text>
                  <Text style={styles.actionLabel}>All Contacts</Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.82} style={[styles.actionBtn, styles.videoBtn, compact && styles.actionBtnCompact]} onPress={facetimePriorityContact}>
                  <Text style={styles.actionIcon}>F</Text>
                  <Text style={styles.actionLabel}>FaceTime</Text>
                </TouchableOpacity>

                {/* Only exists once a real emergencyId exists — i.e. only after
                    activation has happened. This is what makes the "share is an
                    independent, post-activation action" rule structural rather
                    than just a convention: the button literally cannot be
                    tapped before there's an emergency to share. */}
                {emergencyId ? (
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.actionBtn, styles.shareBtn, compact && styles.actionBtnCompact]}
                    onPress={shareToSocial}
                    testID="emergency-share-btn"
                    accessibilityLabel="emergency-share-btn"
                  >
                    <Text style={styles.actionIcon}>S</Text>
                    <Text style={styles.actionLabel}>Share</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Below every control, part of the normal layout — never covers
                  the camera, recording status or buttons, and only appears
                  once recording is already running. */}
              {phase === 'recording' && emergencyId && sharingSetupState && !setupNoteDismissed ? (
                <SocialSetupNote
                  state={sharingSetupState}
                  onRemind={remindAfterEmergency}
                  onDismiss={() => {
                    trackEvent('social_setup_note_dismiss', { state: sharingSetupState });
                    setSetupNoteDismissed(true);
                  }}
                />
              ) : null}
            </View>
          </ScrollView>

          {/* Keyed per emergency so the one-shot auto prompt resets with
              each new activation. Same emergencyId gate as the Share button. */}
          {emergencyId ? (
            <SocialShareOverlay
              key={emergencyId}
              emergencyId={emergencyId}
              recording={phase === 'recording'}
              providers={shareableProviders}
              resolveShareSegment={resolveShareSegment}
              openRequest={shareOpenRequest}
              onShared={handleShared}
              onResult={handleShareResult}
            />
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

export default function EmergencyScreen() {
  const route = useRoute<any>();
  if (route.params?.tourMode) return <EmergencyTourDemo />;
  return <EmergencyLiveScreen />;
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
  liveRoot: { flex: 1 },
  liveScroll: { flex: 1 },
  liveScrollContent: { flexGrow: 1 },
  liveLayout: { alignItems: 'center', flex: 1, gap: 16, padding: 16 },
  liveLayoutCompact: { gap: 10, paddingVertical: 10 },
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
  actionBtnCompact: { minHeight: 50, paddingVertical: 7 },
  stopBtn: { backgroundColor: 'rgba(100,100,100,0.28)', borderColor: '#777' },
  contactBtn: { backgroundColor: 'rgba(245,158,11,0.18)', borderColor: '#f59e0b' },
  allContactsBtn: { backgroundColor: 'rgba(78,225,213,0.14)', borderColor: '#4ee1d5' },
  videoBtn: { backgroundColor: 'rgba(74,168,255,0.18)', borderColor: '#4aa8ff' },
  sharedText: { color: '#22c55e', fontSize: 13, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  storageText: { color: '#fbbf24', fontSize: 13, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  liveViewPanel: {
    backgroundColor: 'rgba(74,168,255,0.10)',
    borderColor: 'rgba(74,168,255,0.45)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    maxWidth: 620,
    padding: 14,
    width: '100%',
  },
  liveViewTitle: { color: '#fff', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  liveViewHint: { color: '#a8a0bf', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  liveViewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  liveViewBtn: { backgroundColor: 'rgba(74,168,255,0.22)', borderColor: '#4aa8ff', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 9 },
  liveViewBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  liveViewStopText: { color: '#a8a0bf', fontSize: 12, fontWeight: '700', textAlign: 'center', textDecorationLine: 'underline' },
  shareBtn: { backgroundColor: 'rgba(244,114,182,0.18)', borderColor: '#f472b6' },
  stopSquare: { backgroundColor: '#fff', borderRadius: 4, height: 18, width: 18 },
  actionIcon: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 22 },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
});
