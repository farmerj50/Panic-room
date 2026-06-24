export interface Emergency {
  id: string;
  createdAt: string;
  latitude?: number;
  longitude?: number;
  status: 'ACTIVE' | 'RESOLVED';
  audioUrl?: string;
  videoUrl?: string;
  contactNotified: boolean;
}
