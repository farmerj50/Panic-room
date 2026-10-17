// Single import point for the local native module (mobile/modules/bes-vision),
// so tests mock one path.
export {
  BesVisionView,
  detectTestImage,
  isBesVisionAvailable,
  listTestImages,
  releaseMonitorCamera,
  type CameraStateEvent,
  type DetectionsEvent,
  type NativeDetection,
} from '../../../../modules/bes-vision';
