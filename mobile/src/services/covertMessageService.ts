import { apiRequest } from './apiClient';
import { uploadFileToEndpoint } from './fileUploadClient';

export type CovertMessage = {
  id: string;
  createdAt: string;
  senderId: string;
  status: 'SENT' | 'READ';
  protocolVersion: number;
  fileUrl: string;
};

export async function getRecipientPublicKey(contactId: string): Promise<{ publicKey: string }> {
  return apiRequest<{ publicKey: string }>(`/api/covert-messages/recipient-key/${contactId}`);
}

export async function uploadCovertImage(localUri: string): Promise<{ key: string }> {
  const result = await uploadFileToEndpoint({
    endpointPath: '/api/covert-messages/upload',
    localUri,
    contentType: 'image/png',
  });
  return result as { key: string };
}

export async function createCovertMessage(data: {
  recipientContactId: string;
  fileKey: string;
}): Promise<CovertMessage> {
  return apiRequest<CovertMessage>('/api/covert-messages', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getCovertInbox(): Promise<CovertMessage[]> {
  return apiRequest<CovertMessage[]>('/api/covert-messages/inbox');
}

export async function markCovertMessageRead(id: string): Promise<CovertMessage> {
  return apiRequest<CovertMessage>(`/api/covert-messages/${id}`, {
    method: 'PATCH',
  });
}

export async function setMyPublicKey(publicKey: string): Promise<void> {
  await apiRequest<null>('/api/users/me/public-key', {
    method: 'PUT',
    body: JSON.stringify({ publicKey }),
  });
}

export async function setMyPhoneNumber(phoneNumber: string): Promise<void> {
  await apiRequest<null>('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify({ phoneNumber }),
  });
}
