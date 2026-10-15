import type { LocalProjection } from '../geo/projection';
import { type Rect, type Ring, assembleRings, cleanRing, clipRingToRect, orient, signedArea } from '../geo/polygon';
import { type Tags, buildingHeight, parseLength, roadWidth } from './heights';

export type AreaKind = 'water' | 'park' | 'sand';
export type LineKind = 'road' | 'rail' | 'waterway';

export interface Polygon {
  outer: Ring;
  holes: Ring[];
}

export interface Building extends Polygon {
  id: number;
  height: number;
  minHeight: number;
  area: number;
}

export interface Area extends Polygon {
  kind: AreaKind;
}

export interface Line {
  kind: LineKind;
  points: Ring;
  width: number;
  /** Draw order hint: bridges above, tunnels skipped. */
  layer: number;
}

export interface CityData {
  buildings: Building[];
  areas: Area[];
  lines: Line[];
  bounds: Rect;
  stats: { buildings: number; measuredHeights: number; roads: number; areas: number };
}

interface OsmGeomPoint {
  lat: number;
  lon: number;
}
interface OsmMember {
  type: string;
  role: string;
  geometry?: OsmGeomPoint[];
}
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Tags;
  geometry?: OsmGeomPoint[];
  members?: OsmMember[];
}

const COASTLINE_WATER_WIDTH = 4000;

export function areaKind(tags: Tags): AreaKind | null {
  const { natural, landuse, leisure, waterway } = tags;
  if (natural === 'water' || natural === 'bay' || waterway === 'riverbank' || waterway === 'dock') return 'water';
  if (landuse === 'reservoir' || landuse === 'basin') return 'water';
  if (natural === 'beach' || natural === 'sand') return 'sand';
  if (
    leisure ||
    natural === 'wood' ||
    natural === 'scrub' ||
    natural === 'grassland' ||
    natural === 'heath' ||
    (landuse && /^(grass|forest|meadow|recreation_ground|village_green|cemetery)$/.test(landuse))
  )
    return 'park';
  return null;
}

const WATERWAY_WIDTH: Record<string, number> = { river: 24, canal: 12, stream: 3 };

/**
 * Convert an Overpass `out geom` response into projected (metre) features clipped to `bounds`.
 */
export function parseOsm(json: unknown, proj: LocalProjection, bounds: Rect): CityData {
  const elements = ((json as { elements?: OsmElement[] })?.elements ?? []) as OsmElement[];
  const buildings: Building[] = [];
  const areas: Area[] = [];
  const lines: Line[] = [];
  let measured = 0;

  const toRing = (g: OsmGeomPoint[] | undefined): Ring => (g ?? []).map((p) => proj.project(p.lat, p.lon, [0, 0]));
  const isClosed = (g: OsmGeomPoint[] | undefined) =>
    !!g && g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  const pad = 200;
  const padded: Rect = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };

  const polygonsOf = (el: OsmElement): Polygon[] => {
    if (el.type === 'way') {
      if (!isClosed(el.geometry)) return [];
      const outer = cleanRing(toRing(el.geometry));
      return outer.length >= 3 ? [{ outer: orient(outer, true), holes: [] }] : [];
    }
    if (el.type === 'relation' && el.members) {
      const outers = assembleRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => toRing(m.geometry)));
      const inners = assembleRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => toRing(m.geometry)));
      const polys = outers.map((r) => ({ outer: orient(cleanRing(r), true), holes: [] as Ring[] }));
      for (const h of inners) {
        const hole = orient(cleanRing(h), false);
        // Attach each hole to the first outer ring containing its first vertex.
        const owner = polys.find((p) => ringContains(p.outer, hole[0]));
        owner?.holes.push(hole);
      }
      return polys.filter((p) => p.outer.length >= 3);
    }
    return [];
  };

  const centroidInside = (r: Ring) => {
    let x = 0;
    let y = 0;
    for (const p of r) {
      x += p[0];
      y += p[1];
    }
    x /= r.length;
    y /= r.length;
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  };

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags.building && tags.building !== 'no') {
      const h = buildingHeight(tags, el.id);
      if (h.measured) measured++;
      for (const poly of polygonsOf(el)) {
        if (!centroidInside(poly.outer)) continue;
        const area = Math.abs(signedArea(poly.outer));
        if (area < 4) continue;
        buildings.push({ ...poly, id: el.id, height: h.height, minHeight: h.minHeight, area });
      }
      continue;
    }

    const kind = areaKind(tags);
    if (kind) {
      for (const poly of polygonsOf(el)) {
        const outer = clipRingToRect(poly.outer, padded);
        if (outer.length < 3) continue;
        areas.push({ kind, outer, holes: poly.holes.map((h) => clipRingToRect(h, padded)).filter((h) => h.length >= 3) });
      }
      continue;
    }

    if (tags.natural === 'coastline' && el.geometry) {
      // OSM coastlines run with land on the left, water on the right: build a wide strip to the right.
      const strip = coastlineStrip(toRing(el.geometry), COASTLINE_WATER_WIDTH);
      const outer = clipRingToRect(strip, padded);
      if (outer.length >= 3) areas.push({ kind: 'water', outer: orient(outer, true), holes: [] });
      continue;
    }

    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    if (tags.tunnel && tags.tunnel !== 'no') continue;
    const layer = tags.bridge && tags.bridge !== 'no' ? 1 : Number(tags.layer) > 0 ? 1 : 0;
    const w = roadWidth(tags);
    if (w !== null) {
      lines.push({ kind: 'road', points: toRing(el.geometry), width: w, layer });
    } else if (tags.railway) {
      lines.push({ kind: 'rail', points: toRing(el.geometry), width: 3, layer });
    } else if (tags.waterway && WATERWAY_WIDTH[tags.waterway]) {
      lines.push({
        kind: 'waterway',
        points: toRing(el.geometry),
        width: parseLength(tags.width) ?? WATERWAY_WIDTH[tags.waterway],
        layer: 0,
      });
    }
  }

  return {
    buildings,
    areas,
    lines,
    bounds,
    stats: { buildings: buildings.length, measuredHeights: measured, roads: lines.length, areas: areas.length },
  };
}

function ringContains(ring: Ring, p: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon covering a band of `width` metres to the right of a polyline. */
export function coastlineStrip(points: Ring, width: number): Ring {
  if (points.length < 2) return [];
  const offset: Ring = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand normal of the direction (dx, dy) in a y-up frame is (dy, -dx).
    return [p[0] + (dy / len) * width, p[1] - (dx / len) * width];
  });
  return [...points, ...offset.reverse()];
}
