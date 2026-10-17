import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockFocused = true;
let mockIsEmergency = false;
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockRequestPermission = jest.fn();
const mockRelease = jest.fn();
const mockTrack = jest.fn();
let lastViewProps: any = null;
let appStateListeners: Array<(s: string) => void> = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useIsFocused: () => mockFocused,
}));
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission, mockRequestPermission],
}));
jest.mock('../../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({ isEmergency: mockIsEmergency }),
}));
jest.mock('../../../services/analyticsService', () => ({ trackEvent: (...a: unknown[]) => mockTrack(...a) }));
jest.mock('../services/besVision', () => {
  const { View } = jest.requireActual('react-native');
  return {
    isBesVisionAvailable: true,
    releaseMonitorCamera: () => mockRelease(),
    BesVisionView: (props: any) => {
      lastViewProps = props;
      return <View testID="native-vision-view" />;
    },
  };
});

import AIThreatMonitorScreen from '../screens/AIThreatMonitorScreen';
import { __resetCameraOwnershipForTests, claimForEmergency, isMonitorActive } from '../services/CameraOwnershipService';

const nativeState = (state: string, extra: Record<string, unknown> = {}) =>
  act(() => lastViewProps.onCameraState({ nativeEvent: { state, sessionId: 7, ...extra } }));
let frameTs = 0;
const nativeDetections = (sessionId: number, detections: any[] = [], rotationRate = 0) =>
  act(() =>
    lastViewProps.onDetections({
      nativeEvent: {
        sessionId,
        timestamp: (frameTs += 125),
        frameWidth: 480,
        frameHeight: 640,
        inferenceMs: 30,
        targetFps: 8,
        rotationRate,
        detections,
      },
    }),
  );
const personAt = (x: number) => ({ x, y: 0.3, width: 0.1, height: 0.3, score: 0.9 });

function layoutCamera() {
  fireEvent(screen.getByTestId('ai-monitor-camera-box'), 'layout', { nativeEvent: { layout: { width: 300, height: 400 } } });
}

async function startRunning() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
  });
  nativeState('starting');
  nativeState('running');
}

describe('AIThreatMonitorScreen', () => {
  beforeEach(() => {
    __resetCameraOwnershipForTests();
    mockFocused = true;
    mockIsEmergency = false;
    mockPermission = { granted: true, canAskAgain: true };
    mockRequestPermission.mockReset().mockResolvedValue({ granted: true });
    mockRelease.mockReset().mockResolvedValue(true);
    mockNavigate.mockReset();
    mockTrack.mockReset();
    lastViewProps = null;
    appStateListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, fn: any) => {
      appStateListeners.push(fn);
      return { remove: () => {} } as any;
    });
  });

  it('keeps the camera off until the user starts monitoring', () => {
    render(<AIThreatMonitorScreen />);
    expect(lastViewProps.active).toBe(false);
    expect(screen.getByText('Camera is off')).toBeTruthy();
    expect(screen.getByTestId('ai-monitor-privacy-note')).toHaveTextContent(
      'Processed on this phone. Nothing is recorded or uploaded.',
    );
  });

  it('starts the camera and reports running', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    expect(lastViewProps.active).toBe(true);
    expect(isMonitorActive()).toBe(true);
    expect(screen.getByText('Monitoring')).toBeTruthy();
    expect(mockTrack).toHaveBeenCalledWith('ai_monitor_started');
  });

  it('asks for camera permission before starting, and stays off if denied', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    mockRequestPermission.mockResolvedValue({ granted: false });
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(lastViewProps.active).toBe(false);
  });

  it('offers Settings when camera access was permanently denied', () => {
    mockPermission = { granted: false, canAskAgain: false };
    render(<AIThreatMonitorScreen />);
    expect(screen.getByTestId('ai-monitor-open-settings')).toBeTruthy();
  });

  it('pauses analysis without releasing the camera, then stops it', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    fireEvent.press(screen.getByTestId('ai-monitor-pause-btn'));
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(lastViewProps.active).toBe(true);
    expect(lastViewProps.analysisEnabled).toBe(false);

    fireEvent.press(screen.getByTestId('ai-monitor-stop-btn'));
    expect(lastViewProps.active).toBe(false);
    expect(isMonitorActive()).toBe(false);
    expect(mockTrack).toHaveBeenCalledWith('ai_monitor_stopped', expect.objectContaining({ reason: 'user' }));
  });

  it('refuses to start while an Emergency is active', async () => {
    mockIsEmergency = true;
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    expect(lastViewProps.active).toBe(false);
    expect(screen.getByText('Emergency is using the camera.')).toBeTruthy();
  });

  it('stops when an Emergency starts (silent activation path)', async () => {
    const { rerender } = render(<AIThreatMonitorScreen />);
    await startRunning();
    mockIsEmergency = true;
    rerender(<AIThreatMonitorScreen />);
    expect(lastViewProps.active).toBe(false);
  });

  it('stops when Emergency claims the camera', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    await act(async () => {
      await claimForEmergency();
    });
    expect(lastViewProps.active).toBe(false);
    expect(screen.getByText('Stopped — Emergency is using the camera.')).toBeTruthy();
  });

  it('stops when the screen loses focus (navigation to Emergency)', async () => {
    const { rerender } = render(<AIThreatMonitorScreen />);
    await startRunning();
    mockFocused = false;
    rerender(<AIThreatMonitorScreen />);
    expect(lastViewProps.active).toBe(false);
  });

  it('stops when the app goes to the background', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    act(() => appStateListeners.forEach((fn) => fn('background')));
    expect(lastViewProps.active).toBe(false);
  });

  it('SOS releases the camera before opening Emergency', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-sos-btn'));
    });
    expect(mockRelease).toHaveBeenCalled();
    expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(mockNavigate.mock.invocationCallOrder[0]);
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('still opens Emergency if the camera release fails', async () => {
    mockRelease.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-sos-btn'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Emergency');
  });

  it('shows a camera error and turns the camera off', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    nativeState('error', { message: 'The camera stopped unexpectedly.' });
    expect(lastViewProps.active).toBe(false);
    expect(screen.getByText('The camera stopped unexpectedly.')).toBeTruthy();
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  it('turns off when the camera is taken by something else', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    nativeState('preempted');
    expect(lastViewProps.active).toBe(false);
  });

  it('ignores detection results from an earlier session', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    nativeDetections(6); // stale
    fireEvent.press(screen.getByTestId('ai-monitor-stop-btn'));
    const stopped = mockTrack.mock.calls.find(([name]) => name === 'ai_monitor_stopped');
    expect(stopped?.[1]).toMatchObject({ avgFps: 0 });
  });

  it('turns on analysis only while running', async () => {
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    expect(lastViewProps.analysisEnabled).toBe(false); // still starting
    nativeState('starting');
    nativeState('running');
    expect(lastViewProps.analysisEnabled).toBe(true);
  });

  it('counts tracked people and draws a box per person', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    nativeDetections(7, [personAt(0.1), personAt(0.6)]);
    nativeDetections(7, [personAt(0.11), personAt(0.61)]); // confirmed on the second sighting
    expect(screen.getByTestId('ai-monitor-people-count')).toHaveTextContent('2');
    expect(screen.getByTestId('ai-monitor-box-1')).toBeTruthy();
    expect(screen.getByTestId('ai-monitor-box-2')).toBeTruthy();
  });

  it('shows "Phone moving" instead of movement counts while the phone rotates', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    nativeDetections(7, [personAt(0.1)], 1.5);
    nativeDetections(7, [personAt(0.2)], 1.5);
    expect(screen.getByText('Phone moving')).toBeTruthy();
  });

  it('labels density as an estimate and never shows threat wording', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning();
    nativeDetections(7, [personAt(0.1)]);
    nativeDetections(7, [personAt(0.1)]);
    expect(screen.getByText('Estimated density')).toBeTruthy();
    expect(screen.queryByText(/threat|danger|violent|suspicious/i)).toBeNull();
  });

  it('clears boxes and counts after Stop and starts IDs again from 1', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    nativeDetections(7, [personAt(0.1), personAt(0.6)]);
    nativeDetections(7, [personAt(0.1), personAt(0.6)]);
    fireEvent.press(screen.getByTestId('ai-monitor-stop-btn'));
    expect(screen.queryByTestId('ai-monitor-box-1')).toBeNull();
    expect(screen.getByTestId('ai-monitor-people-count')).toHaveTextContent('—');

    await startRunning();
    nativeDetections(7, [personAt(0.6)]);
    nativeDetections(7, [personAt(0.6)]);
    expect(screen.getByTestId('ai-monitor-box-1')).toBeTruthy();
    expect(screen.queryByTestId('ai-monitor-box-2')).toBeNull();
  });
});
