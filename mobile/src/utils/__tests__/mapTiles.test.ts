import { project, tileUrl, TILE_SIZE } from '../mapTiles';

describe('mapTiles', () => {
  test('projects the origin to the center of the world at zoom 0', () => {
    const { tileX, tileY } = project(0, 0, 0);
    expect(tileX).toBeCloseTo(0.5, 6);
    expect(tileY).toBeCloseTo(0.5, 6);
  });

  test('the west edge of the map projects to tileX 0', () => {
    const { tileX } = project(0, -180, 4);
    expect(tileX).toBeCloseTo(0, 6);
  });

  test('the east edge of the map projects to tileX n', () => {
    const n = 2 ** 4;
    const { tileX } = project(0, 180, 4);
    expect(tileX).toBeCloseTo(n, 6);
  });

  test('higher latitudes push further up (smaller tileY)', () => {
    const equator = project(0, 0, 10);
    const north = project(45, 0, 10);
    expect(north.tileY).toBeLessThan(equator.tileY);
  });

  test('tileUrl builds a well-formed OpenStreetMap tile URL', () => {
    expect(tileUrl(3, 5, 8)).toBe('https://tile.openstreetmap.org/8/3/5.png');
  });

  test('tileUrl wraps a negative x around the antimeridian', () => {
    const n = 2 ** 5;
    expect(tileUrl(-1, 2, 5)).toBe(`https://tile.openstreetmap.org/5/${n - 1}/2.png`);
  });

  test('tileUrl wraps an out-of-range x back into [0, n)', () => {
    const n = 2 ** 5;
    expect(tileUrl(n + 1, 2, 5)).toBe('https://tile.openstreetmap.org/5/1/2.png');
  });

  test('tileUrl clamps y instead of wrapping (no pole wraparound in Mercator)', () => {
    const n = 2 ** 5;
    expect(tileUrl(1, -3, 5)).toBe('https://tile.openstreetmap.org/5/1/0.png');
    expect(tileUrl(1, n + 3, 5)).toBe(`https://tile.openstreetmap.org/5/1/${n - 1}.png`);
  });

  test('TILE_SIZE matches the standard OSM raster tile dimension', () => {
    expect(TILE_SIZE).toBe(256);
  });
});
