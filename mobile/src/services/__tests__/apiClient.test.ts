// A stateful fake, not a bag of independent stubs — the real behavior under
// test (retry uses the token that refresh just wrote) depends on
// getAccessToken reflecting what setTokens most recently stored.
jest.mock('../tokenStorage', () => {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  return {
    getAccessToken: jest.fn(async () => accessToken),
    setAccessToken: jest.fn(async (token: string) => {
      accessToken = token;
    }),
    getRefreshToken: jest.fn(async () => refreshToken),
    setRefreshToken: jest.fn(async (token: string) => {
      refreshToken = token;
    }),
    setTokens: jest.fn(async (access: string, refresh: string) => {
      accessToken = access;
      refreshToken = refresh;
    }),
    clearTokens: jest.fn(async () => {
      accessToken = null;
      refreshToken = null;
    }),
  };
});

import * as tokenStorage from '../tokenStorage';
import { apiRequest, ApiError, setSessionExpiredHandler } from '../apiClient';

const mockedTokenStorage = tokenStorage as jest.Mocked<typeof tokenStorage>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    // apiRequest's main flow reads .text() (then JSON.parses it); the
    // refresh call inside performTokenRefresh reads .json() directly —
    // both need to work against the same mock response.
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('apiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.clearAllMocks();
    await mockedTokenStorage.setTokens('initial-access-token', 'initial-refresh-token');
    setSessionExpiredHandler(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('attaches the current access token as a bearer header', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiRequest('/api/emergency');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.get('Authorization')).toBe('Bearer initial-access-token');
  });

  test('on a 401, refreshes the token and retries the request once', async () => {
    const fetchMock = jest.fn();
    // 1st call: the original request, rejected with 401.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }));
    // 2nd call: apiClient's internal raw fetch to /api/auth/refresh.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));
    // 3rd call: the retried original request, now succeeding.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: 'ok' }));
    global.fetch = fetchMock;

    const result = await apiRequest('/api/emergency');

    expect(result).toEqual({ data: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockedTokenStorage.setTokens).toHaveBeenCalledWith('new-access', 'new-refresh');

    const retryCall = fetchMock.mock.calls[2];
    expect(retryCall[1].headers.get('Authorization')).toBe('Bearer new-access');
  });

  test('clears tokens and calls the session-expired handler when refresh itself fails', async () => {
    const sessionExpiredHandler = jest.fn();
    setSessionExpiredHandler(sessionExpiredHandler);

    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'expired' })); // original request
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid refresh token' })); // refresh call fails
    global.fetch = fetchMock;

    await expect(apiRequest('/api/emergency')).rejects.toBeInstanceOf(ApiError);

    expect(mockedTokenStorage.clearTokens).toHaveBeenCalled();
    expect(sessionExpiredHandler).toHaveBeenCalled();
    // Only 2 calls: no retry attempted since refresh failed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not attempt a refresh for the login/register/refresh endpoints themselves', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(401, { error: 'bad credentials' }));
    global.fetch = fetchMock;

    await expect(apiRequest('/api/auth/login', { auth: false })).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('concurrent 401s share a single in-flight refresh (single-flight)', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {})); // request A, 401
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {})); // request B, 401
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })); // one shared refresh
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { from: 'A' })); // retry A
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { from: 'B' })); // retry B
    global.fetch = fetchMock;

    const results = await Promise.all([
      apiRequest<{ from: string }>('/api/a'),
      apiRequest<{ from: string }>('/api/b'),
    ]);

    // Don't assume which retry consumed which mocked response (microtask
    // ordering isn't a contract this test should pin down) — just confirm
    // both requests succeeded with a retried value.
    expect(results.map((r) => r.from).sort()).toEqual(['A', 'B']);
    // 2 originals (401) + 1 shared refresh + 2 retries = 5, never 2 separate refreshes.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
