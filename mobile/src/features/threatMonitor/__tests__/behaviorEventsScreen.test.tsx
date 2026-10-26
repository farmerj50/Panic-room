import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

let mockBehavior = true;
const mockTrack = jest.fn();
const mockNavigate = jest.fn();
let lastViewProps: any = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
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
  isAiCameraFlipEnabled: () => true,
  isAiBehaviorEventsEnabled: () => mockBehavior,
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
// #1 follows #2 the same way and closes the gap (small, distant people).
let step = 0;
const chaseFrame = () => {
  const t = step++ * 0.125;
  return [
    { x: 0.03 + 0.2 * t, y: 0.4, width: 0.04, height: 0.1, score: 0.9 },
    { x: 0.5 + 0.1 * t, y: 0.4, width: 0.04, height: 0.1, score: 0.9 },
  ];
};
const chase = (sessionId: number, frames = 24) => {
  for (let i = 0; i < frames; i++) nativeDetections(sessionId, chaseFrame());
};

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
const alertCalls = () => mockTrack.mock.calls.filter(([n]) => n === 'ai_monitor_behavior_alert').length;

describe('AI Monitor behavioral events', () => {
  beforeEach(async () => {
    __resetCameraOwnershipForTests();
    await AsyncStorage.clear();
    mockBehavior = true;
    mockTrack.mockReset();
    mockNavigate.mockReset();
    lastViewProps = null;
    step = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => {} }) as any);
  });

  it('flag off: no panel, no links, nothing analyzed', async () => {
    mockBehavior = false;
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    chase(7);
    expect(screen.queryByTestId('ai-behavior-panel')).toBeNull();
    expect(screen.queryByTestId('ai-monitor-link-1')).toBeNull();
  });

  it('panel waits for monitoring, banner opt-in is off by default', () => {
    render(<AIThreatMonitorScreen />);
    expect(screen.getByTestId('ai-behavior-state')).toHaveTextContent('Starts when monitoring is on.');
    expect(screen.getByTestId('ai-behavior-alert-switch')).toHaveProp('value', false);
  });

  it('shows an active event with reasons and links the two people, without a banner by default', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    chase(7);
    expect(screen.getByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toHaveProp('accessibilityLabel', 'ai-behavior-event-PURSUIT_LIKE_MOVEMENT-active');
    expect(screen.getByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toHaveTextContent(/Fast movement after another person \(#1, #2\)/);
    expect(screen.getByTestId('ai-monitor-link-1')).toHaveTextContent('↔ #2');
    expect(screen.queryByTestId('ai-behavior-banner')).toBeNull();
    expect(alertCalls()).toBe(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opted in: one banner for a continuing event, neutral wording, nothing else happens', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await act(async () => {
      fireEvent(screen.getByTestId('ai-behavior-alert-switch'), 'valueChange', true);
    });
    await startRunning();
    chase(7);
    expect(screen.getByTestId('ai-behavior-banner')).toHaveTextContent('Fast movement after another person in camera view (#1, #2)');
    chase(7, 8); // the same event continues
    expect(alertCalls()).toBe(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('bes_ai_behavior_alerts')).toBe('1');
  });

  it('a flip clears events; frames from the old camera never build one', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning(7);
    chase(7);
    expect(screen.getByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByTestId('ai-monitor-flip-btn')));
    expect(screen.queryByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toBeNull();
    step = 0;
    chase(7); // late frames from the old session
    nativeState('starting', 8);
    chase(7);
    expect(screen.queryByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toBeNull();
    nativeState('running', 8);
    step = 0;
    chase(8);
    expect(screen.getByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toBeTruthy();
  });

  it('Emergency taking the camera stops and clears the analysis', async () => {
    render(<AIThreatMonitorScreen />);
    layoutCamera();
    await startRunning();
    chase(7);
    await act(async () => {
      await claimForEmergency();
    });
    expect(isMonitorActive()).toBe(false);
    expect(screen.queryByTestId('ai-behavior-event-PURSUIT_LIKE_MOVEMENT')).toBeNull();
    expect(screen.getByTestId('ai-behavior-state')).toHaveTextContent('Starts when monitoring is on.');
  });
});
