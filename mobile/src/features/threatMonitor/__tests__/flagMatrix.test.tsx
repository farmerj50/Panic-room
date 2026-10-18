import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

// All four combinations of EXPO_PUBLIC_AI_MONITOR_ENABLED and
// EXPO_PUBLIC_AI_THREATS_ENABLED, through the real flag functions.
let lastViewProps: any = null;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] }));
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

import AIMonitorCard from '../components/AIMonitorCard';
import { isAiMonitorEnabled, isThreatDetectionEnabled } from '../config/threatMonitorConfig';
import AIThreatMonitorScreen from '../screens/AIThreatMonitorScreen';
import { __resetCameraOwnershipForTests } from '../services/CameraOwnershipService';
import { ThreatAssessmentEngine } from '../threat/ThreatAssessmentEngine';

const env = { monitor: process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED, threats: process.env.EXPO_PUBLIC_AI_THREATS_ENABLED };
const originalOS = Platform.OS;
const set = (key: string, on: boolean) => {
  if (on) process.env[key] = '1';
  else delete process.env[key];
};

describe.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])('AI_MONITOR_ENABLED=%s, AI_THREATS_ENABLED=%s', (monitor, threats) => {
  beforeEach(() => {
    __resetCameraOwnershipForTests();
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    set('EXPO_PUBLIC_AI_MONITOR_ENABLED', monitor);
    set('EXPO_PUBLIC_AI_THREATS_ENABLED', threats);
    lastViewProps = null;
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    set('EXPO_PUBLIC_AI_MONITOR_ENABLED', env.monitor === '1');
    set('EXPO_PUBLIC_AI_THREATS_ENABLED', env.threats === '1');
    jest.restoreAllMocks();
  });

  it('enables exactly what the flags allow', () => {
    expect(isAiMonitorEnabled()).toBe(monitor);
    expect(isThreatDetectionEnabled()).toBe(monitor && threats);
  });

  it(`${monitor ? 'shows' : 'hides'} the Home entry`, () => {
    render(<AIMonitorCard />);
    expect(screen.queryByTestId('home-ai-monitor-card') != null).toBe(monitor);
  });

  it(`${monitor ? (threats ? 'runs the monitor with the threat dashboard' : 'runs the people monitor only') : 'never opens the camera'}`, async () => {
    const update = jest.spyOn(ThreatAssessmentEngine.prototype, 'update');
    render(<AIThreatMonitorScreen />);
    if (!monitor) {
      expect(screen.getByTestId('ai-monitor-unavailable')).toBeTruthy();
      expect(lastViewProps).toBeNull();
      expect(screen.queryByTestId('ai-monitor-start-btn')).toBeNull();
      return;
    }
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-monitor-start-btn'));
    });
    act(() => lastViewProps.onCameraState({ nativeEvent: { state: 'starting', sessionId: 1 } }));
    act(() => lastViewProps.onCameraState({ nativeEvent: { state: 'running', sessionId: 1 } }));
    act(() =>
      lastViewProps.onDetections({
        nativeEvent: { sessionId: 1, timestamp: 1000, frameWidth: 480, frameHeight: 640, inferenceMs: 30, targetFps: 8, rotationRate: 0, detections: [] },
      }),
    );
    expect(screen.queryByTestId('threat-dashboard') != null).toBe(threats);
    expect(update).toHaveBeenCalledTimes(threats ? 1 : 0);
    act(() => fireEvent.press(screen.getByTestId('ai-monitor-stop-btn')));
  });
});
