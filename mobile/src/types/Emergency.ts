export interface EmergencyVideoSegment {
  id: string;
  fileUrl: string;
  facing: 'front' | 'back';
  sequence: number;
  startedAt: string;
  endedAt?: string;
}

// SOS_ACTIVE: the emergency is running. RECOVERY_TRACKING: the SOS ended but
// the phone is still sharing its location (opt-in). CLOSED: nothing tracked.
export type TrackingState = 'SOS_ACTIVE' | 'RECOVERY_TRACKING' | 'CLOSED';

export interface EmergencyTracking {
  state: TrackingState;
  recovery: {
    startedAt: string;
    expiresAt: string;
    endedAt: string | null;
    endReason: 'recovered' | 'remote_stop' | 'expired' | 'consent_withdrawn' | 'permission_revoked' | null;
  } | null;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  batteryLevel: number | null;
  recordedAt: string;
}

export interface RouteStop {
  latitude: number;
  longitude: number;
  arrivedAt: string;
  departedAt: string | null;
  durationSeconds: number;
  ongoing: boolean;
  pointCount: number;
  longestGapSeconds: number;
}

export interface EmergencyRoute {
  emergencyId: string;
  tracking: EmergencyTracking;
  locationsThinned: number;
  points: RoutePoint[];
  start: RoutePoint | null;
  latest: RoutePoint | null;
  batteryLevel: number | null;
  stops: RouteStop[];
  // live/delayed/stale while tracking runs; final once closed.
  freshness: { status: 'live' | 'delayed' | 'stale' | 'final' | 'none'; ageSeconds: number | null };
  pointCount: number;
  usedPointCount: number;
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
  /** Absent on responses from servers older than recovery tracking. */
  tracking?: EmergencyTracking;
}
