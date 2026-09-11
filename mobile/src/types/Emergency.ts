export interface EmergencyVideoSegment {
  id: string;
  fileUrl: string;
  facing: 'front' | 'back';
  sequence: number;
  startedAt: string;
  endedAt?: string;
}

export interface Emergency {
  id: string;
  createdAt: string;
  latitude?: number;
  longitude?: number;
  status: 'ACTIVE' | 'RESOLVED';
  audioUrl?: string;
  /** Legacy single-video field — only populated on emergencies recorded
   * before camera-flip/video-segments shipped. Prefer videoSegments. */
  videoUrl?: string;
  videoSegments?: EmergencyVideoSegment[];
  contactNotified: boolean;
  notificationError?: string;
  notificationAttempts?: number;
}
