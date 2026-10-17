import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
let mockAvailable = true;
jest.mock('../services/besVision', () => ({
  get isBesVisionAvailable() {
    return mockAvailable;
  },
}));

import AIMonitorCard from '../components/AIMonitorCard';

describe('AIMonitorCard (rollout flag)', () => {
  const original = process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED;
  const originalOS = Platform.OS;
  afterEach(() => {
    process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED = original;
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    mockAvailable = true;
  });
  const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { value: os });

  it('is hidden when the flag is not set (release default)', () => {
    delete process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED;
    setOS('android');
    render(<AIMonitorCard />);
    expect(screen.queryByTestId('home-ai-monitor-card')).toBeNull();
  });

  it('is hidden on iOS and web even with the flag on', () => {
    process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED = '1';
    for (const os of ['ios', 'web']) {
      setOS(os);
      const { unmount } = render(<AIMonitorCard />);
      expect(screen.queryByTestId('home-ai-monitor-card')).toBeNull();
      unmount();
    }
  });

  it('is hidden when the native module is missing', () => {
    process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED = '1';
    setOS('android');
    mockAvailable = false;
    render(<AIMonitorCard />);
    expect(screen.queryByTestId('home-ai-monitor-card')).toBeNull();
  });

  it('shows on Android with the flag on and opens the monitor', () => {
    process.env.EXPO_PUBLIC_AI_MONITOR_ENABLED = '1';
    setOS('android');
    render(<AIMonitorCard />);
    fireEvent.press(screen.getByTestId('home-ai-monitor-card'));
    expect(mockNavigate).toHaveBeenCalledWith('AIMonitor');
  });
});
