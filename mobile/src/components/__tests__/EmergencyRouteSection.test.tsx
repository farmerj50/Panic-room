import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { EmergencyRoute } from '../../types/Emergency';
import { addressFrom, formatDuration, freshnessLabel } from '../../utils/routeFormat';

const mockGetRoute = jest.fn();
const mockStop = jest.fn();
jest.mock('../../services/emergencyService', () => ({
  getEmergencyRoute: (...args: unknown[]) => mockGetRoute(...args),
  stopRecoveryTracking: (...args: unknown[]) => mockStop(...args),
}));
let mockLocal: { emergencyId: string } | null = null;
const mockRecovered = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/recoveryTracking', () => ({
  getRecoveryTracking: async () => mockLocal,
  markPhoneRecovered: () => mockRecovered(),
}));
jest.mock('../../services/pendingEmergencies', () => ({ serverIdFor: async (id: string) => id }));
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: async () => [{ streetNumber: '12', street: 'Main St', city: 'Springfield' }],
}));
jest.mock('expo-image', () => ({ Image: () => null }));

import EmergencyRouteSection from '../EmergencyRouteSection';

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const point = (lat: number, minAgo: number, extra = {}) => ({
  latitude: lat,
  longitude: -74,
  accuracy: 8,
  batteryLevel: null,
  recordedAt: iso(minAgo),
  ...extra,
});

function route(over: Partial<EmergencyRoute> = {}): EmergencyRoute {
  const points = [point(40, 30), point(40.01, 25), point(40.02, 20)];
  return {
    emergencyId: 'e1',
    tracking: { state: 'CLOSED', recovery: null },
    locationsThinned: 0,
    points,
    start: points[0],
    latest: { ...points[2], accuracy: 14, batteryLevel: 42 },
    batteryLevel: 42,
    stops: [
      {
        latitude: 40.01,
        longitude: -74,
        arrivedAt: iso(26),
        departedAt: iso(21),
        durationSeconds: 300,
        ongoing: false,
        pointCount: 6,
        longestGapSeconds: 60,
      },
    ],
    freshness: { status: 'final', ageSeconds: 1200 },
    pointCount: 3,
    usedPointCount: 3,
    ...over,
  };
}

beforeEach(() => {
  mockGetRoute.mockReset();
  mockStop.mockReset().mockResolvedValue({ state: 'CLOSED', recovery: null });
  mockRecovered.mockClear();
  mockLocal = null;
});

async function renderSection() {
  render(<EmergencyRouteSection emergencyId="e1" />);
  await act(async () => {});
}

test('shows the map, the stop with its arrival, duration and approximate address, plus accuracy and battery', async () => {
  mockGetRoute.mockResolvedValue(route());
  await renderSection();
  expect(screen.getByTestId('route-map')).toBeTruthy();
  expect(screen.getAllByTestId('route-stop')).toHaveLength(1);
  expect(screen.getByText(/Stop 1 · arrived .* · stayed 5 min/)).toBeTruthy();
  expect(screen.getByText('Approx. 12 Main St, Springfield')).toBeTruthy();
  expect(screen.getByText('GPS accuracy ±14 m · Battery 42%')).toBeTruthy();
  expect(screen.getAllByText('Open in Maps').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Last known location')).toBeTruthy();
});

test('stale location while tracking: says it is old and that the phone may have moved', async () => {
  mockGetRoute.mockResolvedValue(
    route({ tracking: { state: 'RECOVERY_TRACKING', recovery: { startedAt: iso(60), expiresAt: iso(-60 * 70), endedAt: null, endReason: null } }, freshness: { status: 'stale', ageSeconds: 1200 } }),
  );
  await renderSection();
  expect(screen.getByTestId('route-freshness').props.children).toMatch(/No recent updates .* may have moved since/);
  expect(screen.getByText('Last known location')).toBeTruthy();
});

test('another device: "Stop tracking" stops it on the server immediately', async () => {
  mockGetRoute.mockResolvedValue(
    route({ tracking: { state: 'RECOVERY_TRACKING', recovery: { startedAt: iso(60), expiresAt: iso(-600), endedAt: null, endReason: null } } }),
  );
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  await renderSection();
  await act(async () => {
    fireEvent.press(screen.getByTestId('route-stop-tracking-btn'));
  });
  expect(mockStop).toHaveBeenCalledWith('e1', 'remote_stop');
  expect(mockRecovered).not.toHaveBeenCalled();
});

test('the tracked phone itself: the button is "Phone recovered"', async () => {
  mockLocal = { emergencyId: 'e1' };
  mockGetRoute.mockResolvedValue(
    route({ tracking: { state: 'RECOVERY_TRACKING', recovery: { startedAt: iso(60), expiresAt: iso(-600), endedAt: null, endReason: null } } }),
  );
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  await renderSection();
  expect(screen.getByText('Phone recovered')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('route-stop-tracking-btn'));
  });
  expect(mockRecovered).toHaveBeenCalled();
  expect(mockStop).not.toHaveBeenCalled();
});

test('no stop control once tracking is closed; no points says so', async () => {
  mockGetRoute.mockResolvedValue(route({ points: [], latest: null, start: null, stops: [] }));
  await renderSection();
  expect(screen.queryByTestId('route-stop-tracking-btn')).toBeNull();
  expect(screen.getByText('No GPS points were recorded for this emergency.')).toBeTruthy();
});

describe('route wording', () => {
  test('durations, addresses and freshness labels', () => {
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(addressFrom({ name: 'Central Park', city: 'New York' })).toBe('Central Park, New York');
    expect(addressFrom({})).toBeNull();
    const latest = point(40, 1);
    expect(freshnessLabel({ latest, freshness: { status: 'live', ageSeconds: 60 } }, NOW)).toMatch(/^Live · updated/);
    expect(freshnessLabel({ latest, freshness: { status: 'delayed', ageSeconds: 300 } }, NOW)).toMatch(/^Updates delayed/);
    expect(freshnessLabel({ latest: null, freshness: { status: 'none', ageSeconds: null } })).toBe('No location recorded');
  });
});
