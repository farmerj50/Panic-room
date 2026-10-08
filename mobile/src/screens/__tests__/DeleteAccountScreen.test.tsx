import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

const mockDeleteAccount = jest.fn();
const mockNavigate = jest.fn();
const mockListConnections = jest.fn();
let mockIsPremium = false;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ deleteAccount: mockDeleteAccount }),
}));

jest.mock('../../context/SubscriptionContext', () => ({
  useSubscription: () => ({ isPremium: mockIsPremium }),
}));

jest.mock('../../services/socialSharingService', () => ({
  listConnections: (...args: unknown[]) => mockListConnections(...args),
}));

import DeleteAccountScreen, { PLAY_SUBSCRIPTIONS_URL } from '../DeleteAccountScreen';

// Presses the destructive button of the most recent Alert.alert call.
function pressAlertButton(text: string) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2] as { text: string; onPress?: () => unknown }[];
  return buttons.find((b) => b.text === text)?.onPress?.();
}

function isDisabled(testID: string) {
  return screen.getByTestId(testID).props.accessibilityState?.disabled === true;
}

async function renderScreen() {
  render(<DeleteAccountScreen />);
  await act(async () => {}); // let listConnections settle
}

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    mockIsPremium = false;
    mockDeleteAccount.mockReset();
    mockNavigate.mockReset();
    mockListConnections.mockReset().mockResolvedValue({ connections: [] });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('shows what gets deleted and the evidence warning', async () => {
    await renderScreen();
    expect(screen.getByText('Recordings and stored evidence')).toBeTruthy();
    expect(screen.getByTestId('delete-account-evidence-warning')).toBeTruthy();
    fireEvent.press(screen.getByTestId('delete-account-go-evidence'));
    expect(mockNavigate).toHaveBeenCalledWith('Evidence');
  });

  test('Delete stays disabled until a password is entered', async () => {
    await renderScreen();
    expect(isDisabled('delete-account-confirm-btn')).toBe(true);
    fireEvent.changeText(screen.getByTestId('delete-account-password-input'), 'secret');
    expect(isDisabled('delete-account-confirm-btn')).toBe(false);
  });

  test('free users see no subscription block or checkbox', async () => {
    await renderScreen();
    expect(screen.queryByTestId('delete-account-pro-notice')).toBeNull();
    expect(screen.queryByTestId('delete-account-subscription-ack')).toBeNull();
  });

  test('subscribers must acknowledge billing continues before Delete enables — cancelling is not required', async () => {
    mockIsPremium = true;
    await renderScreen();
    expect(screen.getByTestId('delete-account-pro-notice')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('delete-account-password-input'), 'secret');
    expect(isDisabled('delete-account-confirm-btn')).toBe(true);

    fireEvent.press(screen.getByTestId('delete-account-subscription-ack'));
    expect(screen.getByTestId('delete-account-subscription-ack').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(isDisabled('delete-account-confirm-btn')).toBe(false);
  });

  test('the Google Play button opens the subscriptions page', async () => {
    mockIsPremium = true;
    await renderScreen();
    fireEvent.press(screen.getByTestId('delete-account-cancel-subscription-btn'));
    expect(Linking.openURL).toHaveBeenCalledWith(PLAY_SUBSCRIPTIONS_URL);
  });

  test('deletes only after the final confirmation, with the entered password', async () => {
    mockDeleteAccount.mockResolvedValue(undefined);
    await renderScreen();
    fireEvent.changeText(screen.getByTestId('delete-account-password-input'), 'secret');
    fireEvent.press(screen.getByTestId('delete-account-confirm-btn'));

    expect(Alert.alert).toHaveBeenCalledWith('Are you absolutely sure?', expect.any(String), expect.any(Array));
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    await act(async () => {
      await pressAlertButton('Delete My Account');
    });
    expect(mockDeleteAccount).toHaveBeenCalledWith('secret');
  });

  test('cancelling the final confirmation deletes nothing', async () => {
    await renderScreen();
    fireEvent.changeText(screen.getByTestId('delete-account-password-input'), 'secret');
    fireEvent.press(screen.getByTestId('delete-account-confirm-btn'));
    pressAlertButton('Cancel');
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  test('a server error is shown and the button re-enables', async () => {
    mockDeleteAccount.mockRejectedValue(new Error('Incorrect password.'));
    await renderScreen();
    fireEvent.changeText(screen.getByTestId('delete-account-password-input'), 'wrong');
    fireEvent.press(screen.getByTestId('delete-account-confirm-btn'));
    await act(async () => {
      await pressAlertButton('Delete My Account');
    });

    expect(Alert.alert).toHaveBeenLastCalledWith('Could not delete account', 'Incorrect password.');
    expect(isDisabled('delete-account-confirm-btn')).toBe(false);
  });

  test('connected accounts get the TikTok/Instagram note', async () => {
    mockListConnections.mockResolvedValue({
      connections: [
        { provider: 'tiktok', status: 'connected' },
        { provider: 'instagram', status: 'connected' },
      ],
    });
    await renderScreen();
    expect(screen.getByTestId('delete-account-social-note')).toBeTruthy();
    expect(screen.getByText(/revoke Bes's TikTok access/)).toBeTruthy();
    expect(screen.getByText(/Business integrations/)).toBeTruthy();
  });
});
