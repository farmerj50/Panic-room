import { NativeModule, requireNativeModule } from 'expo';
import type { CameraFacing, SegmentFinalizedEvent, BackgroundCameraErrorEvent } from './BackgroundCamera.types';

type BackgroundCameraEvents = {
  onSegmentFinalized: (event: SegmentFinalizedEvent) => void;
  onError: (event: BackgroundCameraErrorEvent) => void;
  onStoppedExternally: () => void;
};

declare class BackgroundCameraModule extends NativeModule<BackgroundCameraEvents> {
  startCapture(emergencyId: string, facing: CameraFacing, startingSequence: number): Promise<void>;
  flip(facing: CameraFacing): Promise<void>;
  stopCapture(): Promise<void>;
  markSegmentUploaded(emergencyId: string, sequence: number): void;
  listPendingSegments(): Promise<SegmentFinalizedEvent[]>;
}

export default requireNativeModule<BackgroundCameraModule>('BackgroundCamera');
