/** Web-Mercator (slippy map) tile maths, as used by tile.openstreetmap.org. */

export const MAX_MERCATOR_LAT = 85.05112878;
const DEG = Math.PI / 180;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`;

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const l = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * DEG;
  return ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return Math.atan(Math.sinh(n)) / DEG;
}

export function tileBounds(t: TileId): TileBounds {
  return {
    west: tileXToLng(t.x, t.z),
    east: tileXToLng(t.x + 1, t.z),
    north: tileYToLat(t.y, t.z),
    south: tileYToLat(t.y + 1, t.z),
  };
}

/** Mercator v (0 at north edge, 1 at south edge of the tile) for a latitude inside it. */
export function tileV(lat: number, t: TileId): number {
  return latToTileY(lat, t.z) - t.y;
}

/**
 * Zoom level whose tiles appear at roughly `tilePx` screen pixels when looking straight down
 * from `altitudeKm` with a vertical field of view `fovDeg` on a viewport `viewportPx` tall.
 */
export function zoomForAltitude(altitudeKm: number, lat: number, fovDeg: number, viewportPx: number, tilePx = 256, maxZoom = 18): number {
  const visibleKm = 2 * altitudeKm * Math.tan((fovDeg * DEG) / 2);
  const kmPerPx = visibleKm / Math.max(1, viewportPx);
  const tileKm = kmPerPx * tilePx;
  const equatorKm = 40075.016686 * Math.max(0.05, Math.cos(lat * DEG));
  const z = Math.log2(equatorKm / Math.max(tileKm, 1e-6));
  return Math.max(0, Math.min(maxZoom, Math.round(z)));
}

/** A (2r+1)² block of tiles around a point, wrapping in x and clamped in y. */
export function tilesAround(lat: number, lng: number, z: number, r: number): TileId[] {
  const n = 2 ** z;
  const cx = Math.floor(lngToTileX(lng, z));
  const cy = Math.floor(latToTileY(lat, z));
  const out: TileId[] = [];
  const seen = new Set<string>();
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = (((cx + dx) % n) + n) % n;
      const t = { z, x, y };
      const k = tileKey(t);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  }
  return out;
}

/** Every tile of a zoom level (for the low-zoom base layer). */
export function allTiles(z: number): TileId[] {
  const n = 2 ** z;
  const out: TileId[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push({ z, x, y });
  return out;
}

/** Unit-sphere direction for lat/lng in the globe frame: +y north pole, lng 0 at +z, east towards +x. */
export function latLngToUnit(lat: number, lng: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const phi = lat * DEG;
  const lam = lng * DEG;
  out[0] = Math.cos(phi) * Math.sin(lam);
  out[1] = Math.sin(phi);
  out[2] = Math.cos(phi) * Math.cos(lam);
  return out;
}

export function unitToLatLng(x: number, y: number, z: number): { lat: number; lng: number } {
  const len = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG, lng: Math.atan2(x, z) / DEG };
}
