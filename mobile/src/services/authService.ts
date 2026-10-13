import { apiRequest } from './apiClient';
import { getRefreshToken } from './tokenStorage';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  publicKey?: string;
  phoneNumber?: string;
  tourOffered: boolean;
  // False for accounts created with Google (no password set).
  hasPassword?: boolean;
  googleLinked?: boolean;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type GoogleAuthResponse = AuthResponse & { isNewUser: boolean };

// 409 account_exists_link_required when the email already has a Bes account:
// it is never linked or signed in automatically.
export function googleSignInRequest(data: { idToken: string; ga4ClientId?: string }) {
  return apiRequest<GoogleAuthResponse>('/api/auth/google', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

// Signed-in, password-confirmed linking of a Google account.
export function linkGoogleRequest(data: { idToken: string; password: string }) {
  return apiRequest<{ user: AuthUser }>('/api/auth/google/link', { method: 'POST', body: JSON.stringify(data) });
}

export function unlinkGoogleRequest() {
  return apiRequest<{ user: AuthUser }>('/api/auth/google/link', { method: 'DELETE' });
}

// Google-only accounts: emails a deletion code; returns the nonce for the
// fresh Google sign-in that must accompany it.
export function deletionChallengeRequest() {
  return apiRequest<{ nonce: string; expiresAt: string }>('/api/users/me/delete-challenge', { method: 'POST' });
}

export function loginRequest(data: { email: string; password: string }) {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

export function registerRequest(data: { name: string; email: string; password: string; ga4ClientId?: string }) {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

export function meRequest() {
  return apiRequest<{ user: AuthUser }>('/api/auth/me');
}

export function forgotPasswordRequest(email: string) {
  return apiRequest<{ message: string }>('/api/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ email }),
  });
}

export function resetPasswordRequest(data: { email: string; code: string; newPassword: string }) {
  return apiRequest<null>('/api/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(data),
  });
}

// Throws ApiError on failure (e.g. wrong password) — caller must not treat
// this as best-effort like logoutRequest, since a failure here means the
// account was NOT deleted and local state must not be cleared.
export type DeletionProof = { password: string } | { code: string; googleIdToken: string };

export function deleteAccountRequest(proof: DeletionProof) {
  return apiRequest<null>('/api/users/me', {
    method: 'DELETE',
    body: JSON.stringify(proof),
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
