import { apiRequest } from './apiClient';
import { Contact } from '../types/contact';

export async function saveContactToBackend(data: {
  name: string;
  phoneNumber: string;
  isPriority?: boolean;
}): Promise<Contact> {
  const saved = await apiRequest<Contact>('/api/contacts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return { ...saved, isPriority: Boolean(saved.isPriority) };
}

export async function getContactsFromBackend(): Promise<Contact[]> {
  const data = await apiRequest<Contact[]>('/api/contacts');
  return data.map((c: Contact) => ({ ...c, isPriority: Boolean(c.isPriority) }));
}

export async function updateContactInBackend(
  id: string,
  data: Partial<Pick<Contact, 'name' | 'phoneNumber' | 'isPriority'>>,
): Promise<Contact> {
  return apiRequest<Contact>(`/api/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteContactFromBackend(id: string): Promise<void> {
  await apiRequest<null>(`/api/contacts/${id}`, {
    method: 'DELETE',
  });
}

export type SmsInvite = { url: string; shareMessage: string; expiresAt: string };

// A fresh single-use link the contact opens in any browser to accept (or
// decline) emergency text alerts. Issuing one revokes any earlier link.
export async function createSmsInvite(contactId: string): Promise<SmsInvite> {
  return apiRequest<SmsInvite>(`/api/contacts/${contactId}/sms-invite`, { method: 'POST' });
}
