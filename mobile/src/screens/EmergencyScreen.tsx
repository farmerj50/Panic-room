import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

import { useEmergencyContext } from '../context/EmergencyContext';
import { COUNTDOWN_SECONDS, EMERGENCY_NUMBER, ENABLE_EMERGENCY_DIALER } from '../config/emergencyConfig';
import { callEmergencyContacts, createEmergency, notifyEmergencyContacts } from '../services/emergencyService';
import { getCurrentLocation, getLastKnownLocation, watchLocation } from '../services/locationService';
import type { Contact } from '../types/contact';

type EmergencyPhase = 'countdown' | 'activating' | 'recording' | 'error';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    setEmergencyId,
    triggerEmergency,
    resolveEmergency,
    emergencySettings,
  } = useEmergencyContext();

  const {
    cameraAutoRecord,
    audioAutoRecord,
    autoCallContact,
    contactFollowUpAction,
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
  const [statusMessage, setStatusMessage] = useState('Emergency activation starting.');
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSessionKey, setCameraSessionKey] = useState(0);

  const activationStarted = useRef(false);
  const sessionRef = useRef(0);
  const stopping = useRef(false);
  const locationSub = useRef<{ remove: () => void } | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref mirrors location state so callbacks closed over in useCallback always
  // see the latest value without needing location in their dependency arrays.
  const currentLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const previewWidth = Math.min(width - 32, 420);
  const previewHeight = Math.round(previewWidth * 0.56);
  const orderedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(b.isPriority) - Number(a.isPriority)),
    [contacts],
  );
  const callTargetContact = priorityContact ?? orderedContacts[0] ?? null;

  const stopEmergencyAssets = useCallback(async () => {
    sessionRef.current += 1;
    activationStarted.current = false;
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

    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      locationSub.current?.remove();
      locationSub.current = null;

      try { cameraRef.current?.stopRecording(); } catch {}
      try { await Promise.race([cameraRef.current?.pausePreview?.() ?? Promise.resolve(), wait(500)]); } catch {}
      try { await Promise.race([audioRecorder.stop().catch(() => {}), wait(750)]); } catch {}

      cameraRef.current = null;
    } finally {
      stopping.current = false;
      scheduleBrowserMediaRelease();
    }
  }, [audioRecorder, resolveEmergency]);

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
    setNotificationStatus(null);
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

  const callContactsFromServer = useCallback(async (contactsToCall: Contact[], label: string) => {
    try {
      const response = await callEmergencyContacts({
        contacts: contactsToCall,
        // Use ref so the message always contains the latest GPS fix regardless
        // of whether React has committed the location state update yet.
        message: `PanicRoom emergency activated. Location: ${mapUrl(currentLocationRef.current)}. Please check on this person immediately.`,
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

  const runConfiguredCallAction = useCallback(async (isCurrentSession?: () => boolean) => {
    const followUpAction = contactFollowUpAction ?? (autoCallContact ? 'call' : 'none');

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

    if (emergencyCallMode === 'contacts') {
      await callAllContacts();
      return;
    }

    setStatusMessage('Opening emergency dialer.');
    await callEmergencyNumber();

    if (followUpAction === 'none') return;

    await wait(1000);
    if (isCurrentSession && !isCurrentSession()) return;

    if (followUpAction === 'call') {
      setStatusMessage('Opening priority contact dialer.');
      await callPriorityContact();
      return;
    }

    if (followUpAction === 'callAll') {
      await callAllContacts();
      return;
    }

    setStatusMessage('Opening FaceTime for priority contact.');
    await facetimePriorityContact();
  }, [
    autoCallContact,
    callAllContacts,
    callEmergencyNumber,
    callPriorityContact,
    contactFollowUpAction,
    emergencyCallMode,
    facetimePriorityContact,
  ]);

  const activateEmergency = useCallback(async () => {
    if (activationStarted.current) return;
    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    activationStarted.current = true;
    stopping.current = false;
    setCountdownEnabled(false);
    setPhase('activating');

    triggerEmergency();

    let currentLocation: { latitude: number; longitude: number } | null = null;
    let activeEmergencyId: string | null = null;
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

      setStatusMessage('Creating emergency event.');
      try {
        const emergency = await createEmergency({
          latitude: currentLocation?.latitude,
          longitude: currentLocation?.longitude,
        });
        activeEmergencyId = emergency.id;
        if (!isCurrentSession()) return;
        setEmergencyId(emergency.id);
      } catch {
        setNotificationStatus('Backend event failed — recording and dialer still active.');
      }

      if (audOk) {
        setStatusMessage('Starting audio recording.');
        await audioRecorder.prepareToRecordAsync();
        if (!isCurrentSession()) return;
        audioRecorder.record();
        await wait(300);
        if (!isCurrentSession()) return;
      }

      if (camOk) {
        setStatusMessage('Starting video recording.');
        cameraRef.current?.recordAsync({ maxDuration: 300 }).catch(() => {});
      }

      recordingTimerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
      setPhase('recording');

      if (activeEmergencyId && orderedContacts.length > 0) {
        setStatusMessage('Notifying trusted contacts.');
        const response = await notifyEmergencyContacts({
          emergencyId: activeEmergencyId,
          contacts: orderedContacts,
          message: `PanicRoom emergency activated. Location: ${mapUrl(currentLocation)}`,
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

      await runConfiguredCallAction(isCurrentSession);
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
    contacts,
    emergencyCallMode,
    ensurePermissions,
    resolveEmergency,
    runConfiguredCallAction,
    setEmergencyId,
    triggerEmergency,
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
                `emergency dialer (${EMERGENCY_NUMBER})`,
              ]
                .filter(Boolean)
                .join(', ')}{' '}
              will start automatically.
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
                <CameraView
                  key={cameraSessionKey}
                  ref={cameraRef}
                  active={cameraActive}
                  style={styles.cameraPreview}
                  facing={Platform.OS === 'web' ? 'front' : 'back'}
                  mode="video"
                  mute={false}
                  testID="emergency-camera-view"
                  accessibilityLabel="emergency-camera-view"
                  onMountError={(e) => setStatusMessage(e.message || 'Camera preview could not start.')}
                />
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
            {location && (
              <Text style={styles.locationText} testID="emergency-gps-text" accessibilityLabel="emergency-gps-text">
                GPS {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
              </Text>
            )}
          </View>

          <View style={styles.controls}>
            <TouchableOpacity activeOpacity={0.82} style={styles.actionBtn} onPress={callEmergencyNumber} testID="emergency-call911-btn" accessibilityLabel="emergency-call911-btn">
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
  statusPanel: { backgroundColor: 'rgba(0,0,0,0.56)', borderColor: 'rgba(255,255,255,0.14)', borderRadius: 16, borderWidth: 1, maxWidth: 520, padding: 12, width: '100%' },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  notificationText: { color: '#f7ca75', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  locationText: { color: '#4ee1d5', fontSize: 12, fontWeight: '800', marginTop: 6, textAlign: 'center' },
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
