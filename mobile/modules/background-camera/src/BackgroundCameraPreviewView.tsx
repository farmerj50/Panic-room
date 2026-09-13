import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

const NativeView = requireNativeViewManager('BackgroundCamera');

export default function BackgroundCameraPreviewView(props: ViewProps) {
  return <NativeView {...props} />;
}
