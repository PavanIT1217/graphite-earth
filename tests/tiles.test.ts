import { describe, expect, it } from 'vitest';
import {
  MAX_MERCATOR_LAT,
  allTiles,
  latLngToUnit,
  latToTileY,
  lngToTileX,
  tileBounds,
  tileKey,
  tileV,
  tilesAround,
  unitToLatLng,
  zoomForAltitude,
} from '../src/geo/tiles';

describe('slippy tile maths', () => {
  it('matches known tile coordinates', () => {
    // Lower Manhattan at z=12 is tile 1205/1540 (OSM wiki formula).
    expect(Math.floor(lngToTileX(-74.0113, 12))).toBe(1205);
    expect(Math.floor(latToTileY(40.7075, 12))).toBe(1540);
    expect(lngToTileX(-180, 3)).toBe(0);
    expect(lngToTileX(180, 3)).toBe(8);
    expect(latToTileY(0, 4)).toBeCloseTo(8, 9);
    expect(latToTileY(MAX_MERCATOR_LAT, 2)).toBeCloseTo(0, 6);
  });

  it('tile bounds round-trip and nest', () => {
    const b = tileBounds({ z: 1, x: 0, y: 0 });
    expect(b.west).toBe(-180);
    expect(b.east).toBe(0);
    expect(b.south).toBeCloseTo(0, 9);
    expect(b.north).toBeCloseTo(MAX_MERCATOR_LAT, 6);
    expect(tileV(b.north, { z: 1, x: 0, y: 0 })).toBeCloseTo(0, 9);
    expect(tileV(b.south, { z: 1, x: 0, y: 0 })).toBeCloseTo(1, 9);
  });

  it('chooses higher zoom at lower altitude', () => {
    const far = zoomForAltitude(20000, 0, 45, 900);
    const city = zoomForAltitude(5, 40, 45, 900);
    expect(far).toBeLessThanOrEqual(3);
    expect(city).toBeGreaterThanOrEqual(13);
    expect(city).toBeLessThanOrEqual(16);
    expect(zoomForAltitude(0.001, 0, 45, 900)).toBe(18);
  });

  it('collects neighbouring tiles with x wrap and y clamp', () => {
    const tiles = tilesAround(0, 179.9, 2, 1);
    expect(tiles).toHaveLength(9);
    expect(tiles.some((t) => t.x === 0)).toBe(true); // wrapped past the antimeridian
    const polar = tilesAround(85, 0, 2, 1);
    expect(polar.every((t) => t.y >= 0)).toBe(true);
    expect(polar).toHaveLength(6);
    expect(new Set(tilesAround(0, 0, 0, 2).map(tileKey)).size).toBe(1);
    expect(allTiles(2)).toHaveLength(16);
  });

  it('converts between lat/lng and unit vectors', () => {
    const [x, y, z] = latLngToUnit(0, 90);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    for (const [lat, lng] of [[40.7, -74], [-33.9, 151.2], [17.7, 83.3]]) {
      const v = latLngToUnit(lat, lng);
      const r = unitToLatLng(v[0] * 7, v[1] * 7, v[2] * 7);
      expect(r.lat).toBeCloseTo(lat, 9);
      expect(r.lng).toBeCloseTo(lng, 9);
    }
  });
});
