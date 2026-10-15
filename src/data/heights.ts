import { METRES_PER_LEVEL } from '../core/config';

export type Tags = Record<string, string>;

/** Parse an OSM length like "12", "12.5 m", "40'", "40 ft", "12'6\"" into metres. */
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(',', '.');
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/.exec(s);
  if (feetInches) return Number(feetInches[1]) * 0.3048 + (feetInches[2] ? Number(feetInches[2]) * 0.0254 : 0);
  const m = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === 'ft' || m[2] === 'feet' ? v * 0.3048 : v;
}

function parseLevels(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** Typical heights (m) per building type when OSM has no height/levels. */
const FALLBACK: Record<string, number> = {
  house: 7,
  detached: 7,
  semidetached_house: 7,
  terrace: 9,
  bungalow: 4,
  hut: 3,
  shed: 3,
  garage: 3,
  garages: 3,
  carport: 3,
  roof: 4,
  kiosk: 3,
  residential: 14,
  apartments: 18,
  dormitory: 15,
  hotel: 24,
  commercial: 16,
  office: 22,
  retail: 9,
  supermarket: 8,
  industrial: 10,
  warehouse: 10,
  church: 18,
  cathedral: 35,
  mosque: 15,
  temple: 12,
  school: 12,
  university: 16,
  hospital: 20,
  train_station: 14,
  parking: 10,
  stadium: 22,
};
const DEFAULT_HEIGHT = 10;

/** Deterministic 0..1 hash of an id, used to vary fallback heights so blocks don't look flat. */
export function hash01(n: number): number {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface BuildingHeight {
  /** Top of the walls, metres above ground. */
  height: number;
  /** Bottom of the walls (for bridges / overhangs), metres above ground. */
  minHeight: number;
  /** True when the value came from OSM height or levels tags. */
  measured: boolean;
}

/**
 * Height from `height` / `building:height`, else `building:levels` (+ `roof:levels`) × 3.2 m,
 * else a per-type fallback with ±20 % deterministic jitter.
 */
export function buildingHeight(tags: Tags, id = 0): BuildingHeight {
  const minHeight =
    parseLength(tags.min_height) ?? (parseLevels(tags['building:min_level']) ?? 0) * METRES_PER_LEVEL;

  let height = parseLength(tags.height) ?? parseLength(tags['building:height']);
  let measured = height !== null;
  if (height === null) {
    const levels = parseLevels(tags['building:levels']) ?? parseLevels(tags.levels);
    if (levels !== null) {
      const roof = parseLevels(tags['roof:levels']) ?? 0;
      height = (levels + roof * 0.6) * METRES_PER_LEVEL;
      measured = true;
    }
  }
  if (height === null) {
    const base = FALLBACK[tags.building] ?? DEFAULT_HEIGHT;
    height = base * (0.8 + 0.4 * hash01(id));
  }
  height = Math.min(Math.max(height, 2.5), 900);
  return { height: Math.max(height, minHeight + 1), minHeight: Math.max(0, minHeight), measured };
}

export const ROAD_WIDTHS: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  pedestrian: 6,
  service: 4,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 7,
  secondary_link: 6,
  tertiary_link: 6,
  track: 3,
  footway: 2,
  path: 1.8,
  cycleway: 2,
  steps: 2,
  bridleway: 2,
};

export function roadWidth(tags: Tags): number | null {
  const hw = tags.highway;
  if (!hw || tags.area === 'yes') return null;
  if (hw === 'proposed' || hw === 'construction' || hw === 'platform' || hw === 'bus_stop') return null;
  const explicit = parseLength(tags.width);
  if (explicit && explicit > 0.5 && explicit < 60) return explicit;
  return ROAD_WIDTHS[hw] ?? 4;
}
