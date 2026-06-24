export interface Recording {
  id: string;
  createdAt: string;
  fileUrl: string;
  type: 'audio' | 'video';
}
