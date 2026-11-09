import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';

import RouteMap from './RouteMap';
import { getEmergencyRoute, stopRecoveryTracking } from '../services/emergencyService';
import { getRecoveryTracking, markPhoneRecovered } from '../services/recoveryTracking';
import { serverIdFor } from '../services/pendingEmergencies';
import type { EmergencyRoute, RouteStop } from '../types/Emergency';
import { addressFrom, formatDuration, freshnessLabel, mapsUrl, trackingLabel } from '../utils/routeFormat';

// Evidence → one emergency's route: the map, last known location (with its
// accuracy, battery and freshness), the stops with approximate addresses,
// and — while recovery tracking runs — the control to stop it. Loaded only
// when the owner opens it.

const addressCache = new Map<string, string | null>();

async function approximateAddress(stop: { latitude: number; longitude: number }): Promise<string | null> {
  const key = `${stop.latitude.toFixed(4)},${stop.longitude.toFixed(4)}`;
  if (addressCache.has(key)) return addressCache.get(key) ?? null;
  let address: string | null = null;
  try {
    // The phone's own geocoder (no Bes server involved); best effort.
    const [result] = await Location.reverseGeocodeAsync({ latitude: stop.latitude, longitude: stop.longitude });
    address = addressFrom(result);
  } catch {
    address = null;
  }
  addressCache.set(key, address);
  return address;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function StopRow({ stop, index }: { stop: RouteStop; index: number }) {
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    approximateAddress(stop).then((a) => alive && setAddress(a));
    return () => {
      alive = false;
    };
  }, [stop]);
  const stayed = stop.ongoing ? `still there · ${formatDuration(stop.durationSeconds)} so far` : `stayed ${formatDuration(stop.durationSeconds)}`;
  return (
    <View style={styles.stop} testID="route-stop" accessibilityLabel={`route-stop-${index + 1}`}>
      <Text style={styles.stopTitle}>
        Stop {index + 1} · arrived {clock(stop.arrivedAt)} · {stayed}
      </Text>
      <Text style={styles.muted}>
        {address === undefined ? 'Finding address…' : address ? `Approx. ${address}` : `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`}
      </Text>
      <TouchableOpacity onPress={() => Linking.openURL(mapsUrl(stop.latitude, stop.longitude))}>
        <Text style={styles.link}>Open in Maps</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function EmergencyRouteSection({ emergencyId }: { emergencyId: string }) {
  const [route, setRoute] = useState<EmergencyRoute | null>(null);
  const [error, setError] = useState(false);
  const [isThisPhone, setIsThisPhone] = useState(false);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setRoute(await getEmergencyRoute(emergencyId));
    } catch {
      setError(true);
    }
    const local = await getRecoveryTracking();
    setIsThisPhone(Boolean(local && (await serverIdFor(local.emergencyId)) === emergencyId));
  }, [emergencyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stopTracking = () => {
    const title = isThisPhone ? 'Phone recovered?' : 'Stop tracking?';
    const message = isThisPhone
      ? 'This stops recovery tracking on this phone. It can\'t be restarted for this emergency.'
      : 'This stops recovery tracking for the missing phone right away, even if it is offline. It can\'t be restarted for this emergency.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isThisPhone ? 'Phone recovered' : 'Stop tracking',
        style: 'destructive',
        onPress: async () => {
          setStopping(true);
          try {
            if (isThisPhone) await markPhoneRecovered();
            else await stopRecoveryTracking(emergencyId, 'remote_stop');
          } catch {
            Alert.alert('Not stopped', 'Bes couldn\'t reach the server. Check your connection and try again.');
          } finally {
            setStopping(false);
            void load();
          }
        },
      },
    ]);
  };

  if (error) {
    return (
      <TouchableOpacity onPress={load}>
        <Text style={styles.muted}>Couldn't load the route. Tap to retry.</Text>
      </TouchableOpacity>
    );
  }
  if (!route) return <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />;

  const status = trackingLabel(route.tracking);
  const latest = route.latest;
  const details = [
    latest?.accuracy != null ? `GPS accuracy ±${Math.round(latest.accuracy)} m` : null,
    route.batteryLevel != null ? `Battery ${route.batteryLevel}%` : null,
  ].filter(Boolean);

  return (
    <View style={styles.section} testID="route-section" accessibilityLabel="route-section">
      {status ? (
        <Text style={styles.tracking} testID="route-tracking-status" accessibilityLabel="route-tracking-status">
          {status}
        </Text>
      ) : null}
      {route.tracking.state === 'RECOVERY_TRACKING' ? (
        <TouchableOpacity
          style={styles.stopBtn}
          onPress={stopTracking}
          disabled={stopping}
          testID="route-stop-tracking-btn"
          accessibilityLabel="route-stop-tracking-btn"
        >
          <Text style={styles.stopBtnText}>{isThisPhone ? 'Phone recovered' : 'Stop tracking'}</Text>
        </TouchableOpacity>
      ) : null}

      {route.points.length === 0 && !latest ? (
        <Text style={styles.muted}>No GPS points were recorded for this emergency.</Text>
      ) : (
        <>
          {route.points.length > 0 ? <RouteMap points={route.points} stops={route.stops} /> : null}
          <Text style={styles.legend}>Green: start · Red: latest point · Blue: stops</Text>
          {route.start ? (
            <TouchableOpacity onPress={() => Linking.openURL(mapsUrl(route.start!.latitude, route.start!.longitude))}>
              <Text style={styles.link}>Start · {new Date(route.start.recordedAt).toLocaleString()} · Open in Maps</Text>
            </TouchableOpacity>
          ) : null}
          {latest ? (
            <View style={styles.latest} testID="route-latest">
              <Text style={styles.latestTitle}>{route.freshness.status === 'live' ? 'Current location' : 'Last known location'}</Text>
              <Text style={styles.muted} testID="route-freshness">{freshnessLabel(route)}</Text>
              {details.length ? <Text style={styles.muted}>{details.join(' · ')}</Text> : null}
              <TouchableOpacity onPress={() => Linking.openURL(mapsUrl(latest.latitude, latest.longitude))}>
                <Text style={styles.link}>Open in Maps</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <Text style={styles.stopsTitle}>Stops (3 min or longer within ~50 m)</Text>
          {route.stops.length === 0 ? <Text style={styles.muted}>No stops detected.</Text> : null}
          {route.stops.map((stop, i) => (
            <StopRow key={`${stop.arrivedAt}`} stop={stop} index={i} />
          ))}
          {route.locationsThinned > 0 ? (
            <Text style={styles.muted}>
              {route.locationsThinned} points were thinned on the phone while it was offline; the route between them is approximate.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 10 },
  tracking: { color: '#f5c542', fontSize: 13, fontWeight: '700' },
  stopBtn: { alignSelf: 'flex-start', backgroundColor: '#ef445b', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  stopBtnText: { color: '#fff', fontWeight: '700' },
  legend: { color: '#888', fontSize: 11, textAlign: 'center' },
  latest: { backgroundColor: '#161a2b', borderRadius: 10, gap: 2, padding: 10 },
  latestTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  stopsTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 4 },
  stop: { borderLeftColor: '#1c3d8f', borderLeftWidth: 3, gap: 2, paddingLeft: 8 },
  stopTitle: { color: '#fff', fontSize: 13 },
  muted: { color: '#9aa0b4', fontSize: 12 },
  link: { color: '#a29bfe', fontSize: 13, fontWeight: '600' },
});
