import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

let mockUser: Record<string, unknown> = { id: 'u1', email: 'g@gmail.com', hasPassword: false, googleLinked: true };
const mockDeleteAccount = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockLinkGoogle = jest.fn();
const mockUnlinkGoogle = jest.fn();
jest.mock('../../context/AuthContext', () => {
  class GoogleLinkRequiredError extends Error {}
  return {
    GoogleLinkRequiredError,
    useAuth: () => ({
      user: mockUser,
      deleteAccount: mockDeleteAccount,
      signInWithGoogle: mockSignInWithGoogle,
      linkGoogle: mockLinkGoogle,
      unlinkGoogle: mockUnlinkGoogle,
    }),
  };
});
jest.mock('../../context/SubscriptionContext', () => ({ useSubscription: () => ({ isPremium: false }) }));
jest.mock('../../services/socialSharingService', () => ({ listConnections: jest.fn().mockResolvedValue({ connections: [] }) }));
jest.mock('../../components/StoreBadges', () => () => null);

let mockGoogleEnabled = true;
const mockGetGoogleIdToken = jest.fn();
jest.mock('../../services/googleAuth', () => {
  class GoogleSignInCancelled extends Error {}
  return {
    GoogleSignInCancelled,
    fetchGoogleEnabled: () => Promise.resolve(mockGoogleEnabled),
    getGoogleIdToken: (...a: unknown[]) => mockGetGoogleIdToken(...a),
  };
});
const mockDeletionChallenge = jest.fn();
jest.mock('../../services/authService', () => ({ deletionChallengeRequest: (...a: unknown[]) => mockDeletionChallenge(...a) }));

import LandingScreen from '../LandingScreen';
import DeleteAccountScreen from '../DeleteAccountScreen';
import GoogleAccountRow from '../../components/GoogleAccountRow';
import { GoogleLinkRequiredError } from '../../context/AuthContext';
import { GoogleSignInCancelled } from '../../services/googleAuth';

const flush = () => act(async () => {});
const alertButtons = () => (Alert.alert as jest.Mock).mock.calls.at(-1)[2] as { text: string; onPress?: () => unknown }[];

beforeEach(() => {
  jest.clearAllMocks();
  mockGoogleEnabled = true;
  mockUser = { id: 'u1', email: 'g@gmail.com', hasPassword: false, googleLinked: true };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('welcome screen', () => {
  test('new headline, Google first, email and sign-in options — and no Pro advertisement', async () => {
    render(<LandingScreen />);
    await flush();
    expect([].concat(screen.getByTestId('landing-headline').props.children).join('')).toBe('Help without\nsaying a word.');
    expect(screen.getByTestId('landing-google-btn')).toHaveTextContent(/Continue with Google/);
    expect(screen.getByTestId('landing-continue-email-btn')).toHaveTextContent(/Continue with Email/);
    expect(screen.getByText('Already have an account? Sign in')).toBeTruthy();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/4\.99|BES PRO|Covert Messaging/);
  });

  test('without Google configured, the email options still work', async () => {
    mockGoogleEnabled = false;
    render(<LandingScreen />);
    await flush();
    expect(screen.queryByTestId('landing-google-btn')).toBeNull();
    fireEvent.press(screen.getByTestId('landing-continue-email-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('Register');
  });

  test('Continue with Google: a cancelled picker is silent; an existing account explains how to link', async () => {
    mockSignInWithGoogle.mockResolvedValueOnce('cancelled');
    render(<LandingScreen />);
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByTestId('landing-google-btn'));
    });
    expect(Alert.alert).not.toHaveBeenCalled();

    mockSignInWithGoogle.mockRejectedValueOnce(new GoogleLinkRequiredError('exists'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('landing-google-btn'));
    });
    expect(Alert.alert).toHaveBeenCalledWith('You already have a Bes account', expect.stringContaining('connect Google in Settings'));
  });
});

describe('Delete Account for a Google-only account', () => {
  async function renderDelete() {
    render(<DeleteAccountScreen />);
    await flush();
  }

  test('no password field; emailed code + fresh Google sign-in with the server nonce', async () => {
    mockDeletionChallenge.mockResolvedValue({ nonce: 'server-nonce', expiresAt: 'x' });
    mockGetGoogleIdToken.mockResolvedValue('fresh-google-token');
    mockDeleteAccount.mockResolvedValue(undefined);
    await renderDelete();
    expect(screen.queryByTestId('delete-account-password-input')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-send-code-btn'));
    });
    fireEvent.changeText(screen.getByTestId('delete-account-code-input'), '12 34-56');
    fireEvent.press(screen.getByTestId('delete-account-confirm-btn'));
    await act(async () => {
      await alertButtons().find((b) => b.text === 'Delete My Account')!.onPress!();
    });

    expect(mockGetGoogleIdToken).toHaveBeenCalledWith({ nonce: 'server-nonce' });
    expect(mockDeleteAccount).toHaveBeenCalledWith({ code: '123456', googleIdToken: 'fresh-google-token' });
  });

  test('backing out of the Google confirmation deletes nothing', async () => {
    mockDeletionChallenge.mockResolvedValue({ nonce: 'n', expiresAt: 'x' });
    mockGetGoogleIdToken.mockRejectedValue(new GoogleSignInCancelled());
    await renderDelete();
    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-send-code-btn'));
    });
    fireEvent.changeText(screen.getByTestId('delete-account-code-input'), '123456');
    fireEvent.press(screen.getByTestId('delete-account-confirm-btn'));
    await act(async () => {
      await alertButtons().find((b) => b.text === 'Delete My Account')!.onPress!();
    });
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  test('password accounts still confirm with their password', async () => {
    mockUser = { id: 'u2', email: 'e@x.com', hasPassword: true, googleLinked: false };
    await renderDelete();
    expect(screen.getByTestId('delete-account-password-input')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-send-code-btn')).toBeNull();
  });
});

describe('Settings → Google', () => {
  test('a password account connects Google only after entering its password', async () => {
    mockUser = { id: 'u3', email: 'e@x.com', hasPassword: true, googleLinked: false };
    mockLinkGoogle.mockResolvedValue('linked');
    render(<GoogleAccountRow />);
    await flush();
    expect(screen.getByTestId('settings-google-row')).toHaveTextContent(/Connect Google/);
    fireEvent.press(screen.getByTestId('settings-google-row'));
    expect(screen.getByTestId('settings-google-connect-btn').props.accessibilityState?.disabled ?? true).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('settings-google-password-input'), 'my-password');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-google-connect-btn'));
    });
    expect(mockLinkGoogle).toHaveBeenCalledWith('my-password');
    expect(Alert.alert).toHaveBeenCalledWith('Google connected', expect.any(String));
  });

  test('a linked password account can disconnect after confirming', async () => {
    mockUser = { id: 'u4', email: 'e@x.com', hasPassword: true, googleLinked: true };
    mockUnlinkGoogle.mockResolvedValue(undefined);
    render(<GoogleAccountRow />);
    await flush();
    fireEvent.press(screen.getByTestId('settings-google-row'));
    await act(async () => {
      alertButtons().find((b) => b.text === 'Disconnect')!.onPress!();
    });
    expect(mockUnlinkGoogle).toHaveBeenCalled();
  });

  test('a Google-only account shows "Signed in with Google" and offers no disconnect', async () => {
    render(<GoogleAccountRow />);
    await flush();
    expect(screen.getByTestId('settings-google-row')).toHaveTextContent(/Signed in with Google/);
    fireEvent.press(screen.getByTestId('settings-google-row'));
    expect(mockUnlinkGoogle).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
