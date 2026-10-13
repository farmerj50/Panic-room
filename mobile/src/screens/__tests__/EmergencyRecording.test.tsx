import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';

// These tests drive the real EmergencyScreen through many act() cycles of
// simulated time. Under a parallel full-suite run, the file's first test also
// pays for loading and first-rendering the screen, which can exceed Jest's
// 5s real-time default — a timing limit, not a behavior failure.
jest.setTimeout(30_000);

// ── A controllable fake camera ────────────────────────────────────────────
// Each recordAsync() call creates a recording that ends either when the
// screen calls stopRecording() (a cut we made) or when the test ends it
// "on its own" (expo-camera's maxDuration / the OS).
type Recording = { resolve: (value: { uri: string }) => void; uri: string };
const mockRecordings: Recording[] = [];
let mockClipCounter = 0;
// recordAsync() calls that fail to start (native "could not create video file").
let mockFailStarts = 0;
let mockStartCalls = 0;
let mockCameraMounts = 0;

jest.mock('expo-camera', () => {
  const React = require('react');
  const CameraView = React.forwardRef((props: { onCameraReady?: () => void }, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({
      recordAsync: jest.fn(() => {
        mockStartCalls += 1;
        if (mockFailStarts > 0) {
          mockFailStarts -= 1;
          return Promise.reject(new Error('Starting video recording failed - could not create video file.'));
        }
        return (
          new Promise((resolve) => {
            mockClipCounter += 1;
            mockRecordings.push({ resolve, uri: `file:///cache/clip-${mockClipCounter}.mp4` });
          })
        );
      }),
      stopRecording: jest.fn(() => {
        const current = mockRecordings[mockRecordings.length - 1];
        current?.resolve({ uri: current.uri });
      }),
      pausePreview: jest.fn(() => Promise.resolve()),
    }));
    React.useEffect(() => {
      mockCameraMounts += 1;
      const t = setTimeout(() => props.onCameraReady?.(), 10);
      return () => clearTimeout(t);
    }, []);
    return null;
  });
  return {
    CameraView,
    useCameraPermissions: () => [{ granted: true, status: 'granted' }, jest.fn()],
    useMicrophonePermissions: () => [{ granted: true, status: 'granted' }, jest.fn()],
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));
jest.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../../components/LiveLocationMap', () => () => null);
type OverlayProps = { providers: unknown[]; openRequest: number; onResult?: (r: { code?: string }) => void };
let mockOverlayProps: OverlayProps | null = null;
jest.mock('../../components/SocialShareOverlay', () => (props: OverlayProps) => {
  mockOverlayProps = props;
  return null;
});
jest.mock('../../context/TourContext', () => ({
  useTourTarget: () => ({ current: null }),
  useTourTargetPress: (_key: string, handler: () => void) => handler,
  useTour: () => ({ phase: 'idle', paused: false, currentStep: null, next: jest.fn() }),
}));

let mockCallMode = 'none';
const mockRunCoreActivation = jest.fn().mockResolvedValue({ ok: true, emergencyId: 'e1', location: null });
const mockContacts = [
  { id: 'c1', name: 'Sam', phoneNumber: '+15551230001', isPriority: true },
  { id: 'c2', name: 'Riley', phoneNumber: '+15551230002', isPriority: false },
];
jest.mock('../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({
    orderedContacts: mockContacts,
    priorityContact: mockContacts[0],
    emergencyId: 'e1',
    setEmergencyId: jest.fn(),
    triggerEmergency: jest.fn(),
    resolveEmergency: jest.fn(),
    emergencySettings: { cameraAutoRecord: true, audioAutoRecord: false, emergencyCallMode: mockCallMode },
    runCoreActivation: (...args: unknown[]) => mockRunCoreActivation(...args),
    stopAudioCapture: jest.fn().mockResolvedValue(null),
    stopLocationWatch: jest.fn(),
  }),
}));
let mockIsPremium = true;
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../context/SubscriptionContext', () => ({ useSubscription: () => ({ isPremium: mockIsPremium }) }));
const mockSetRemind = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/socialSharingPrompts', () => ({ setRemindAfterEmergency: (...a: unknown[]) => mockSetRemind(...a) }));
jest.mock('../../services/analyticsService', () => ({ trackEvent: jest.fn() }));
jest.mock('../../services/corePermissions', () => ({
  requestCameraPermission: jest.fn().mockResolvedValue('granted'),
  requestMicrophonePermission: jest.fn().mockResolvedValue('granted'),
}));
jest.mock('../../services/experiments', () => ({ getExistingOnboardingVariant: jest.fn().mockResolvedValue(null) }));
const mockListConnections = jest.fn().mockResolvedValue({ connections: [] });
jest.mock('../../services/socialSharingService', () => ({ listConnections: (...args: unknown[]) => mockListConnections(...args) }));
const TIKTOK = { provider: 'tiktok', status: 'connected', enabledForEmergency: true, providerUsername: 'me' };
jest.mock('../../hooks/useAppStateEmergencyGuard', () => ({
  clearInProgressEmergency: jest.fn().mockResolvedValue(undefined),
  useAppStateEmergencyGuard: jest.fn(),
}));

const mockLiveView = { enabled: false, links: [] as unknown[] };
const mockShareLiveView = jest.fn();
const mockCallEmergencyContacts = jest.fn().mockResolvedValue({ called: true, calledCount: 2 });
const mockRotateLiveView = jest.fn();
const mockRevokeLiveView = jest.fn();
jest.mock('../../services/emergencyService', () => ({
  callEmergencyContacts: (...args: unknown[]) => mockCallEmergencyContacts(...args),
  updateEmergency: jest.fn().mockResolvedValue({}),
  getLiveViewStatus: jest.fn(() => Promise.resolve(mockLiveView)),
  shareLiveView: (...args: unknown[]) => mockShareLiveView(...args),
  rotateLiveView: (...args: unknown[]) => mockRotateLiveView(...args),
  revokeLiveView: (...args: unknown[]) => mockRevokeLiveView(...args),
}));

const mockEnqueueClip = jest.fn();
jest.mock('../../services/segmentQueue', () => ({
  enqueueClip: (...args: unknown[]) => mockEnqueueClip(...args),
  releaseRetainedClips: jest.fn().mockResolvedValue(undefined),
  resumeClipQueue: jest.fn().mockResolvedValue(undefined),
  retainClipsFor: jest.fn(),
  runClipQueue: jest.fn().mockResolvedValue(undefined),
  waitForClipAttempt: jest.fn(() => new Promise(() => {})),
}));

let mockFreeBytes: number | null = 50 * 1024 * 1024 * 1024;
jest.mock('../../services/storageMonitor', () => ({
  ...jest.requireActual('../../services/storageMonitor'),
  getFreeBytes: () => mockFreeBytes,
}));

import EmergencyScreen from '../EmergencyScreen';

const MB = 1024 * 1024;

async function advance(ms: number, step = 500) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      jest.advanceTimersByTime(step);
    });
  }
}

// Countdown (5s) → activation → camera ready → first segment recording.
async function startEmergency() {
  render(<EmergencyScreen />);
  await advance(7000);
  expect(mockRecordings).toHaveLength(1);
}

const queuedSequences = () =>
  mockEnqueueClip.mock.calls.filter(([clip]) => clip.kind === 'video').map(([clip]) => clip.sequence);

describe('continuous emergency recording', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecordings.length = 0;
    mockClipCounter = 0;
    mockFailStarts = 0;
    mockStartCalls = 0;
    mockCameraMounts = 0;
    mockFreeBytes = 50 * 1024 * MB;
    mockLiveView.enabled = false;
    mockLiveView.links = [];
    mockEnqueueClip.mockReset();
    mockEnqueueClip.mockImplementation(async (clip: { sourceUri: string }) => ({ id: clip.sourceUri, localUri: clip.sourceUri }));
    mockShareLiveView.mockReset();
    mockRotateLiveView.mockReset();
    mockRevokeLiveView.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('recording restarts automatically when the camera stops on its own (5-minute cap)', async () => {
    await startEmergency();
    // expo-camera ends the recording itself (maxDuration), nobody called stop.
    await act(async () => {
      mockRecordings[0].resolve({ uri: mockRecordings[0].uri });
    });
    await advance(2000);

    expect(queuedSequences()).toEqual([1]);
    expect(mockEnqueueClip.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'video', emergencyId: 'e1', sequence: 1, sourceUri: 'file:///cache/clip-1.mp4' }),
    );
    expect(mockRecordings).toHaveLength(2); // a new segment is recording
  });

  test('with Live View off, a new clip is cut every 120 seconds', async () => {
    await startEmergency();
    await advance(100_000, 5000);
    expect(queuedSequences()).toEqual([]);
    await advance(30_000, 5000);
    expect(queuedSequences()).toEqual([1]);
    expect(mockRecordings).toHaveLength(2);
  });

  test('with Live View on, a new clip is cut every 30 seconds and recording continues', async () => {
    mockLiveView.enabled = true;
    await startEmergency();
    // Cuts are checked every 5s, so each clip is 30–35s long.
    await advance(25_000, 5000);
    expect(queuedSequences()).toEqual([]);
    await advance(90_000, 5000);
    expect(queuedSequences()).toEqual([1, 2, 3]);
    expect(mockRecordings.length).toBeGreaterThanOrEqual(4);
  });

  test('routine cuts restart recording on the same camera (no remount/re-bind)', async () => {
    mockLiveView.enabled = true;
    await startEmergency();
    const mountsAtStart = mockCameraMounts;
    await advance(80_000, 5000);
    expect(queuedSequences()).toEqual([1, 2]);
    expect(mockCameraMounts).toBe(mountsAtStart);
  });

  test('a failing upload queue never stops the camera', async () => {
    mockEnqueueClip.mockRejectedValue(new Error('disk error'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLiveView.enabled = true;
    await startEmergency();
    await advance(80_000, 5000);
    expect(mockRecordings.length).toBeGreaterThanOrEqual(3);
  });

  test('a recording that fails to start is retried within a second, not left idle until the next cut', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFailStarts = 1;
    render(<EmergencyScreen />);
    await advance(7000);
    expect(mockStartCalls).toBe(2);
    expect(mockRecordings).toHaveLength(1);
  });

  test('if starts keep failing, the camera is fully restarted and recording resumes', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFailStarts = 3;
    render(<EmergencyScreen />);
    await advance(12_000);
    expect(mockStartCalls).toBe(4);
    expect(mockRecordings).toHaveLength(1);
    expect(queuedSequences()).toEqual([]); // nothing was recorded, nothing to queue
  });

  test('a recording that ends without a file is restarted', async () => {
    await startEmergency();
    await act(async () => {
      mockRecordings[0].resolve(undefined as never);
    });
    await advance(2000);
    expect(mockRecordings).toHaveLength(2);
  });

  test('low storage: warns, pauses video below 100 MB, and resumes automatically above 150 MB', async () => {
    await startEmergency();

    mockFreeBytes = 800 * MB;
    await advance(6000);
    expect(screen.getByTestId('emergency-storage-text')).toHaveTextContent(/Storage low/);

    mockFreeBytes = 80 * MB;
    await advance(6000);
    expect(queuedSequences()).toEqual([1]); // current clip safely queued, not deleted
    expect(screen.getByTestId('emergency-status-text')).toHaveTextContent(/video paused/);
    const recordingsWhilePaused = mockRecordings.length;

    mockFreeBytes = 120 * MB; // above the pause line but below the resume line
    await advance(12_000);
    expect(mockRecordings).toHaveLength(recordingsWhilePaused);

    mockFreeBytes = 160 * MB;
    await advance(8000);
    expect(mockRecordings).toHaveLength(recordingsWhilePaused + 1);
    expect(screen.getByTestId('emergency-status-text')).toHaveTextContent('Recording resumed.');
  });

  test('starts with video paused when storage is already critical, and never resumes after exit', async () => {
    mockFreeBytes = 50 * MB;
    render(<EmergencyScreen />);
    await advance(7000);
    expect(mockRecordings).toHaveLength(0);

    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-exit-btn'));
    });
    mockFreeBytes = 10 * 1024 * MB;
    await advance(20_000, 5000);
    expect(mockRecordings).toHaveLength(0);
  });
});

describe('Live View actions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecordings.length = 0;
    mockFreeBytes = 50 * 1024 * MB;
    mockEnqueueClip.mockImplementation(async (clip: { sourceUri: string }) => ({ id: clip.sourceUri, localUri: clip.sourceUri }));
    mockLiveView.enabled = true;
    mockLiveView.links = [];
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    mockShareLiveView.mockResolvedValue({ url: 'https://x/live#tok', shareMessage: 'Alex activated a Bes emergency. https://x/live#tok' });
    mockRotateLiveView.mockResolvedValue({ url: 'https://x/live#new', shareMessage: 'new link https://x/live#new' });
    mockRevokeLiveView.mockResolvedValue({ revoked: 2 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('hidden when the server has Live View switched off', async () => {
    mockLiveView.enabled = false;
    await startEmergency();
    expect(screen.queryByTestId('emergency-live-view-panel')).toBeNull();
  });

  test('Send opens the share sheet with that contact\'s link (same link each time)', async () => {
    await startEmergency();
    const [sam] = screen.getAllByTestId('emergency-live-view-send-btn');
    await act(async () => {
      fireEvent.press(sam);
    });
    expect(mockShareLiveView).toHaveBeenCalledWith('e1', 'c1');
    expect(mockRotateLiveView).not.toHaveBeenCalled();
    expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining('https://x/live#tok') });
  });

  test('long-press resets a link only after confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await startEmergency();
    const [, riley] = screen.getAllByTestId('emergency-live-view-send-btn');
    await act(async () => {
      fireEvent(riley, 'longPress');
    });
    expect(mockRotateLiveView).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Reset and send')!.onPress!();
    });
    expect(mockRotateLiveView).toHaveBeenCalledWith('e1', 'c2');
    expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining('https://x/live#new') });
  });

  test('Stop sharing revokes every link after confirmation; recording continues', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-live-view-stop-btn'));
    });
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Stop sharing')!.onPress!();
    });
    expect(mockRevokeLiveView).toHaveBeenCalledWith('e1');
    expect(mockRecordings).toHaveLength(1);
  });

  test('shows who opened the live view', async () => {
    await startEmergency();
    mockLiveView.links = [{ contactId: 'c1', active: true, lastViewedAt: new Date().toISOString(), viewCount: 1 }];
    await advance(21_000, 3000);
    expect(screen.getByTestId('emergency-live-view-opened-text')).toHaveTextContent('Live view opened by Sam');
  });

  test('a failed share shows an alert instead of the share sheet', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockShareLiveView.mockRejectedValue(new Error('offline'));
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getAllByTestId('emergency-live-view-send-btn')[0]);
    });
    expect(Share.share).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Live view unavailable', expect.any(String));
  });
});

describe('social share availability', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecordings.length = 0;
    mockFreeBytes = 50 * 1024 * MB;
    mockLiveView.enabled = false;
    mockOverlayProps = null;
    mockEnqueueClip.mockImplementation(async (clip: { sourceUri: string }) => ({ id: clip.sourceUri, localUri: clip.sourceUri }));
    mockListConnections.mockReset().mockResolvedValue({ connections: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('an account connected after the screen first loaded is picked up at activation (prompt can show)', async () => {
    // First load (screen mount) sees nothing; by activation TikTok is connected.
    mockListConnections.mockResolvedValueOnce({ connections: [] }).mockResolvedValue({ connections: [TIKTOK] });
    await startEmergency();
    expect(mockListConnections.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockOverlayProps?.providers).toEqual([TIKTOK]);
  });

  test('a failed first load does not hide sharing for the rest of the session', async () => {
    mockListConnections.mockRejectedValueOnce(new Error('401 refresh race')).mockResolvedValue({ connections: [TIKTOK] });
    await startEmergency();
    expect(mockOverlayProps?.providers).toEqual([TIKTOK]);
  });

  test('Share re-checks connections when none are loaded, then opens sharing', async () => {
    mockListConnections.mockResolvedValueOnce({ connections: [] }).mockResolvedValueOnce({ connections: [] }).mockResolvedValue({ connections: [TIKTOK] });
    await startEmergency();
    const before = mockOverlayProps!.openRequest;
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-share-btn'));
    });
    expect(mockOverlayProps!.openRequest).toBe(before + 1);
  });

  test('Share explains a connection that needs reconnecting instead of saying "not connected"', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListConnections.mockResolvedValue({ connections: [{ ...TIKTOK, status: 'reauth_required' }] });
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-share-btn'));
    });
    expect(alert).toHaveBeenCalledWith('Reconnect needed', expect.stringContaining('TikTok'), expect.any(Array));
  });

  test('Share explains when emergency sharing is switched off for the account', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListConnections.mockResolvedValue({ connections: [{ ...TIKTOK, enabledForEmergency: false }] });
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-share-btn'));
    });
    expect(alert).toHaveBeenCalledWith('Emergency sharing is off', expect.stringContaining('TikTok'));
  });
});

describe('social sharing setup note (emergency screen)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecordings.length = 0;
    mockFreeBytes = 50 * 1024 * MB;
    mockLiveView.enabled = false;
    mockOverlayProps = null;
    mockIsPremium = true;
    mockCallMode = 'none';
    mockSetRemind.mockClear();
    mockCallEmergencyContacts.mockClear();
    mockRunCoreActivation.mockClear();
    mockEnqueueClip.mockImplementation(async (clip: { sourceUri: string }) => ({ id: clip.sourceUri, localUri: clip.sourceUri }));
    mockListConnections.mockReset().mockResolvedValue({ connections: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const note = () => screen.queryByTestId('emergency-social-setup-note');

  test('free account: a Premium note appears only once recording is running, below every control', async () => {
    mockIsPremium = false;
    render(<EmergencyScreen />);
    expect(note()).toBeNull(); // countdown
    await advance(7000);
    expect(note()).toHaveTextContent(/Premium feature — recording continues/);
    const tree = JSON.stringify(screen.toJSON());
    for (const control of ['emergency-call911-btn', 'emergency-stop-btn', 'emergency-share-btn', 'emergency-rec-label', 'emergency-status-text']) {
      expect(tree.indexOf(control)).toBeGreaterThan(-1);
      expect(tree.indexOf(control)).toBeLessThan(tree.indexOf('emergency-social-setup-note'));
    }
  });

  test("Premium but not connected: the isn't-set-up note", async () => {
    await startEmergency();
    expect(note()).toHaveTextContent(/isn't set up/);
  });

  test('no note when connected, when switched off by the user, or when connections could not be loaded', async () => {
    mockListConnections.mockResolvedValue({ connections: [TIKTOK] });
    await startEmergency();
    expect(note()).toBeNull();
    screen.unmount();

    mockRecordings.length = 0;
    mockListConnections.mockResolvedValue({ connections: [{ ...TIKTOK, enabledForEmergency: false }] });
    await startEmergency();
    expect(note()).toBeNull();
    screen.unmount();

    mockRecordings.length = 0;
    mockListConnections.mockRejectedValue(new Error('offline'));
    await startEmergency();
    expect(note()).toBeNull();
  });

  test('× hides the note; "Remind me after" saves the reminder and hides it', async () => {
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-social-setup-dismiss'));
    });
    expect(note()).toBeNull();
    expect(mockSetRemind).not.toHaveBeenCalled();
    screen.unmount();

    mockRecordings.length = 0;
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-social-setup-remind'));
    });
    expect(note()).toBeNull();
    expect(mockSetRemind).toHaveBeenCalledWith('u1');
  });

  test('free account: Share explains Premium and offers "Remind me after" — no paywall, no navigation', async () => {
    mockIsPremium = false;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await startEmergency();
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-share-btn'));
    });
    expect(alert).toHaveBeenCalledWith('Premium feature', expect.stringContaining('Premium'), expect.any(Array));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Remind me after')!.onPress!();
    });
    expect(mockSetRemind).toHaveBeenCalledWith('u1');
  });

  test('a share that comes back "reconnect needed" switches the note to reconnect', async () => {
    mockListConnections.mockResolvedValue({ connections: [TIKTOK] });
    await startEmergency();
    expect(note()).toBeNull();
    mockListConnections.mockResolvedValue({ connections: [{ ...TIKTOK, status: 'reauth_required' }] });
    await act(async () => {
      mockOverlayProps!.onResult!({ code: 'reauth_required' });
    });
    expect(note()).toHaveTextContent(/Reconnect TikTok or Instagram/);
  });

  test('social sharing failures never interrupt recording, GPS/alerts or trusted-contact calls', async () => {
    mockCallMode = 'contacts';
    mockListConnections.mockRejectedValue(new Error('social API down'));
    await startEmergency();
    await act(async () => {
      mockOverlayProps!.onResult!({ code: 'reauth_required' });
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-share-btn'));
    });
    // Core activation (GPS, emergency event, SMS notify) and calls ran.
    expect(mockRunCoreActivation).toHaveBeenCalledTimes(1);
    expect(mockRunCoreActivation.mock.calls[0][0]).toEqual(
      expect.objectContaining({ onNotifyResult: expect.any(Function), onLocationUpdate: expect.any(Function) }),
    );
    expect(mockCallEmergencyContacts).toHaveBeenCalledTimes(1);
    // Recording keeps cutting clips on schedule (120s with Live View off).
    await advance(130_000, 5000);
    expect(mockRecordings.length).toBeGreaterThanOrEqual(2);
  });
});
