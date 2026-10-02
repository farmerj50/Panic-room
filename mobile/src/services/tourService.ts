import { apiRequest } from './apiClient';

export async function reportTourStatus(status: 'completed' | 'skipped'): Promise<void> {
  await apiRequest<null>('/api/users/me/tour', {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
