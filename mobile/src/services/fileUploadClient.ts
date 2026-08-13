import { File, UploadType } from 'expo-file-system';

import { API_URL } from '../config/emergencyConfig';
import { getAuthToken, refreshSession } from './apiClient';

// Shared by uploadService.ts (recordings) and covertMessageService.ts
// (steganographic PNGs) — same multipart-upload-with-retry-on-401 shape,
// different endpoint and form fields.
export async function uploadFileToEndpoint({
  endpointPath,
  localUri,
  contentType,
  parameters,
}: {
  endpointPath: string;
  localUri: string;
  contentType: string;
  parameters?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const performUpload = async () => {
    const accessToken = await getAuthToken();
    const file = new File(localUri);
    return file.upload(`${API_URL}${endpointPath}`, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: contentType,
      parameters,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
  };

  let result = await performUpload();

  if (result.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      result = await performUpload();
    }
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed with status ${result.status}`);
  }

  return JSON.parse(result.body) as Record<string, unknown>;
}
