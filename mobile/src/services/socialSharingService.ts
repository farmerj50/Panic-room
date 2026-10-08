import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { apiRequest } from './apiClient';

export type SocialProvider = 'tiktok' | 'instagram';
export type SocialConnectionStatus = 'pending' | 'connected' | 'reauth_required' | 'revoked' | 'error';

export type SocialConnection = {
  provider: SocialProvider;
  status: SocialConnectionStatus;
  providerUsername: string | null;
  enabledForEmergency: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SocialConnectionsResponse = {
  connections: SocialConnection[];
  available: { tiktok: boolean; instagram: boolean };
};

export function listConnections(): Promise<SocialConnectionsResponse> {
  return apiRequest<SocialConnectionsResponse>('/api/social');
}

// The backend owns the OAuth client secret and the token exchange — this
// only opens the authorization URL in an in-app browser and watches for
// the app's own bes:// redirect at the end, same shape as any mobile
// OAuth-via-backend-proxy flow. Still rejects with
// ApiError(code: 'social_sharing_not_configured') if a provider somehow
// loses its backend config — SocialSharingScreen's existing handling for
// that stays correct with no change.
export async function connectProvider(provider: SocialProvider): Promise<void> {
  const { authorizationUrl } = await apiRequest<{ authorizationUrl: string }>(
    `/api/social/${provider}/connect`,
    { method: 'POST' },
  );

  const redirectUri = Linking.createURL('social-callback');
  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);

  if (result.type !== 'success' || !result.url) {
    throw new Error('cancelled');
  }

  const { queryParams } = Linking.parse(result.url);
  if (queryParams?.status !== 'connected') {
    throw new Error(typeof queryParams?.reason === 'string' ? queryParams.reason : 'connect_failed');
  }
}

// TikTok: PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY.
// Instagram: PUBLIC. Kept as a string — TikTok decides what's offered.
export type SocialPrivacyLevel = string;

export type SocialShareResult = {
  provider: SocialProvider;
  status: 'posted' | 'processing' | 'failed';
  privacyLevel?: SocialPrivacyLevel;
  error?: string;
};

export type SocialShareOptions = {
  // Required: the exact segment the user reviewed (from shareSegment.ts).
  // The backend posts that segment and nothing else — it never picks "the
  // newest" on its own.
  sequence: number;
  privacyLevel?: SocialPrivacyLevel;
  caption?: string;
};

export function postSocialShare(
  provider: SocialProvider,
  emergencyId: string,
  options: SocialShareOptions,
): Promise<SocialShareResult> {
  return apiRequest<SocialShareResult>(`/api/social/${provider}/share`, {
    method: 'POST',
    body: JSON.stringify({ emergencyId, ...options }),
  });
}

// What the Publishing screen may offer. The backend never fails this for a
// provider-side error — it falls back to that provider's safe default
// (TikTok: SELF_ONLY, Instagram: PUBLIC) — so callers only need to handle
// network failure, using the same per-provider default.
export async function getPublishOptions(provider: SocialProvider): Promise<{ privacyLevels: SocialPrivacyLevel[] }> {
  return apiRequest<{ privacyLevels: SocialPrivacyLevel[] }>(`/api/social/${provider}/publish-options`);
}

export const DEFAULT_PRIVACY_LEVEL: Record<SocialProvider, SocialPrivacyLevel> = {
  tiktok: 'SELF_ONLY',
  instagram: 'PUBLIC',
};

export function disconnectProvider(provider: SocialProvider): Promise<SocialConnection> {
  return apiRequest<SocialConnection>(`/api/social/${provider}`, { method: 'DELETE' });
}

export function updatePreference(provider: SocialProvider, enabledForEmergency: boolean): Promise<SocialConnection> {
  return apiRequest<SocialConnection>(`/api/social/${provider}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabledForEmergency }),
  });
}
