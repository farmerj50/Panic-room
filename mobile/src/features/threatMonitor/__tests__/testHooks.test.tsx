import { act, fireEvent, render, screen } from '@testing-library/react-native';

let mockHooks = true;
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
jest.mock('../../../services/analyticsService', () => ({
  trackEvent: jest.fn(),
}));
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
  isAiMonitorEnabled: () => true,
  isThreatDetectionEnabled: () => true,
  isAiTestHooksEnabled: () => mockHooks,
}));

import AIThreatMonitorScreen from '../screens/AIThreatMonitorScreen';
import { __resetCameraOwnershipForTests } from '../services/CameraOwnershipService';
import { sessionThreatEvents } from '../threat/events/ThreatEventLog';

describe('test-build hooks', () => {
  beforeEach(() => {
    __resetCameraOwnershipForTests();
    sessionThreatEvents.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('are absent unless the test-hooks flag is set', () => {
    mockHooks = false;
    render(<AIThreatMonitorScreen />);
    expect(screen.queryByTestId('ai-test-tools')).toBeNull();
    mockHooks = true;
  });

  it('replay synthetic clips through the real engine into event cards', () => {
    render(<AIThreatMonitorScreen />);
    fireEvent.press(screen.getByTestId('ai-test-replay-fall'));
    expect(screen.getByLabelText('threat-event-fall-ongoing')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ai-test-replay-panic'));
    expect(screen.getByLabelText(/^threat-event-crowd_panic-(ongoing|ended)$/)).toBeTruthy();
  });

  it('simulate a threat analysis failure while people counting continues', async () => {
    render(<AIThreatMonitorScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    act(() =>
      lastViewProps.onCameraState({
        nativeEvent: { state: 'starting', sessionId: 3 },
      }),
    );
    act(() =>
      lastViewProps.onCameraState({
        nativeEvent: { state: 'running', sessionId: 3 },
      }),
    );
    fireEvent.press(screen.getByTestId('ai-test-fail-analysis'));
    for (const timestamp of [500, 625])
      act(() =>
        lastViewProps.onDetections({
          nativeEvent: {
            sessionId: 3,
            timestamp,
            frameWidth: 480,
            frameHeight: 640,
            inferenceMs: 30,
            targetFps: 8,
            rotationRate: 0,
            detections: [{ x: 0.2, y: 0.3, width: 0.1, height: 0.3, score: 0.9 }],
          },
        }),
      );
    expect(screen.getByTestId('threat-status').props.accessibilityLabel).toBe('threat-status-failed');
    expect(screen.getByTestId('ai-monitor-people-count').props.accessibilityLabel).toBe('ai-monitor-people-count-1');
  });
});
