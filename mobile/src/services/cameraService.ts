import { Camera } from 'expo-camera';

export { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

export async function requestAllMediaPermissions(): Promise<boolean> {
  const [cam, mic] = await Promise.all([
    Camera.requestCameraPermissionsAsync(),
    Camera.requestMicrophonePermissionsAsync(),
  ]);
  return cam.granted && mic.granted;
}
