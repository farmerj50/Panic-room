import { apiRequest } from './apiClient';
import { getRefreshToken } from './tokenStorage';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  publicKey?: string;
  phoneNumber?: string;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export function loginRequest(data: { email: string; password: string }) {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

export function registerRequest(data: { name: string; email: string; password: string }) {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

export function meRequest() {
  return apiRequest<{ user: AuthUser }>('/api/auth/me');
}

// Throws ApiError on failure (e.g. wrong password) — caller must not treat
// this as best-effort like logoutRequest, since a failure here means the
// account was NOT deleted and local state must not be cleared.
export function deleteAccountRequest(password: string) {
  return apiRequest<null>('/api/users/me', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

export async function logoutRequest() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return;

  try {
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Best-effort: local logout must succeed even if the server is
    // unreachable, so a network failure here is not fatal.
  }
}
