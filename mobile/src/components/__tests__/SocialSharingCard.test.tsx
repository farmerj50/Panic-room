import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockNavigate = jest.fn();
let mockFocus: (() => void | (() => void)) | null = null;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    mockFocus = cb;
    useEffect(cb, [cb]);
  },
}));

let mockIsPremium = false;
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../context/SubscriptionContext', () => ({ useSubscription: () => ({ isPremium: mockIsPremium }) }));
jest.mock('../../services/analyticsService', () => ({ trackEvent: jest.fn() }));
const mockListConnections = jest.fn();
jest.mock('../../services/socialSharingService', () => ({ listConnections: (...a: unknown[]) => mockListConnections(...a) }));

import SocialSharingCard from '../SocialSharingCard';
import {
  CARD_SNOOZE_MS,
  dismissHomeCard,
  hasRemindAfterEmergency,
  setRemindAfterEmergency,
  shouldShowHomeCard,
} from '../../services/socialSharingPrompts';

const flush = () => act(async () => {});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNavigate.mockReset();
  mockIsPremium = false;
  mockListConnections.mockReset().mockResolvedValue({ connections: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('Home card dismissal rules', () => {
  test('30-day snooze, and at most 2 re-shows after the first dismissal', async () => {
    const t0 = Date.parse('2026-10-13T00:00:00Z');
    expect(await shouldShowHomeCard('u1', t0)).toBe(true);

    await dismissHomeCard('u1', t0); // 1st dismissal
    expect(await shouldShowHomeCard('u1', t0 + CARD_SNOOZE_MS - 1)).toBe(false);
    expect(await shouldShowHomeCard('u1', t0 + CARD_SNOOZE_MS)).toBe(true); // re-show #1

    await dismissHomeCard('u1', t0 + CARD_SNOOZE_MS); // 2nd
    expect(await shouldShowHomeCard('u1', t0 + 2 * CARD_SNOOZE_MS)).toBe(true); // re-show #2

    await dismissHomeCard('u1', t0 + 2 * CARD_SNOOZE_MS); // 3rd
    expect(await shouldShowHomeCard('u1', t0 + 10 * CARD_SNOOZE_MS)).toBe(false); // never again
    expect(await shouldShowHomeCard('another-user', t0)).toBe(true); // per user
  });
});

describe('SocialSharingCard', () => {
  test('free account: Premium card → Paywall, with no connections request', async () => {
    render(<SocialSharingCard />);
    await flush();
    expect(screen.getByTestId('home-social-sharing-card')).toHaveTextContent(/Premium/);
    expect(mockListConnections).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('home-social-sharing-connect'));
    expect(mockNavigate).toHaveBeenCalledWith('Paywall', { reason: 'social-sharing' });
  });

  test('Premium, not connected: Connect → Social Sharing', async () => {
    mockIsPremium = true;
    render(<SocialSharingCard />);
    await flush();
    fireEvent.press(screen.getByTestId('home-social-sharing-connect'));
    expect(mockNavigate).toHaveBeenCalledWith('SocialSharing');
  });

  test('hidden once an account is connected', async () => {
    mockIsPremium = true;
    mockListConnections.mockResolvedValue({ connections: [{ provider: 'tiktok', status: 'connected', enabledForEmergency: true }] });
    render(<SocialSharingCard />);
    await flush();
    expect(screen.queryByTestId('home-social-sharing-card')).toBeNull();
  });

  test('Not now hides it and records the dismissal', async () => {
    render(<SocialSharingCard />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-social-sharing-dismiss'));
    });
    expect(screen.queryByTestId('home-social-sharing-card')).toBeNull();
    expect(await shouldShowHomeCard('u1')).toBe(false);
  });
});

describe('after-emergency reminder', () => {
  test('Home focus shows it but does NOT clear it; it clears only when the user acts', async () => {
    await setRemindAfterEmergency('u1');
    render(<SocialSharingCard />);
    await flush();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await hasRemindAfterEmergency('u1')).toBe(true); // shown, not yet acted on

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'See Premium')!.onPress!();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Paywall', { reason: 'social-sharing' });
    expect(await hasRemindAfterEmergency('u1')).toBe(false);
  });

  test('if the app goes away before the user acts, the reminder survives for next time', async () => {
    await setRemindAfterEmergency('u1');
    const first = render(<SocialSharingCard />);
    await flush();
    first.unmount(); // crash / navigation away with the sheet still up
    expect(await hasRemindAfterEmergency('u1')).toBe(true);

    (Alert.alert as jest.Mock).mockClear();
    render(<SocialSharingCard />);
    await flush();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  test('"Not now" and a back-press dismissal both clear it without navigating', async () => {
    await setRemindAfterEmergency('u1');
    render(<SocialSharingCard />);
    await flush();
    const [, , buttons, options] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => {
      (options as { onDismiss: () => void }).onDismiss();
    });
    expect(await hasRemindAfterEmergency('u1')).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect((buttons as { text: string }[]).map((b) => b.text)).toEqual(['Not now', 'See Premium']);
  });

  test('re-focusing while the sheet is open does not open a second one', async () => {
    await setRemindAfterEmergency('u1');
    render(<SocialSharingCard />);
    await flush();
    await act(async () => {
      mockFocus?.();
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
