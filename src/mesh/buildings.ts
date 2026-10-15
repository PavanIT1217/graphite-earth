import { ShapeUtils, Vector2 } from 'three';
import type { Building } from '../data/osm';
import { type Ring, simplifyRing } from '../geo/polygon';
import { GeometryWriter } from './geometryWriter';

export interface BuildingDetail {
  /** Douglas–Peucker tolerance in metres (0 = full detail). */
  simplify: number;
  /** Skip footprints smaller than this (m²). */
  minArea: number;
}

export const HIGH_DETAIL: BuildingDetail = { simplify: 0, minArea: 0 };
export const LOW_DETAIL: BuildingDetail = { simplify: 2, minArea: 80 };

/** Extrude footprints into one merged geometry: flat roofs, vertical walls, optional undersides. */
export function writeBuildings(buildings: Building[], detail: BuildingDetail, w = new GeometryWriter(buildings.length * 24)): GeometryWriter {
  for (const b of buildings) {
    if (b.area < detail.minArea) continue;
    const outer = detail.simplify > 0 ? simplifyRing(b.outer, detail.simplify) : b.outer;
    const holes = detail.simplify > 0 ? [] : b.holes; // holes are invisible from afar
    extrude(w, outer, holes, b.minHeight, b.height);
  }
  return w;
}

function extrude(w: GeometryWriter, outer: Ring, holes: Ring[], bottom: number, top: number): void {
  const contour = outer.map((p) => new Vector2(p[0], p[1]));
  const holeVecs = holes.map((h) => h.map((p) => new Vector2(p[0], p[1])));
  let faces: number[][];
  try {
    faces = ShapeUtils.triangulateShape(contour, holeVecs);
  } catch {
    return;
  }
  const all = [...contour, ...holeVecs.flat()];
  // Roof (normal up) and, for raised parts, an underside (normal down).
  for (const f of faces) {
    const a = all[f[0]];
    const b = all[f[1]];
    const c = all[f[2]];
    if (!a || !b || !c) continue;
    w.tri(a.x, top, -a.y, b.x, top, -b.y, c.x, top, -c.y, 0, 1, 0);
    if (bottom > 0.5) w.tri(a.x, bottom, -a.y, b.x, bottom, -b.y, c.x, bottom, -c.y, 0, -1, 0);
  }
  // Walls. Outer rings are CCW and holes CW (y-up), so the right-hand normal (dy, −dx) points
  // out of the solid in both cases. Map (x, y) → (x, ·, −y).
  for (const ring of [outer, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const nx = dy / len;
      const nz = dx / len; // −(−dx/len): north-south flip
      w.quad([x0, bottom, -y0], [x1, bottom, -y1], [x1, top, -y1], [x0, top, -y0], nx, 0, nz);
    }
  }
}
