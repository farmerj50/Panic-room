import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

let mockFlip = true;
let mockProximity = true;
const mockTrack = jest.fn();
let lastViewProps: any = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('../../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({ isEmergency: false }),
}));
jest.mock('../../../services/analyticsService', () => ({ trackEvent: (...a: unknown[]) => mockTrack(...a) }));
jest.mock('../services/besVision', () => {
  const { View } = jest.requireActual('react-native');
  return {
    isBesVisionAvailable: true,
    releaseMonitorCamera: () => Promise.resolve(true),
    BesVisionView: (props: any) => {
      lastViewProps = props;
      return <View testID="native-vision-view" />;
    },
  };
});
jest.mock('../config/threatMonitorConfig', () => ({
  ...jest.requireActual('../config/threatMonitorConfig'),
  isAiMonitorEnabled: () => true,
  isAiCameraFlipEnabled: () => mockFlip,
  isAiProximityEnabled: () => mockProximity,
}));

import AIThreatMonitorScreen from '../screens/AIThreatMonitorScreen';
import { __resetCameraOwnershipForTests, claimForEmergency, isMonitorActive } from '../services/CameraOwnershipService';

const nativeState = (state: string, sessionId: number) =>
  act(() => lastViewProps.onCameraState({ nativeEvent: { state, sessionId } }));
let frameTs = 0;
const nativeDetections = (sessionId: number, detections: any[]) =>
  act(() =>
    lastViewProps.onDetections({
      nativeEvent: { sessionId, timestamp: (frameTs += 125), frameWidth: 480, frameHeight: 640, inferenceMs: 30, targetFps: 8, rotationRate: 0, detections },
    }),
  );
// One person walking toward the camera: the box grows ~20 % per second.
let approachStep = 0;
const approaching = () => {
  const h = 0.3 * Math.exp(0.2 * approachStep++ * 0.125);
  return [{ x: 0.4, y: 0.2, width: h * 0.4, height: h, score: 0.9 }];
};
const still = [{ x: 0.4, y: 0.2, width: 0.12, height: 0.3, score: 0.9 }];

function layoutCamera() {
  fireEvent(screen.getByTestId('ai-monitor-camera-box'), 'layout', { nativeEvent: { layout: { width: 300, height: 400 } } });
}
async function startRunning(sessionId = 7) {
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
  });
  nativeState('starting', sessionId);
  nativeState('running', sessionId);
}
const flip = () => act(() => fireEvent.press(screen.getByTestId('ai-monitor-flip-btn')));
const stopCalls = () => mockTrack.mock.calls.filter(([name]) => name === 'ai_monitor_stopped').length;
async function enableAlerts() {
  await act(async () => {
    fireEvent(screen.getByTestId('ai-proximity-alert-switch'), 'valueChange', true);
  });
}

describe('AI Monitor camera flip and proximity', () => {
  beforeEach(async () => {
    __resetCameraOwnershipForTests();
    await AsyncStorage.clear();
    mockFlip = true;
    mockProximity = true;
    mockTrack.mockReset();
    lastViewProps = null;
    approachStep = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => {} }) as any);
  });

  it('hides the flip button, chips and settings when the flags are off', async () => {
    mockFlip = false;
    mockProximity = false;
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    for (let i = 0; i < 20; i++) nativeDetections(7, approaching());
    expect(screen.queryByTestId('ai-monitor-flip-btn')).toBeNull();
    expect(screen.queryByTestId('ai-proximity-settings')).toBeNull();
    expect(screen.queryByTestId('ai-monitor-proximity-1')).toBeNull();
    expect(lastViewProps.facing).toBe('back');
  });

  it('flips inside the same session: the camera restarts, status stays running, nothing stops', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning(7);
    expect(lastViewProps.facing).toBe('back');
    await flip();
    expect(lastViewProps.facing).toBe('front');
    expect(lastViewProps.active).toBe(true);
    expect(screen.getByTestId('ai-monitor-status')).toHaveProp('accessibilityLabel', 'ai-monitor-status-running');
    expect(screen.getByTestId('ai-monitor-switching')).toBeTruthy();
    nativeState('starting', 8);
    nativeState('running', 8);
    expect(screen.queryByTestId('ai-monitor-switching')).toBeNull();
    expect(stopCalls()).toBe(0);
    expect(isMonitorActive()).toBe(true);
    expect(await AsyncStorage.getItem('bes_ai_monitor_facing')).toBe('front');
  });

  it('drops late frames from the old camera and resumes on the new one', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning(7);
    nativeDetections(7, still);
    nativeDetections(7, still);
    expect(screen.getByTestId('ai-monitor-box-1')).toBeTruthy();
    await flip();
    // Overlay cleared, and old-session frames are rejected before and after the new session binds.
    expect(screen.queryByTestId('ai-monitor-box-1')).toBeNull();
    nativeDetections(7, still);
    nativeDetections(7, still);
    nativeState('starting', 7); // late event from the old camera
    nativeDetections(7, still);
    expect(screen.queryByTestId('ai-monitor-overlay')).toBeNull();
    nativeState('starting', 8);
    nativeDetections(7, still);
    expect(screen.queryByTestId('ai-monitor-overlay')).toBeNull();
    nativeState('running', 8);
    nativeDetections(8, still);
    nativeDetections(8, still);
    // Fresh tracker: numbering restarts for the new camera.
    expect(screen.getByTestId('ai-monitor-box-1')).toBeTruthy();
  });

  it('ignores a flip while the camera is starting, and one flip at a time', async () => {
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    nativeState('starting', 7);
    await flip();
    expect(lastViewProps.facing).toBe('back');
    nativeState('running', 7);
    await flip();
    await flip(); // still restarting
    expect(lastViewProps.facing).toBe('front');
    nativeState('starting', 8);
    nativeState('running', 8);
    await flip();
    expect(lastViewProps.facing).toBe('back');
  });

  it('Emergency still takes the camera during a flip', async () => {
    render(<AIThreatMonitorScreen />);
    await startRunning(7);
    await flip();
    await act(async () => {
      await claimForEmergency();
    });
    expect(isMonitorActive()).toBe(false);
    expect(lastViewProps.active).toBe(false);
    expect(screen.queryByTestId('ai-monitor-switching')).toBeNull();
  });

  it('shows per-person chips and no alert while alerts are off (default)', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    for (let i = 0; i < 22; i++) nativeDetections(7, approaching());
    expect(screen.getByTestId('ai-monitor-proximity-1')).toHaveTextContent('↗ Getting closer in camera view');
    expect(screen.queryByTestId('ai-proximity-banner')).toBeNull();
  });

  it('alerts once when opted in, with neutral wording', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await enableAlerts();
    await startRunning();
    for (let i = 0; i < 22; i++) nativeDetections(7, approaching());
    expect(screen.getByTestId('ai-proximity-banner')).toHaveTextContent('Someone is getting closer in camera view (#1)');
    expect(mockTrack.mock.calls.filter(([n]) => n === 'ai_monitor_proximity_alert')).toHaveLength(1);
    expect(JSON.parse((await AsyncStorage.getItem('bes_ai_proximity_settings'))!)).toMatchObject({ alertEnabled: true });
  });

  it('a flip while someone is tracked: old-session frames never raise an alert', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await enableAlerts();
    await startRunning(7);
    // Almost long enough to alert, then flip.
    for (let i = 0; i < 12; i++) nativeDetections(7, approaching());
    expect(screen.queryByTestId('ai-proximity-banner')).toBeNull();
    await flip();
    for (let i = 0; i < 20; i++) nativeDetections(7, approaching());
    nativeState('starting', 8);
    for (let i = 0; i < 20; i++) nativeDetections(7, approaching());
    expect(screen.queryByTestId('ai-proximity-banner')).toBeNull();
    expect(screen.queryByTestId('ai-monitor-proximity-1')).toBeNull();
    // The new camera starts with no history: it takes a fresh 1.5 s before any alert.
    nativeState('running', 8);
    approachStep = 0;
    for (let i = 0; i < 6; i++) nativeDetections(8, approaching());
    expect(screen.queryByTestId('ai-proximity-banner')).toBeNull();
    for (let i = 0; i < 16; i++) nativeDetections(8, approaching());
    expect(screen.getByTestId('ai-proximity-banner')).toBeTruthy();
  });

  it('remembers the front camera across visits', async () => {
    await AsyncStorage.setItem('bes_ai_monitor_facing', 'front');
    render(<AIThreatMonitorScreen />);
    await act(async () => {});
    expect(lastViewProps.facing).toBe('front');
    expect(screen.getByTestId('ai-monitor-flip-btn')).toHaveProp('accessibilityLabel', 'ai-monitor-flip-btn-front');
  });
});
