export function mapUrl(location: { latitude: number; longitude: number } | null): string {
  if (!location) return 'Location unavailable';
  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}
