import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockRequestPermission = jest.fn();
let mockThreats = true;
const mockEngineUpdate = jest.fn();
let lastViewProps: any = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [mockPermission, mockRequestPermission] }));
jest.mock('../../../context/EmergencyContext', () => ({ useEmergencyContext: () => ({ isEmergency: false }) }));
jest.mock('../../../services/analyticsService', () => ({ trackEvent: jest.fn() }));
jest.mock('../services/besVision', () => {
  const { View } = jest.requireActual('react-native');
  return {
    isBesVisionAvailable: true,
    releaseMonitorCamera: jest.fn().mockResolvedValue(true),
    BesVisionView: (props: any) => {
      lastViewProps = props;
      return <View testID="native-vision-view" />;
    },
  };
});
jest.mock('../config/threatMonitorConfig', () => ({
  ...jest.requireActual('../config/threatMonitorConfig'),
  isThreatDetectionEnabled: () => mockThreats,
  isAiMonitorEnabled: () => true,
}));
// A scripted engine: each test decides what the analysis "sees".
jest.mock('../threat/ThreatAssessmentEngine', () => ({
  ThreatAssessmentEngine: class {
    update(frame: unknown) {
      return mockEngineUpdate(frame);
    }
    reset() {}
  },
}));

import AIThreatMonitorScreen from '../screens/AIThreatMonitorScreen';
import { __resetCameraOwnershipForTests } from '../services/CameraOwnershipService';
import { sessionThreatEvents } from '../threat/events/ThreatEventLog';
import type { Severity, SourceReliability, ThreatAssessment, ThreatCandidate, ThreatType } from '../threat/types';

const reliability = (level: SourceReliability['level'] = 'good'): SourceReliability => ({
  level,
  analyzedFps: 8,
  motionReliableShare: 1,
  meanDetectionScore: 0.8,
  poseCoverage: 1,
  reasons: level === 'good' ? [] : ['Few frames analyzed'],
});
const candidate = (id: string, type: ThreatType, severity: Severity = 'high', confidence = 0.82): ThreatCandidate => ({
  id,
  type,
  status: 'active',
  severity,
  confidence,
  calibrated: false,
  firstSeenAt: 0,
  lastSeenAt: 0,
  trackIds: [1],
  indicators: [{ id: 'fall-fast', label: 'Went from upright to lying in 0.6 s', weight: 0.6 }],
  sourceReliability: reliability(),
  recommendedActions: ['Check whether the person needs help, if it is safe', 'If you are in danger, tap SOS to start Emergency'],
});
const assessment = (extra: Partial<ThreatAssessment> = {}): ThreatAssessment => ({
  timestamp: 0,
  candidates: [],
  recentlyResolved: [],
  sourceReliability: reliability(),
  unavailable: [],
  building: [],
  ...extra,
});

let frameTs = 0;
const frames = (n: number, opts: { rotationRate?: number; people?: number } = {}) => {
  for (let i = 0; i < n; i += 1) {
    act(() =>
      lastViewProps.onDetections({
        nativeEvent: {
          sessionId: 7,
          timestamp: (frameTs += 125),
          frameWidth: 480,
          frameHeight: 640,
          inferenceMs: 30,
          targetFps: 8,
          rotationRate: opts.rotationRate ?? 0,
          detections: Array.from({ length: opts.people ?? 1 }, (_, k) => ({ x: 0.1 + k * 0.2, y: 0.3, width: 0.1, height: 0.3, score: 0.9 })),
        },
      }),
    );
  }
};
const nativeState = (state: string, extra: Record<string, unknown> = {}) =>
  act(() => lastViewProps.onCameraState({ nativeEvent: { state, sessionId: 7, ...extra } }));

async function startRunning() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
  });
  nativeState('starting');
  nativeState('running');
}
// Past the warm-up, with whatever the engine returns.
async function watch(a: ThreatAssessment, opts: { rotationRate?: number } = {}) {
  mockEngineUpdate.mockReturnValue(a);
  frames(30, opts);
}

const status = () => screen.getByTestId('threat-status').props.accessibilityLabel;
const detector = (type: string) => screen.getByTestId(`threat-detector-${type}`).props.accessibilityLabel;
const allText = () => JSON.stringify(screen.toJSON());

describe('AI Threat Monitor dashboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetCameraOwnershipForTests();
    sessionThreatEvents.clear();
    mockThreats = true;
    mockPermission = { granted: true, canAskAgain: true };
    mockRequestPermission.mockReset().mockResolvedValue({ granted: true });
    mockEngineUpdate.mockReset().mockReturnValue(assessment());
    mockNavigate.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('builds without threat detection', () => {
    it('shows no threat dashboard and never runs the analysis', async () => {
      mockThreats = false;
      render(<AIThreatMonitorScreen />);
      await startRunning();
      frames(30);
      expect(screen.queryByTestId('threat-dashboard')).toBeNull();
      expect(mockEngineUpdate).not.toHaveBeenCalled();
      expect(screen.queryByText(/threat|possible fall|crowd panic/i)).toBeNull();
      expect(screen.getByTestId('ai-monitor-people-count').props.accessibilityLabel).toBe('ai-monitor-people-count-1');
    });
  });

  describe('status', () => {
    it('is "not monitoring" before starting, with detectors off', () => {
      render(<AIThreatMonitorScreen />);
      expect(status()).toBe('threat-status-off');
      expect(detector('fall')).toBe('threat-detector-fall-off');
      expect(screen.getByTestId('threat-events-empty')).toBeTruthy();
    });

    it('warms up before claiming anything', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      frames(5);
      expect(status()).toBe('threat-status-warming_up');
    });

    it('distinguishes no threat, insufficient evidence, unreliable input and detector unavailable', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();

      await watch(assessment());
      expect(status()).toBe('threat-status-no_threat');
      expect(screen.getByText('No threat detected')).toBeTruthy();
      expect(screen.getByTestId('threat-reliability').props.accessibilityLabel).toBe('threat-reliability-good');

      await watch(assessment({ building: ['crowd_panic'] }));
      expect(status()).toBe('threat-status-insufficient_evidence');
      expect(screen.getByText('Not enough evidence')).toBeTruthy();

      await watch(assessment(), { rotationRate: 1.2 });
      expect(status()).toBe('threat-status-unreliable_input');
      expect(screen.getByText('Hold the phone steady')).toBeTruthy();

      await watch(assessment({ sourceReliability: reliability('poor') }));
      expect(status()).toBe('threat-status-unreliable_input');
      expect(screen.getByTestId('threat-reliability').props.accessibilityLabel).toBe('threat-reliability-poor');

      const allPaused = (['fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge'] as ThreatType[]).map((type) => ({ type, reason: 'Body pose is not available' }));
      await watch(assessment({ unavailable: allPaused }));
      expect(status()).toBe('threat-status-detector_unavailable');
      expect(detector('fall')).toBe('threat-detector-fall-paused');
    });

    it('shows which detectors are watching, paused, or not enabled', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ unavailable: [{ type: 'fall', reason: 'Body pose is not available' }] }));
      expect(detector('fall')).toBe('threat-detector-fall-paused');
      expect(detector('crowd_panic')).toBe('threat-detector-crowd_panic-active');
      expect(detector('physical_confrontation')).toBe('threat-detector-physical_confrontation-disabled');
      expect(detector('assault')).toBe('threat-detector-assault-disabled');
      expect(screen.getAllByText(/Needs an action model trained on real clips/)).toHaveLength(2);
    });
  });

  describe('events', () => {
    it('shows a possible threat with severity, evidence, times and advice — never as confirmed or as a number', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      expect(status()).toBe('threat-status-candidates');
      expect(screen.getByLabelText('threat-event-fall-ongoing')).toBeTruthy();
      expect(screen.getByText('Possible fall')).toBeTruthy();
      expect(screen.getByTestId('threat-event-severity').props.children).toBe('High');
      expect(screen.getByText(/Strong evidence · Not calibrated — this is not a probability/)).toBeTruthy();
      expect(screen.getByText(/First seen \d\d:\d\d:\d\d · Last seen \d\d:\d\d:\d\d/)).toBeTruthy();
      expect(screen.getByText(/Went from upright to lying/)).toBeTruthy();
      expect(screen.getByText(/tap SOS to start Emergency/)).toBeTruthy();
      expect(screen.getByTestId('threat-event-not-confirmed').props.children).toMatch(/not a confirmed threat/);
      const text = allText();
      expect(text).not.toMatch(/\d+\s?%/);
      expect(text).not.toMatch(/0\.82/);
      expect(text).not.toMatch(/(?<!not a |not-)[Cc]onfirmed/);
    });

    it('never starts Emergency on its own, even for a high-severity event', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'crowd_surge', 'high', 0.9)] }));
      act(() => jest.advanceTimersByTime(10_000));
      expect(mockNavigate).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('ai-monitor-sos-btn'));
      await act(async () => {});
      expect(mockNavigate).toHaveBeenCalledWith('Emergency');
    });

    it('deduplicates repeated candidates of the same kind into one event', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'crowd_panic', 'moderate', 0.5)] }));
      await watch(assessment({ recentlyResolved: [candidate('c1', 'crowd_panic')] }));
      expect(screen.getByLabelText('threat-event-crowd_panic-ended')).toBeTruthy();
      await watch(assessment({ candidates: [candidate('c2', 'crowd_panic', 'moderate', 0.5)] }));
      expect(screen.getAllByText('Possible crowd panic')).toHaveLength(1);
      expect(screen.getByText(/Seen again 1×/)).toBeTruthy();
    });

    it('marks an event stale when evidence stops arriving (paused)', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      fireEvent.press(screen.getByTestId('ai-monitor-pause-btn'));
      expect(status()).toBe('threat-status-off');
      act(() => jest.advanceTimersByTime(7_000));
      expect(screen.getByLabelText('threat-event-fall-ended')).toBeTruthy();
      expect(screen.getByText(/No fresh evidence since \d\d:\d\d:\d\d/)).toBeTruthy();
    });

    it('expires old events and keeps them across leaving and reopening the screen until then', async () => {
      const first = render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      first.unmount();
      render(<AIThreatMonitorScreen />);
      expect(screen.getByLabelText('threat-event-fall-ended')).toBeTruthy();
      expect(screen.getByText(/Monitoring stopped at/)).toBeTruthy();
      act(() => jest.advanceTimersByTime(11 * 60_000));
      expect(screen.queryByLabelText('threat-event-fall-ended')).toBeNull();
      expect(screen.getByTestId('threat-events-empty')).toBeTruthy();
    });

    it('can be cleared', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      fireEvent.press(screen.getByTestId('threat-events-clear'));
      expect(screen.getByTestId('threat-events-empty')).toBeTruthy();
    });
  });

  describe('failures and permissions', () => {
    it('keeps counting people when the threat analysis fails, and says so', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      mockEngineUpdate.mockImplementation(() => {
        throw new Error('model exploded');
      });
      frames(3, { people: 2 });
      expect(status()).toBe('threat-status-failed');
      expect(screen.getByText('Threat analysis stopped')).toBeTruthy();
      expect(screen.getByTestId('ai-monitor-people-count').props.accessibilityLabel).toBe('ai-monitor-people-count-2');
      expect(screen.getByLabelText('threat-event-fall-ended')).toBeTruthy();
      expect(detector('fall')).toBe('threat-detector-fall-off');
    });

    it('ends events and stops claiming anything when the camera or model fails', async () => {
      render(<AIThreatMonitorScreen />);
      await startRunning();
      await watch(assessment({ candidates: [candidate('c1', 'fall')] }));
      nativeState('error', { message: 'Detection model failed to load.' });
      expect(screen.getByTestId('ai-monitor-message').props.children).toBe('Detection model failed to load.');
      expect(status()).toBe('threat-status-off');
      expect(screen.getByLabelText('threat-event-fall-ended')).toBeTruthy();
    });

    it('shows nothing as detected while camera permission is missing', async () => {
      mockPermission = { granted: false, canAskAgain: true };
      mockRequestPermission.mockResolvedValue({ granted: false });
      render(<AIThreatMonitorScreen />);
      await act(async () => {
        fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
      });
      expect(mockRequestPermission).toHaveBeenCalled();
      expect(status()).toBe('threat-status-off');
      expect(screen.queryByText('No threat detected')).toBeNull();
    });

    it('shows the settings link when permission was denied for good', () => {
      mockPermission = { granted: false, canAskAgain: false };
      render(<AIThreatMonitorScreen />);
      expect(screen.getByTestId('ai-monitor-open-settings')).toBeTruthy();
      expect(status()).toBe('threat-status-off');
    });
  });
});
