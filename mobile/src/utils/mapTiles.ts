// Web Mercator / OpenStreetMap "slippy map" tile projection.
// Pure math, no RN/expo dependency, so it's testable without any rendering.

export const TILE_SIZE = 256;

export function project(lat: number, lon: number, zoom: number): { tileX: number; tileY: number } {
  const n = 2 ** zoom;
  const tileX = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const tileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { tileX, tileY };
}

export function tileUrl(x: number, y: number, zoom: number): string {
  const n = 2 ** zoom;
  // Longitude wraps around the antimeridian; latitude does not (Mercator has
  // no pole wraparound), so it's clamped instead of wrapped.
  const wrappedX = ((x % n) + n) % n;
  const clampedY = Math.min(Math.max(y, 0), n - 1);
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${clampedY}.png`;
}
