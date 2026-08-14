import { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { TILE_SIZE, project, tileUrl } from '../utils/mapTiles';

interface Props {
  latitude: number;
  longitude: number;
  zoom?: number;
}

const GRID_SIZE = 3; // 3x3 tiles — covers up to a 512px-wide crop, see note below
const GRID_OFFSETS = [-1, 0, 1];

export default function LiveLocationMap({ latitude, longitude, zoom = 17 }: Props) {
  const { width } = useWindowDimensions();
  const [failedTiles, setFailedTiles] = useState<Record<string, boolean>>({});

  // A 3x3 grid guarantees full coverage as long as the card stays under
  // TILE_SIZE * (GRID_SIZE - 1) = 512px wide — mapWidth is capped well below
  // that. Bump GRID_SIZE to 5 if this cap is ever raised.
  const mapWidth = Math.min(width - 32, 400);
  const mapHeight = Math.round(mapWidth * 0.5);

  const { tiles, gridOffset } = useMemo(() => {
    const { tileX, tileY } = project(latitude, longitude, zoom);
    const centerTileX = Math.floor(tileX);
    const centerTileY = Math.floor(tileY);
    const fracX = tileX - centerTileX;
    const fracY = tileY - centerTileY;

    // The GPS point's pixel position inside the (GRID_SIZE * TILE_SIZE)
    // square grid, then offset the whole grid so that point lands exactly
    // at the card's center.
    const gridPointX = TILE_SIZE * (1 + fracX);
    const gridPointY = TILE_SIZE * (1 + fracY);

    const builtTiles = GRID_OFFSETS.flatMap((dy) =>
      GRID_OFFSETS.map((dx) => ({
        key: `${dx}_${dy}`,
        url: tileUrl(centerTileX + dx, centerTileY + dy, zoom),
        left: (dx + 1) * TILE_SIZE,
        top: (dy + 1) * TILE_SIZE,
      })),
    );

    return {
      tiles: builtTiles,
      gridOffset: {
        left: mapWidth / 2 - gridPointX,
        top: mapHeight / 2 - gridPointY,
      },
    };
  }, [latitude, longitude, zoom, mapWidth, mapHeight]);

  return (
    <View
      style={[styles.card, { width: mapWidth, height: mapHeight }]}
      testID="emergency-map-panel"
      accessible
      accessibilityLabel="emergency-map-panel"
    >
      <View style={[styles.grid, { left: gridOffset.left, top: gridOffset.top }]}>
        {tiles.map((tile) =>
          failedTiles[tile.key] ? (
            <View
              key={tile.key}
              style={[styles.tile, styles.tileFallback, { left: tile.left, top: tile.top }]}
            />
          ) : (
            <Image
              key={tile.key}
              source={{ uri: tile.url }}
              style={[styles.tile, { left: tile.left, top: tile.top }]}
              onError={() => setFailedTiles((current) => ({ ...current, [tile.key]: true }))}
            />
          ),
        )}
      </View>

      <View style={styles.marker}>
        <View style={styles.markerRing}>
          <View style={styles.markerDot} />
        </View>
      </View>

      <View style={styles.liveLabel}>
        <View style={styles.liveDot} />
        <Text style={styles.liveLabelText}>Live location</Text>
      </View>

      <View style={styles.attribution}>
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  grid: { position: 'absolute' },
  tile: { height: TILE_SIZE, position: 'absolute', width: TILE_SIZE },
  tileFallback: { backgroundColor: '#232842' },
  marker: {
    alignItems: 'center',
    height: 0,
    justifyContent: 'center',
    left: '50%',
    position: 'absolute',
    top: '50%',
    width: 0,
  },
  markerRing: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    marginLeft: -9,
    marginTop: -9,
    shadowColor: '#000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    width: 18,
  },
  markerDot: { backgroundColor: '#4ee1d5', borderRadius: 5, height: 10, width: 10 },
  liveLabel: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.66)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
    top: 10,
  },
  liveDot: { backgroundColor: '#4ee1d5', borderRadius: 4, height: 8, width: 8 },
  liveLabelText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  attribution: {
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: 'absolute',
    right: 8,
  },
  attributionText: { color: 'rgba(255,255,255,0.72)', fontSize: 9, fontWeight: '600' },
});
