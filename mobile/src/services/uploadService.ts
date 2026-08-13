import { uploadFileToEndpoint } from './fileUploadClient';

export type UploadAssetKind = 'audio' | 'video';

function guessContentType(localUri: string, kind: UploadAssetKind): string {
  const ext = localUri.split('.').pop()?.toLowerCase();
  if (kind === 'audio') return ext === 'wav' ? 'audio/wav' : 'audio/m4a';
  return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
}

// Best-effort, single attempt (plus one retry after a token refresh on 401).
// No offline queue in v1 — a failure here just means the recording stays
// local and EvidenceScreen shows nothing for that asset.
export async function uploadFile({
  localUri,
  kind,
  contentType = guessContentType(localUri, kind),
}: {
  localUri: string;
  kind: UploadAssetKind;
  contentType?: string;
}): Promise<{ key: string }> {
  const result = await uploadFileToEndpoint({
    endpointPath: '/api/recordings/upload',
    localUri,
    contentType,
    parameters: { type: kind },
  });
  return result as { key: string };
}
