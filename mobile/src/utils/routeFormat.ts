// Wording for route history (Evidence). Pure, so it's testable.
import type { EmergencyRoute, EmergencyTracking } from '../types/Emergency';

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Never presents an old fix as where the phone is now.
export function freshnessLabel(route: Pick<EmergencyRoute, 'latest' | 'freshness'>, now = Date.now()): string {
  const latest = route.latest;
  if (!latest) return 'No location recorded';
  switch (route.freshness.status) {
    case 'live':
      return `Live · updated ${formatAgo(latest.recordedAt, now)}`;
    case 'delayed':
      return `Updates delayed · last update ${formatAgo(latest.recordedAt, now)} (${clock(latest.recordedAt)})`;
    case 'stale':
      return `No recent updates · last confirmed location ${formatAgo(latest.recordedAt, now)} (${clock(latest.recordedAt)}). The phone may have moved since.`;
    default:
      return `Final recorded location · ${new Date(latest.recordedAt).toLocaleString()}`;
  }
}

export function trackingLabel(tracking: EmergencyTracking | undefined, now = Date.now()): string | null {
  if (!tracking) return null;
  if (tracking.state === 'RECOVERY_TRACKING' && tracking.recovery) {
    return `Recovery tracking on · stops automatically ${new Date(tracking.recovery.expiresAt).toLocaleString()}`;
  }
  if (tracking.state === 'CLOSED' && tracking.recovery?.endedAt) {
    const why: Record<string, string> = {
      recovered: 'phone marked recovered',
      remote_stop: 'stopped from another device',
      expired: 'ended after 72 hours',
      consent_withdrawn: 'setting turned off',
      permission_revoked: 'location permission removed',
    };
    const reason = tracking.recovery.endReason ? why[tracking.recovery.endReason] : null;
    return `Recovery tracking ended ${formatAgo(tracking.recovery.endedAt, now)}${reason ? ` (${reason})` : ''}`;
  }
  return null;
}

type GeocodedAddress = {
  name?: string | null;
  streetNumber?: string | null;
  street?: string | null;
  city?: string | null;
  district?: string | null;
  region?: string | null;
};

// "12 Main St, Springfield" from a reverse-geocode result (approximate).
export function addressFrom(result: GeocodedAddress | null | undefined): string | null {
  if (!result) return null;
  const street = [result.streetNumber, result.street].filter(Boolean).join(' ') || result.name || '';
  const place = result.city || result.district || result.region || '';
  const text = [street, place].filter(Boolean).join(', ');
  return text || null;
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}
