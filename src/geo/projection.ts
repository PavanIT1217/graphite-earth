/** WGS84 mean radius, metres. */
export const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Local tangent-plane projection (equirectangular around an origin).
 * Over the ~1.5 km areas loaded here the distortion is well under 0.1 %.
 * Output: x = metres east, y = metres north.
 */
export class LocalProjection {
  private readonly kx: number;
  private readonly ky: number;

  constructor(readonly origin: LatLng) {
    this.ky = EARTH_RADIUS * DEG;
    this.kx = EARTH_RADIUS * DEG * Math.cos(origin.lat * DEG);
  }

  /** Writes [x, y] (east, north metres) into `out`. */
  project(lat: number, lng: number, out: [number, number] = [0, 0]): [number, number] {
    let dLng = lng - this.origin.lng;
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;
    out[0] = dLng * this.kx;
    out[1] = (lat - this.origin.lat) * this.ky;
    return out;
  }

  unproject(x: number, y: number): LatLng {
    return { lat: this.origin.lat + y / this.ky, lng: this.origin.lng + x / this.kx };
  }
}

/** Great-circle distance in metres (haversine). */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A square bounding box of the given area centred on a point. */
export function bboxAround(center: LatLng, areaM2: number): BBox {
  const half = Math.sqrt(areaM2) / 2;
  const dLat = half / (EARTH_RADIUS * DEG);
  const dLng = half / (EARTH_RADIUS * DEG * Math.cos(center.lat * DEG));
  return { south: center.lat - dLat, north: center.lat + dLat, west: center.lng - dLng, east: center.lng + dLng };
}

/** Approximate bbox area in m². */
export function bboxArea(b: BBox): number {
  const midLat = (b.south + b.north) / 2;
  const h = (b.north - b.south) * DEG * EARTH_RADIUS;
  const w = (b.east - b.west) * DEG * EARTH_RADIUS * Math.cos(midLat * DEG);
  return Math.abs(w * h);
}

export function bboxCenter(b: BBox): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** Shrink a bbox (around its centre) so it covers at most `maxM2`. */
export function clampBBox(b: BBox, maxM2: number): BBox {
  const area = bboxArea(b);
  if (area <= maxM2) return b;
  const k = Math.sqrt(maxM2 / area);
  const c = bboxCenter(b);
  const hLat = ((b.north - b.south) / 2) * k;
  const hLng = ((b.east - b.west) / 2) * k;
  return { south: c.lat - hLat, north: c.lat + hLat, west: c.lng - hLng, east: c.lng + hLng };
}
