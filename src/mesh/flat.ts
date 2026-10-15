import { ShapeUtils, Vector2 } from 'three';
import type { Area, Line } from '../data/osm';
import type { Ring } from '../geo/polygon';
import { GeometryWriter } from './geometryWriter';

/** Triangulate flat polygons (water, parks, sand) at a fixed elevation. */
export function writeAreas(areas: Area[], elevation: number, w = new GeometryWriter()): GeometryWriter {
  for (const a of areas) {
    const contour = a.outer.map((p) => new Vector2(p[0], p[1]));
    const holes = a.holes.map((h) => h.map((p) => new Vector2(p[0], p[1])));
    let faces: number[][];
    try {
      faces = ShapeUtils.triangulateShape(contour, holes);
    } catch {
      continue;
    }
    const all = [...contour, ...holes.flat()];
    for (const f of faces) {
      const p = all[f[0]];
      const q = all[f[1]];
      const r = all[f[2]];
      if (!p || !q || !r) continue;
      w.tri(p.x, elevation, -p.y, q.x, elevation, -q.y, r.x, elevation, -r.y, 0, 1, 0);
    }
  }
  return w;
}

const JOIN_SEGMENTS = 6;

/** Flat ribbons for roads/rails/streams, with small round joins so bends have no gaps. */
export function writeRibbons(lines: Line[], elevation: (l: Line) => number, w = new GeometryWriter()): GeometryWriter {
  for (const l of lines) {
    const y = elevation(l);
    const hw = l.width / 2;
    const pts = l.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const ox = (-dy / len) * hw;
      const oy = (dx / len) * hw;
      w.quad([x0 + ox, y, -(y0 + oy)], [x1 + ox, y, -(y1 + oy)], [x1 - ox, y, -(y1 - oy)], [x0 - ox, y, -(y0 - oy)], 0, 1, 0);
    }
    for (let i = 1; i + 1 < pts.length; i++) disc(w, pts[i], hw, y);
  }
  return w;
}

function disc(w: GeometryWriter, c: [number, number], r: number, y: number): void {
  for (let s = 0; s < JOIN_SEGMENTS; s++) {
    const a0 = (s / JOIN_SEGMENTS) * Math.PI * 2;
    const a1 = ((s + 1) / JOIN_SEGMENTS) * Math.PI * 2;
    w.tri(
      c[0], y, -c[1],
      c[0] + Math.cos(a0) * r, y, -(c[1] + Math.sin(a0) * r),
      c[0] + Math.cos(a1) * r, y, -(c[1] + Math.sin(a1) * r),
      0, 1, 0,
    );
  }
}

/**
 * Ground plane covering the bounds, subdivided into a grid so the per-vertex fade
 * (drawing dissolving into blank paper) interpolates smoothly.
 */
export function writeGround(minX: number, minY: number, maxX: number, maxY: number, cells = 48, w = new GeometryWriter(cells * cells * 2)): GeometryWriter {
  const dx = (maxX - minX) / cells;
  const dy = (maxY - minY) / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x0 = minX + i * dx;
      const y0 = minY + j * dy;
      w.quad([x0, 0, -y0], [x0 + dx, 0, -y0], [x0 + dx, 0, -(y0 + dy)], [x0, 0, -(y0 + dy)], 0, 1, 0);
    }
  }
  return w;
}

export type { Ring };
