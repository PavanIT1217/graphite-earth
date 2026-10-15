import { Color, Group, LOD, LinearSRGBColorSpace, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import type { Building, CityData, Line } from '../data/osm';
import { HIGH_DETAIL, LOW_DETAIL, writeBuildings } from './buildings';
import { type FadeFn, GeometryWriter } from './geometryWriter';
import { writeAreas, writeGround, writeRibbons } from './flat';

/**
 * Surface classes. The scene pass renders every material with linear colour (1, class, 1)
 * times a vertex colour (1, 1, fade), so the composite shader recovers lighting from R,
 * the class from G / R and the edge-of-map fade from B / R.
 */
export const SURFACE = { ground: 0, water: 0.2, park: 0.4, sand: 0.6, road: 0.8, building: 1 } as const;
export type SurfaceKind = keyof typeof SURFACE;

const ELEVATION = { water: 0.3, sand: 0.35, park: 0.45, waterway: 0.5, road: 0.7, rail: 0.75, bridge: 1.2 };
export const TILE_SIZE = 300;
export const LOD_DISTANCE = 1100;

export function surfaceMaterial(kind: SurfaceKind): MeshLambertMaterial {
  const color = new Color().setRGB(1, SURFACE[kind], 1, LinearSRGBColorSpace);
  return new MeshLambertMaterial({ color, vertexColors: true });
}

export interface CityMeshes {
  group: Group;
  triangles: number;
  dispose(): void;
}

/**
 * Turns parsed OSM features into a handful of merged meshes:
 * ground, water, parks, sand, roads (one each) and buildings split into tiles,
 * each tile a THREE.LOD with a full-detail and a simplified level.
 */
export function buildCity(data: CityData): CityMeshes {
  const group = new Group();
  group.name = 'city';
  const geometries: BufferGeometry[] = [];
  const materials = Object.fromEntries(
    (Object.keys(SURFACE) as SurfaceKind[]).map((k) => [k, surfaceMaterial(k)]),
  ) as Record<SurfaceKind, MeshLambertMaterial>;
  let triangles = 0;

  const add = (geometry: BufferGeometry, kind: SurfaceKind, castShadow: boolean, parent: Group | LOD = group, distance?: number) => {
    const count = geometry.getAttribute('position').count;
    if (count === 0) return null;
    geometries.push(geometry);
    triangles += count / 3;
    const mesh = new Mesh(geometry, materials[kind]);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.name = kind;
    if (parent instanceof LOD) parent.addLevel(mesh, distance ?? 0);
    else parent.add(mesh);
    return mesh;
  };

  const { minX, minY, maxX, maxY } = data.bounds;
  const fade = edgeFade(data.bounds);
  const writer = () => {
    const w = new GeometryWriter();
    w.fade = fade;
    return w;
  };
  const margin = Math.max(maxX - minX, maxY - minY) * 0.35;
  add(writeGround(minX - margin, minY - margin, maxX + margin, maxY + margin, 48, writer()).toGeometry(), 'ground', false);

  for (const kind of ['water', 'park', 'sand'] as const) {
    const areas = data.areas.filter((a) => a.kind === kind);
    if (areas.length) add(writeAreas(areas, ELEVATION[kind], writer()).toGeometry(), kind, false);
  }

  const waterways = data.lines.filter((l) => l.kind === 'waterway');
  if (waterways.length) add(writeRibbons(waterways, () => ELEVATION.waterway, writer()).toGeometry(), 'water', false);

  const roads = data.lines.filter((l) => l.kind !== 'waterway');
  const roadElevation = (l: Line) => (l.layer > 0 ? ELEVATION.bridge : l.kind === 'rail' ? ELEVATION.rail : ELEVATION.road);
  if (roads.length) add(writeRibbons(roads, roadElevation, writer()).toGeometry(), 'road', false);

  for (const tile of tileBuildings(data.buildings, TILE_SIZE)) {
    const lod = new LOD();
    lod.name = 'building-tile';
    add(writeBuildings(tile, HIGH_DETAIL, writer()).toGeometry(), 'building', true, lod, 0);
    add(writeBuildings(tile, LOW_DETAIL, writer()).toGeometry(), 'building', true, lod, LOD_DISTANCE);
    // LOD measures distance to its own position, so place it at the tile centre.
    const c = tileCenter(tile);
    lod.position.set(c[0], 0, -c[1]);
    for (const level of lod.levels) level.object.position.set(-c[0], 0, c[1]);
    group.add(lod);
  }

  return {
    group,
    triangles,
    dispose() {
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}

/** 1 inside the loaded square, easing to 0 just beyond it, so the drawing dissolves into paper. */
export function edgeFade(b: { minX: number; minY: number; maxX: number; maxY: number }): FadeFn {
  const half = Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2;
  const cx = (b.minX + b.maxX) / 2;
  const cz = -(b.minY + b.maxY) / 2;
  const r0 = half * 0.82;
  const r1 = half * 1.18;
  return (x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    const t = Math.min(1, Math.max(0, (d - r0) / (r1 - r0)));
    return 1 - t * t * (3 - 2 * t);
  };
}

export function tileBuildings(buildings: Building[], size: number): Building[][] {
  const tiles = new Map<string, Building[]>();
  for (const b of buildings) {
    const [x, y] = b.outer[0];
    const key = `${Math.floor(x / size)},${Math.floor(y / size)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = []));
    t.push(b);
  }
  return [...tiles.values()];
}

function tileCenter(tile: Building[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const b of tile) {
    x += b.outer[0][0];
    y += b.outer[0][1];
  }
  return [x / tile.length, y / tile.length];
}
