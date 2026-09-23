import { apiRequest } from './apiClient';

export type RelationshipType = 'child' | 'family' | 'friend';
export type LinkStatus = 'pending' | 'active' | 'revoked';

export type LinkPermissions = {
  emergencyAlerts: boolean;
  liveLocationDuringEmergency: boolean;
  backgroundLocation: boolean;
};

export type OwnedLink = {
  id: string;
  createdAt: string;
  relationshipType: RelationshipType;
  status: LinkStatus;
  permissions: LinkPermissions;
  linkedUserName: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
};

export type LinkToMe = {
  id: string;
  createdAt: string;
  relationshipType: RelationshipType;
  permissions: LinkPermissions;
  ownerName: string;
  acceptedAt: string | null;
};

export type CreatedInvite = {
  id: string;
  relationshipType: RelationshipType;
  status: LinkStatus;
  code: string;
  expiresAt: string;
};

// Narrow consent-preview DTO — deliberately not the raw permissions
// object, so the consent screen's contract is intentional. See
// accountLinkController.js's previewInvite for why.
export type InvitePreview = {
  linkId: string;
  ownerName: string;
  relationshipType: RelationshipType;
  sharesEmergencyAlerts: boolean;
  sharesLiveLocationDuringEmergency: boolean;
  backgroundLocationEligible: boolean;
  expiresAt: string;
};

export function createInvite(relationshipType: RelationshipType): Promise<CreatedInvite> {
  return apiRequest<CreatedInvite>('/api/account-links/invite', {
    method: 'POST',
    body: JSON.stringify({ relationshipType }),
  });
}

export function previewInvite(code: string): Promise<InvitePreview> {
  return apiRequest<InvitePreview>('/api/account-links/preview', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function acceptInvite(code: string): Promise<LinkToMe> {
  return apiRequest<LinkToMe>('/api/account-links/accept', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function getOwnedLinks(): Promise<OwnedLink[]> {
  return apiRequest<OwnedLink[]>('/api/account-links');
}

export function getLinksToMe(): Promise<LinkToMe[]> {
  return apiRequest<LinkToMe[]>('/api/account-links/linked-to-me');
}

export function updateLinkPermissions(
  id: string,
  data: Partial<Pick<LinkPermissions, 'emergencyAlerts' | 'liveLocationDuringEmergency'>>,
): Promise<OwnedLink> {
  return apiRequest<OwnedLink>(`/api/account-links/${id}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function revokeLink(id: string): Promise<void> {
  return apiRequest<void>(`/api/account-links/${id}`, {
    method: 'DELETE',
  });
}
