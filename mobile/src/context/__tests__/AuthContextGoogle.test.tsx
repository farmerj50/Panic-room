import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockSetTokens = jest.fn();
jest.mock('../../services/apiClient', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    getAuthToken: jest.fn().mockResolvedValue(null),
    clearAuthToken: jest.fn().mockResolvedValue(undefined),
    setTokens: (...a: unknown[]) => mockSetTokens(...a),
    setSessionExpiredHandler: jest.fn(),
  };
});

const mockGoogleSignInRequest = jest.fn();
const mockLinkGoogleRequest = jest.fn();
const mockUnlinkGoogleRequest = jest.fn();
const mockDeleteAccountRequest = jest.fn();
jest.mock('../../services/authService', () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  meRequest: jest.fn(),
  logoutRequest: jest.fn().mockResolvedValue(undefined),
  deleteAccountRequest: (...a: unknown[]) => mockDeleteAccountRequest(...a),
  googleSignInRequest: (...a: unknown[]) => mockGoogleSignInRequest(...a),
  linkGoogleRequest: (...a: unknown[]) => mockLinkGoogleRequest(...a),
  unlinkGoogleRequest: (...a: unknown[]) => mockUnlinkGoogleRequest(...a),
}));

const mockGetGoogleIdToken = jest.fn();
const mockSignOutGoogle = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/googleAuth', () => {
  class GoogleSignInCancelled extends Error {}
  return {
    GoogleSignInCancelled,
    getGoogleIdToken: (...a: unknown[]) => mockGetGoogleIdToken(...a),
    signOutGoogle: (...a: unknown[]) => mockSignOutGoogle(...a),
  };
});

jest.mock('../../services/nativeAnalytics', () => ({ getGA4ClientId: jest.fn().mockResolvedValue('ga-1') }));
jest.mock('../../services/purchasesService', () => ({
  loginPurchases: jest.fn().mockResolvedValue(undefined),
  logoutPurchases: jest.fn().mockResolvedValue(undefined),
}));
const mockGetOnboardingVariant = jest.fn().mockResolvedValue('onboarding');
jest.mock('../../services/experiments', () => ({ getOnboardingVariant: (...a: unknown[]) => mockGetOnboardingVariant(...a) }));
const mockTrackEvent = jest.fn();
jest.mock('../../services/analyticsService', () => ({ trackEvent: (...a: unknown[]) => mockTrackEvent(...a) }));
jest.mock('../../services/sessionFlags', () => ({ resetSessionFlags: jest.fn() }));

import { AuthProvider, GoogleLinkRequiredError, useAuth } from '../AuthContext';
import { ApiError } from '../../services/apiClient';
import { GoogleSignInCancelled } from '../../services/googleAuth';

const USER = { id: 'u1', email: 'g@gmail.com', name: 'G', createdAt: '2026-10-13', tourOffered: false, hasPassword: false, googleLinked: true };
const response = (isNewUser: boolean) => ({ accessToken: 'a', refreshToken: 'r', user: USER, isNewUser });
const events = () => mockTrackEvent.mock.calls.map(([name, params]) => [name, params]);

async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.status).toBe('unauthenticated'));
  return hook;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGoogleIdToken.mockResolvedValue('google-id-token');
  mockGetOnboardingVariant.mockResolvedValue('onboarding');
});

describe('signInWithGoogle', () => {
  test('a new Google user follows the sign-up path (onboarding, sign_up method google)', async () => {
    mockGoogleSignInRequest.mockResolvedValue(response(true));
    const { result } = await renderAuth();
    let outcome;
    await act(async () => {
      outcome = await result.current.signInWithGoogle();
    });
    expect(outcome).toBe('signed_in');
    expect(mockGoogleSignInRequest).toHaveBeenCalledWith({ idToken: 'google-id-token', ga4ClientId: expect.anything() });
    expect(mockSetTokens).toHaveBeenCalledWith('a', 'r');
    expect(result.current.status).toBe('authenticated');
    expect(result.current.postAuthTab).toBe('Home');
    expect(result.current.needsOnboarding).toBe(true);
    expect(events()).toEqual(
      expect.arrayContaining([['google_sign_in_started', undefined], ['sign_up', { variant: 'onboarding', method: 'google' }]]),
    );
  });

  test('a returning Google user follows the login path (login method google, no onboarding)', async () => {
    mockGoogleSignInRequest.mockResolvedValue(response(false));
    const { result } = await renderAuth();
    await act(async () => {
      await result.current.signInWithGoogle();
    });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.needsOnboarding).toBe(false);
    expect(result.current.postAuthTab).toBeNull();
    expect(events()).toEqual(expect.arrayContaining([['login', { method: 'google' }]]));
    expect(events().find(([n]) => n === 'sign_up')).toBeUndefined();
  });

  test('a cancelled picker is not an error: no request, no tokens, cancelled event', async () => {
    mockGetGoogleIdToken.mockRejectedValue(new GoogleSignInCancelled());
    const { result } = await renderAuth();
    let outcome;
    await act(async () => {
      outcome = await result.current.signInWithGoogle();
    });
    expect(outcome).toBe('cancelled');
    expect(mockGoogleSignInRequest).not.toHaveBeenCalled();
    expect(mockSetTokens).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unauthenticated');
    expect(events()).toEqual(expect.arrayContaining([['google_sign_in_cancelled', undefined]]));
  });

  test('a device-side Google failure (e.g. no Play Services) shows a message and resets Google', async () => {
    mockGetGoogleIdToken.mockRejectedValue(new Error('No Google Play services'));
    const { result } = await renderAuth();
    await act(async () => {
      await expect(result.current.signInWithGoogle()).rejects.toThrow(/continue with email/);
    });
    expect(mockSignOutGoogle).toHaveBeenCalled();
    expect(events()).toEqual(expect.arrayContaining([['google_sign_in_failed', { reason: 'google_error' }]]));
  });

  test('an existing email account: link-required error, nothing signed in', async () => {
    mockGoogleSignInRequest.mockRejectedValue(
      new ApiError('An account with this email already exists.', 409, 'account_exists_link_required'),
    );
    const { result } = await renderAuth();
    await act(async () => {
      await expect(result.current.signInWithGoogle()).rejects.toBeInstanceOf(GoogleLinkRequiredError);
    });
    expect(mockSetTokens).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unauthenticated');
    expect(mockSignOutGoogle).toHaveBeenCalled();
    expect(events()).toEqual(expect.arrayContaining([['google_sign_in_failed', { reason: 'account_exists_link_required' }]]));
  });

  test.each([
    [new ApiError("Google sign-in isn't available right now.", 503, 'google_not_configured'), /connection/],
    [new ApiError('Server error', 500), /connection/],
    [new ApiError("Your Google account's email isn't verified.", 401, 'google_email_unverified'), /isn't verified/],
    [new TypeError('Network request failed'), /connection/],
  ])('backend failure %p shows a message and resets Google', async (error, message) => {
    mockGoogleSignInRequest.mockRejectedValue(error);
    const { result } = await renderAuth();
    await act(async () => {
      await expect(result.current.signInWithGoogle()).rejects.toThrow(message);
    });
    expect(mockSetTokens).not.toHaveBeenCalled();
    expect(mockSignOutGoogle).toHaveBeenCalled();
  });
});

describe('linking, sign-out and deletion', () => {
  async function signedIn() {
    mockGoogleSignInRequest.mockResolvedValue(response(false));
    const hook = await renderAuth();
    await act(async () => {
      await hook.result.current.signInWithGoogle();
    });
    return hook;
  }

  test('linkGoogle sends the fresh Google token with the password and updates the user', async () => {
    const { result } = await signedIn();
    mockLinkGoogleRequest.mockResolvedValue({ user: { ...USER, hasPassword: true, googleLinked: true } });
    let outcome;
    await act(async () => {
      outcome = await result.current.linkGoogle('my-password');
    });
    expect(outcome).toBe('linked');
    expect(mockLinkGoogleRequest).toHaveBeenCalledWith({ idToken: 'google-id-token', password: 'my-password' });
    expect(result.current.user?.googleLinked).toBe(true);
  });

  test('logout and deletion also sign out of Google', async () => {
    const { result } = await signedIn();
    mockSignOutGoogle.mockClear();
    mockDeleteAccountRequest.mockResolvedValue(null);
    await act(async () => {
      await result.current.deleteAccount({ code: '123456', googleIdToken: 'fresh' });
    });
    expect(mockDeleteAccountRequest).toHaveBeenCalledWith({ code: '123456', googleIdToken: 'fresh' });
    expect(mockSignOutGoogle).toHaveBeenCalled();
    expect(result.current.status).toBe('unauthenticated');
  });
});
