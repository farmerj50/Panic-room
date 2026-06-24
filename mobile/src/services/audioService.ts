import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';

export async function requestAudioPermission(): Promise<boolean> {
  const { granted } = await AudioModule.requestRecordingPermissionsAsync();
  return granted;
}

// Hook-based recorder — use this inside a component
export { useAudioRecorder, RecordingPresets };
