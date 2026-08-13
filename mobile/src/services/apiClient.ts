import { API_URL } from '../config/emergencyConfig';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from './tokenStorage';

// Re-exported so existing callers (AuthContext) keep working against the new
// SecureStore-backed storage without needing to import tokenStorage directly.
export { getAccessToken as getAuthToken, clearTokens as clearAuthToken, setTokens };

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiRequestOptions = RequestInit & {
  auth?: boolean;
};

// Paths that must never trigger a refresh-and-retry (refresh itself would
// recurse; login/register have no access token to refresh yet).
const NO_REFRESH_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'];

let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}

let refreshPromise: Promise<boolean> | null = null;

async function performTokenRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearTokens();
      sessionExpiredHandler?.();
      return false;
    }

    const payload = await response.json();
    await setTokens(payload.accessToken, payload.refreshToken);
    return true;
  } catch {
    // Network failure during refresh: leave existing tokens in place so a
    // transient outage doesn't log the user out; the caller's original
    // request will simply fail and can be retried later.
    return false;
  }
}

function refreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Exposed for callers that talk to the backend outside apiRequest (e.g. the
// native multipart upload task in uploadService.ts) and need the same
// single-flight refresh-on-401 behavior.
export const refreshSession = refreshTokens;

async function performRequest<T>(path: string, options: ApiRequestOptions): Promise<Response> {
  const token = options.auth === false ? null : await getAccessToken();
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let response = await performRequest<T>(path, options);

  if (
    response.status === 401 &&
    options.auth !== false &&
    !NO_REFRESH_PATHS.includes(path)
  ) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      response = await performRequest<T>(path, options);
    }
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(payload?.error || payload?.message || 'Request failed', response.status);
  }

  return payload as T;
}
