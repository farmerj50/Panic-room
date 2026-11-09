import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

import { TILE_SIZE, project, tileUrl } from '../utils/mapTiles';
import type { RoutePoint, RouteStop } from '../types/Emergency';

// An emergency's GPS route drawn over the same OpenStreetMap tiles as the
// live emergency map (LiveLocationMap): the trail, the start (green), the
// numbered stops (blue) and the latest point (red). Owner-only (Evidence);
// a few tiles per view, disk-cached, with the attribution OSM requires. If
// tiles can't load, the route is still drawn on a plain background.

interface Props {
  points: RoutePoint[];
  stops: RouteStop[];
}

const MAX_ZOOM = 17;
const PAD = 22;
const MAX_SEGMENTS = 300;

function fitZoom(points: RoutePoint[], width: number, height: number) {
  for (let zoom = MAX_ZOOM; zoom > 2; zoom -= 1) {
    const xs = points.map((p) => project(p.latitude, p.longitude, zoom).tileX * TILE_SIZE);
    const ys = points.map((p) => project(p.latitude, p.longitude, zoom).tileY * TILE_SIZE);
    if (Math.max(...xs) - Math.min(...xs) <= width - 2 * PAD && Math.max(...ys) - Math.min(...ys) <= height - 2 * PAD) {
      return zoom;
    }
  }
  return 2;
}

export default function RouteMap({ points, stops }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - 64, 420);
  const height = Math.round(width * 0.62);
  const [failedTiles, setFailedTiles] = useState<Record<string, boolean>>({});

  const layout = useMemo(() => {
    if (points.length === 0) return null;
    const zoom = fitZoom(points, width, height);
    const px = (p: { latitude: number; longitude: number }) => {
      const { tileX, tileY } = project(p.latitude, p.longitude, zoom);
      return { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE };
    };
    const all = points.map(px);
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    const left = (minX + maxX) / 2 - width / 2;
    const top = (minY + maxY) / 2 - height / 2;
    const toView = (p: { x: number; y: number }) => ({ x: p.x - left, y: p.y - top });

    const tiles = [];
    for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + height) / TILE_SIZE); ty += 1) {
      for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + width) / TILE_SIZE); tx += 1) {
        tiles.push({ key: `${zoom}_${tx}_${ty}`, url: tileUrl(tx, ty, zoom), x: tx * TILE_SIZE - left, y: ty * TILE_SIZE - top });
      }
    }

    const step = Math.max(1, Math.ceil(all.length / MAX_SEGMENTS));
    const trail = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(toView);
    const segments = trail.slice(1).map((b, i) => {
      const a = trail[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return {
        key: `s${i}`,
        left: (a.x + b.x) / 2 - length / 2,
        top: (a.y + b.y) / 2 - 1.5,
        width: length,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    });
    return {
      tiles,
      segments,
      start: toView(all[0]),
      end: toView(all[all.length - 1]),
      stops: stops.map((s) => toView(px(s))),
    };
  }, [points, stops, width, height]);

  if (!layout) return null;

  return (
    <View style={[styles.card, { width, height }]} testID="route-map" accessibilityLabel="route-map">
      {layout.tiles.map((tile) =>
        failedTiles[tile.key] ? (
          <View key={tile.key} style={[styles.tile, styles.tileFallback, { left: tile.x, top: tile.y }]} />
        ) : (
          <Image
            key={tile.key}
            // Same descriptive User-Agent as LiveLocationMap (OSM tile policy).
            source={{ uri: tile.url, headers: { 'User-Agent': 'Bes-SafetyApp/1.0 (+https://bes-app.com)' } }}
            style={[styles.tile, { left: tile.x, top: tile.y }]}
            cachePolicy="disk"
            onError={() => setFailedTiles((current) => ({ ...current, [tile.key]: true }))}
          />
        ),
      )}
      {layout.segments.map((s) => (
        <View
          key={s.key}
          style={[styles.segment, { left: s.left, top: s.top, width: s.width, transform: [{ rotate: `${s.angle}rad` }] }]}
        />
      ))}
      <View style={[styles.dot, styles.startDot, { left: layout.start.x - 7, top: layout.start.y - 7 }]} />
      {layout.stops.map((p, i) => (
        <View key={`stop${i}`} style={[styles.stopDot, { left: p.x - 10, top: p.y - 10 }]}>
          <Text style={styles.stopLabel}>{i + 1}</Text>
        </View>
      ))}
      <View style={[styles.dot, styles.endDot, { left: layout.end.x - 8, top: layout.end.y - 8 }]} />
      <View style={styles.attribution}>
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    backgroundColor: '#232842',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tile: { height: TILE_SIZE, position: 'absolute', width: TILE_SIZE },
  tileFallback: { backgroundColor: '#232842' },
  segment: { backgroundColor: '#ef445b', borderRadius: 2, height: 3, position: 'absolute' },
  dot: { borderColor: '#fff', borderRadius: 8, borderWidth: 2, position: 'absolute' },
  startDot: { backgroundColor: '#2f9e44', height: 14, width: 14 },
  endDot: { backgroundColor: '#ef445b', borderWidth: 3, height: 16, width: 16 },
  stopDot: {
    alignItems: 'center',
    backgroundColor: '#1c3d8f',
    borderColor: '#fff',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    width: 20,
  },
  stopLabel: { color: '#fff', fontSize: 10, fontWeight: '800' },
  attribution: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderTopLeftRadius: 6,
    bottom: 0,
    paddingHorizontal: 5,
    paddingVertical: 2,
    position: 'absolute',
    right: 0,
  },
  attributionText: { color: '#222', fontSize: 9 },
});
