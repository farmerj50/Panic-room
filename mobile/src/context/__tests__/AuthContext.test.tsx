import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockGetAuthToken = jest.fn();
const mockClearAuthToken = jest.fn();
const mockSetTokens = jest.fn();
const mockSetSessionExpiredHandler = jest.fn();
jest.mock('../../services/apiClient', () => ({
  getAuthToken: (...args: unknown[]) => mockGetAuthToken(...args),
  clearAuthToken: (...args: unknown[]) => mockClearAuthToken(...args),
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
  setSessionExpiredHandler: (...args: unknown[]) => mockSetSessionExpiredHandler(...args),
}));

const mockLoginRequest = jest.fn();
const mockRegisterRequest = jest.fn();
const mockMeRequest = jest.fn();
const mockLogoutRequest = jest.fn();
const mockDeleteAccountRequest = jest.fn();
jest.mock('../../services/authService', () => ({
  loginRequest: (...args: unknown[]) => mockLoginRequest(...args),
  registerRequest: (...args: unknown[]) => mockRegisterRequest(...args),
  meRequest: (...args: unknown[]) => mockMeRequest(...args),
  logoutRequest: (...args: unknown[]) => mockLogoutRequest(...args),
  deleteAccountRequest: (...args: unknown[]) => mockDeleteAccountRequest(...args),
}));

const mockLoginPurchases = jest.fn();
const mockLogoutPurchases = jest.fn();
jest.mock('../../services/purchasesService', () => ({
  loginPurchases: (...args: unknown[]) => mockLoginPurchases(...args),
  logoutPurchases: (...args: unknown[]) => mockLogoutPurchases(...args),
}));

import { AuthProvider, useAuth } from '../AuthContext';

const USER = { id: 'u1', email: 'a@b.com', name: 'A', createdAt: '2025-01-01' };
const AUTH_RESPONSE = { accessToken: 'access', refreshToken: 'refresh', user: USER };

// Renders the provider and waits for the mount-time session-restore effect
// (getAuthToken -> meRequest, seeded to "no token" below) to settle, so
// tests start from a known 'unauthenticated' state rather than racing it.
async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.status).toBe('unauthenticated'));
  return hook;
}

describe('AuthContext needsOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthToken.mockResolvedValue(null);
    mockLoginRequest.mockResolvedValue(AUTH_RESPONSE);
    mockRegisterRequest.mockResolvedValue(AUTH_RESPONSE);
    mockLoginPurchases.mockResolvedValue(undefined);
    mockLogoutPurchases.mockResolvedValue(undefined);
  });

  test('register() sets needsOnboarding to true', async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.register('A', 'a@b.com', 'password123456');
    });

    expect(result.current.needsOnboarding).toBe(true);
  });

  // The one behavior this suite exists to lock down: a returning user must
  // never be routed back through onboarding — only register() may set the
  // flag, login() must leave it false.
  test('login() leaves needsOnboarding false, even after a prior register() in the same session', async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.register('A', 'a@b.com', 'password123456');
    });
    expect(result.current.needsOnboarding).toBe(true);

    await act(async () => {
      await result.current.consumeOnboarding();
    });
    expect(result.current.needsOnboarding).toBe(false);

    await act(async () => {
      await result.current.login('a@b.com', 'password123456');
    });

    expect(result.current.needsOnboarding).toBe(false);
  });

  test('logout() resets needsOnboarding to false', async () => {
    const { result } = await renderAuth();

    await act(async () => {
      await result.current.register('A', 'a@b.com', 'password123456');
    });
    expect(result.current.needsOnboarding).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.needsOnboarding).toBe(false);
  });
});
