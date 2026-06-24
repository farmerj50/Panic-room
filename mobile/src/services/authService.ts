import { apiRequest } from './apiClient';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
};

export type AuthResponse = {
  token: string;
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
