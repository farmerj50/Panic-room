import { Emergency } from '../types/Emergency';
import { Contact } from '../types/contact';
import { apiRequest } from './apiClient';

export async function createEmergency(data: {
  latitude?: number;
  longitude?: number;
}): Promise<Emergency> {
  return apiRequest<Emergency>('/api/emergency', {
    method: 'POST',
    body: JSON.stringify({ ...data, status: 'ACTIVE', contactNotified: false }),
  });
}

export async function getEmergencies(): Promise<Emergency[]> {
  return apiRequest<Emergency[]>('/api/emergency');
}

export async function notifyEmergencyContacts(data: {
  emergencyId: string;
  contacts: Contact[];
  message: string;
}): Promise<{
  sent: boolean;
  notifiedCount: number;
  providerConfigured: boolean;
  error?: string;
}> {
  return apiRequest<{
    sent: boolean;
    notifiedCount: number;
    providerConfigured: boolean;
    error?: string;
  }>(`/api/emergency/${data.emergencyId}/notify`, {
    method: 'POST',
    body: JSON.stringify({
      contacts: data.contacts.map(({ name, phoneNumber }) => ({ name, phoneNumber })),
      message: data.message,
    }),
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
