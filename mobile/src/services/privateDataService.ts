import { apiRequest } from './apiClient';

export async function getPrivateData<T>(key: string): Promise<T | null> {
  const response = await apiRequest<{ data: T | null }>(`/api/private-data/${key}`);
  return response.data;
}

export async function savePrivateData<T>(key: string, data: T): Promise<void> {
  await apiRequest<{ key: string; updatedAt: string }>(`/api/private-data/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  });
}

export async function deletePrivateData(key: string): Promise<void> {
  await apiRequest<null>(`/api/private-data/${key}`, {
    method: 'DELETE',
  });
}
