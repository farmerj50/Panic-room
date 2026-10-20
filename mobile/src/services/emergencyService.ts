import { Emergency, EmergencyVideoSegment } from '../types/Emergency';
import { Contact } from '../types/contact';
import { apiRequest } from './apiClient';

// `id` (generated on the phone at activation) makes the create idempotent:
// retrying it after a lost response or an outage returns the same emergency.
// `activatedAt`/`endedAt` carry the real times of an emergency recorded
// while offline (see pendingEmergencies).
export async function createEmergency(data: {
  id?: string;
  activatedAt?: string;
  latitude?: number;
  longitude?: number;
  status?: 'ACTIVE' | 'RESOLVED';
  endedAt?: string;
}): Promise<Emergency> {
  return apiRequest<Emergency>('/api/emergency', {
    method: 'POST',
    body: JSON.stringify({ ...data, status: data.status ?? 'ACTIVE', contactNotified: false }),
  });
}

export async function getEmergencies(): Promise<Emergency[]> {
  return apiRequest<Emergency[]>('/api/emergency');
}

export async function updateEmergency(
  id: string,
  data: { audioUrl?: string; videoUrl?: string; status?: string },
): Promise<Emergency> {
  return apiRequest<Emergency>(`/api/emergency/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export type NotifyResult = {
  smsAvailable?: boolean;
  providerConfigured: boolean;
  contactCount?: number;
  eligibleCount?: number;
  ineligibleCount?: number;
  queuedCount?: number;
  failedCount?: number;
  sent: boolean;
  notifiedCount: number;
  error?: string;
};

// The server decides who gets an emergency text — only stored contacts who
// accepted SMS alerts for their current number — so no numbers are sent.
// `contacts`/`message` stay in the signature for existing callers.
export async function notifyEmergencyContacts(data: {
  emergencyId: string;
  contacts?: Contact[];
  message?: string;
}): Promise<NotifyResult> {
  return apiRequest<NotifyResult>(`/api/emergency/${data.emergencyId}/notify`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function callEmergencyContacts(data: {
  contacts: Contact[];
  message: string;
}): Promise<{
  called: boolean;
  calledCount: number;
  providerConfigured: boolean;
  error?: string;
}> {
  return apiRequest<{
    called: boolean;
    calledCount: number;
    providerConfigured: boolean;
    error?: string;
  }>('/api/emergency/call', {
    method: 'POST',
    body: JSON.stringify({
      contacts: data.contacts.map(({ name, phoneNumber }) => ({ name, phoneNumber })),
      message: data.message,
    }),
  });
}

export async function createRecording(data: {
  fileUrl: string;
  type: 'audio' | 'video';
}): Promise<void> {
  await apiRequest<unknown>('/api/recordings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function addVideoSegment(
  emergencyId: string,
  data: {
    fileUrl: string;
    facing: 'front' | 'back';
    sequence: number;
    startedAt: string;
    endedAt?: string;
  },
): Promise<EmergencyVideoSegment> {
  return apiRequest<EmergencyVideoSegment>(`/api/emergency/${emergencyId}/video-segments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Live View (private browser links for trusted contacts) ─────────────────
export type LiveViewLinkStatus = {
  contactId: string;
  active: boolean;
  lastViewedAt: string | null;
  viewCount: number;
};

export type LiveViewShare = { url: string; expiresAt: string; shareMessage: string };

export async function getLiveViewStatus(
  emergencyId: string,
): Promise<{ enabled: boolean; links: LiveViewLinkStatus[] }> {
  return apiRequest(`/api/emergency/${emergencyId}/live-view`);
}

// The same link every time — sharing again never disconnects anyone.
export async function shareLiveView(emergencyId: string, contactId: string): Promise<LiveViewShare> {
  return apiRequest(`/api/emergency/${emergencyId}/live-view/${contactId}/share`, { method: 'POST' });
}

// Explicit reset: anyone with the previous link loses access.
export async function rotateLiveView(emergencyId: string, contactId: string): Promise<LiveViewShare> {
  return apiRequest(`/api/emergency/${emergencyId}/live-view/${contactId}/rotate`, { method: 'POST' });
}

export async function revokeLiveView(emergencyId: string, contactId?: string): Promise<{ revoked: number }> {
  return apiRequest(`/api/emergency/${emergencyId}/live-view${contactId ? `/${contactId}` : ''}`, { method: 'DELETE' });
}
