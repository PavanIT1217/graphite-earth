import { describe, expect, it } from 'vitest';
import type { Building, CityData } from '../src/data/osm';
import { HIGH_DETAIL, LOW_DETAIL, writeBuildings } from '../src/mesh/buildings';
import { SURFACE, buildCity, tileBuildings } from '../src/mesh/cityBuilder';
import { writeAreas, writeRibbons } from '../src/mesh/flat';
import { GeometryWriter } from '../src/mesh/geometryWriter';

const box = (id: number, x: number, y: number, s: number, height: number, minHeight = 0): Building => ({
  id,
  outer: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]],
  holes: [],
  height,
  minHeight,
  area: s * s,
});

/** Check every triangle's winding agrees with its stored normal. */
function windingMatchesNormals(w: GeometryWriter): boolean {
  const g = w.toGeometry();
  const p = g.getAttribute('position').array as Float32Array;
  const n = g.getAttribute('normal').array as Float32Array;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * n[i] + fy * n[i + 1] + fz * n[i + 2] <= 0) return false;
  }
  return true;
}

describe('building extrusion', () => {
  it('produces roof + 4 walls for a box (2 + 8 triangles)', () => {
    const w = writeBuildings([box(1, 0, 0, 10, 20)], HIGH_DETAIL);
    expect(w.vertexCount).toBe(30);
    expect(windingMatchesNormals(w)).toBe(true);
  });

  it('wall normals point outwards and roofs up', () => {
    const g = writeBuildings([box(1, 0, 0, 10, 20)], HIGH_DETAIL).toGeometry();
    const p = g.getAttribute('position').array as Float32Array;
    const n = g.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < p.length; i += 9) {
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3 - 5;
      const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3 + 5; // footprint centre is (5, −5) in x/z
      if (n[i + 1] === 1) expect(p[i + 1]).toBe(20);
      else expect(cx * n[i] + cz * n[i + 2]).toBeGreaterThan(0);
    }
  });

  it('adds an underside for raised parts', () => {
    expect(writeBuildings([box(1, 0, 0, 10, 20, 6)], HIGH_DETAIL).vertexCount).toBe(36);
  });

  it('extrudes footprints with holes', () => {
    const courtyard: Building = {
      ...box(2, 0, 0, 30, 15),
      holes: [[[10, 10], [10, 20], [20, 20], [20, 10]]], // CW
    };
    const w = writeBuildings([courtyard], HIGH_DETAIL);
    expect(w.vertexCount).toBe(8 * 3 + 8 * 6); // 8 roof triangles, 8 walls
    expect(windingMatchesNormals(w)).toBe(true);
  });

  it('low detail drops small buildings', () => {
    const w = writeBuildings([box(1, 0, 0, 5, 9), box(2, 20, 0, 20, 9)], LOW_DETAIL);
    expect(w.vertexCount).toBe(30);
  });
});

describe('flat features', () => {
  it('triangulates areas facing up', () => {
    const w = writeAreas([{ kind: 'park', outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] }], 0.4);
    expect(w.vertexCount).toBe(6);
    expect(windingMatchesNormals(w)).toBe(true);
  });

  it('builds road ribbons with joins', () => {
    const w = writeRibbons([{ kind: 'road', points: [[0, 0], [10, 0], [10, 10]], width: 6, layer: 0 }], () => 0.7);
    expect(w.vertexCount).toBe(2 * 6 + 6 * 3);
    expect(windingMatchesNormals(w)).toBe(true);
  });

  it('GeometryWriter grows past its initial capacity', () => {
    const w = new GeometryWriter(1);
    for (let i = 0; i < 100; i++) w.tri(0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0);
    expect(w.vertexCount).toBe(300);
  });
});

describe('city builder', () => {
  it('tiles buildings and creates LOD levels', () => {
    const buildings = [box(1, 0, 0, 10, 10), box(2, 400, 0, 10, 10), box(3, 10, 10, 12, 30)];
    expect(tileBuildings(buildings, 300)).toHaveLength(2);
    const data: CityData = {
      buildings,
      areas: [{ kind: 'water', outer: [[-50, -50], [-20, -50], [-20, -20], [-50, -20]], holes: [] }],
      lines: [{ kind: 'road', points: [[0, -10], [100, -10]], width: 8, layer: 0 }],
      bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
      stats: { buildings: 3, measuredHeights: 0, roads: 1, areas: 1 },
    };
    const city = buildCity(data);
    const lods = city.group.children.filter((c) => c.name === 'building-tile');
    expect(lods).toHaveLength(2);
    expect(city.group.children.some((c) => c.name === 'water')).toBe(true);
    expect(city.triangles).toBeGreaterThan(0);
    city.dispose();
  });

  it('encodes surface classes 0.2 apart so the shader can decode them', () => {
    const values = Object.values(SURFACE).sort();
    values.forEach((v, i) => expect(v).toBeCloseTo(i * 0.2, 9));
  });
});
