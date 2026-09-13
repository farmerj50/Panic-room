export type CameraFacing = 'front' | 'back';

export type SegmentFinalizedEvent = {
  emergencyId: string;
  sequence: number;
  facing: CameraFacing;
  localUri: string;
  startedAt: string;
  endedAt: string;
};

export type BackgroundCameraErrorEvent = {
  message: string;
};
