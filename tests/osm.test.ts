import { describe, expect, it } from 'vitest';
import { buildingHeight, hash01, parseLength, roadWidth } from '../src/data/heights';
import { areaKind, coastlineStrip, parseOsm } from '../src/data/osm';
import { buildQuery, cacheKey } from '../src/data/overpass';
import { parseNominatim } from '../src/data/nominatim';
import { LocalProjection, bboxAround } from '../src/geo/projection';
import { signedArea } from '../src/geo/polygon';

describe('lengths and heights', () => {
  it('parses OSM length formats', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('7,5')).toBe(7.5);
    expect(parseLength("40'")).toBeCloseTo(12.192, 3);
    expect(parseLength('100 ft')).toBeCloseTo(30.48, 3);
    expect(parseLength('12\'6"')).toBeCloseTo(3.81, 2);
    expect(parseLength('tall')).toBeNull();
    expect(parseLength(undefined)).toBeNull();
  });

  it('prefers explicit height, then levels, then a typed fallback', () => {
    expect(buildingHeight({ building: 'yes', height: '30' })).toMatchObject({ height: 30, measured: true });
    expect(buildingHeight({ building: 'yes', 'building:height': '20 m' }).height).toBe(20);
    expect(buildingHeight({ building: 'yes', 'building:levels': '10' })).toMatchObject({ height: 32, measured: true });
    const roofed = buildingHeight({ building: 'yes', 'building:levels': '10', 'roof:levels': '1' });
    expect(roofed.height).toBeCloseTo(33.92, 2);
    const house = buildingHeight({ building: 'house' }, 42);
    expect(house.measured).toBe(false);
    expect(house.height).toBeGreaterThanOrEqual(7 * 0.8);
    expect(house.height).toBeLessThanOrEqual(7 * 1.2);
  });

  it('fallback heights are deterministic per id', () => {
    expect(buildingHeight({ building: 'yes' }, 7).height).toBe(buildingHeight({ building: 'yes' }, 7).height);
    for (let i = 0; i < 100; i++) {
      const h = hash01(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('handles min_height and keeps walls positive', () => {
    const h = buildingHeight({ building: 'yes', height: '20', min_height: '8' });
    expect(h.minHeight).toBe(8);
    expect(h.height).toBe(20);
    const odd = buildingHeight({ building: 'yes', height: '5', min_height: '9' });
    expect(odd.height).toBeGreaterThan(odd.minHeight);
  });

  it('road widths', () => {
    expect(roadWidth({ highway: 'primary' })).toBe(12);
    expect(roadWidth({ highway: 'residential', width: '9' })).toBe(9);
    expect(roadWidth({ highway: 'pedestrian', area: 'yes' })).toBeNull();
    expect(roadWidth({ highway: 'construction' })).toBeNull();
    expect(roadWidth({ highway: 'something_new' })).toBe(4);
  });
});

describe('feature classification', () => {
  it('classifies areas', () => {
    expect(areaKind({ natural: 'water' })).toBe('water');
    expect(areaKind({ waterway: 'riverbank' })).toBe('water');
    expect(areaKind({ leisure: 'park' })).toBe('park');
    expect(areaKind({ landuse: 'forest' })).toBe('park');
    expect(areaKind({ natural: 'beach' })).toBe('sand');
    expect(areaKind({ landuse: 'residential' })).toBeNull();
  });

  it('builds the coastline water strip on the right-hand side', () => {
    // Heading north: water should be to the east (+x).
    const strip = coastlineStrip([[0, 0], [0, 100]], 50);
    expect(Math.max(...strip.map((p) => p[0]))).toBe(50);
    expect(Math.min(...strip.map((p) => p[0]))).toBe(0);
  });
});

describe('parseOsm', () => {
  const origin = { lat: 48.8547, lng: 2.3477 };
  const proj = new LocalProjection(origin);
  const bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  const d = 0.0001; // ≈ 11 m north, ≈ 7 m east
  const square = (lat: number, lng: number, s = d) => [
    { lat, lon: lng },
    { lat, lon: lng + s },
    { lat: lat + s, lon: lng + s },
    { lat: lat + s, lon: lng },
    { lat, lon: lng },
  ];

  const json = {
    elements: [
      { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '5' }, geometry: square(origin.lat, origin.lng) },
      { type: 'way', id: 2, tags: { building: 'yes' }, geometry: square(origin.lat + 0.1, origin.lng) }, // far outside
      { type: 'way', id: 3, tags: { building: 'no' }, geometry: square(origin.lat, origin.lng) },
      {
        type: 'relation',
        id: 4,
        tags: { building: 'yes', type: 'multipolygon', height: '40' },
        members: [
          { type: 'way', role: 'outer', geometry: square(origin.lat + 0.001, origin.lng, 4 * d) },
          { type: 'way', role: 'inner', geometry: square(origin.lat + 0.001 + d, origin.lng + d, d) },
        ],
      },
      { type: 'way', id: 5, tags: { leisure: 'park' }, geometry: square(origin.lat - 0.001, origin.lng, 3 * d) },
      { type: 'way', id: 6, tags: { highway: 'primary' }, geometry: [{ lat: origin.lat, lon: origin.lng }, { lat: origin.lat, lon: origin.lng + 0.002 }] },
      { type: 'way', id: 7, tags: { highway: 'primary', tunnel: 'yes' }, geometry: [{ lat: origin.lat, lon: origin.lng }, { lat: origin.lat, lon: origin.lng + 0.002 }] },
      { type: 'way', id: 8, tags: { waterway: 'river' }, geometry: [{ lat: origin.lat - 0.002, lon: origin.lng - 0.002 }, { lat: origin.lat - 0.002, lon: origin.lng + 0.002 }] },
      { type: 'way', id: 9, tags: { railway: 'rail', bridge: 'yes' }, geometry: [{ lat: origin.lat + 0.002, lon: origin.lng }, { lat: origin.lat + 0.002, lon: origin.lng + 0.001 }] },
    ],
  };

  const data = parseOsm(json, proj, bounds);

  it('keeps buildings inside the bounds and skips building=no', () => {
    expect(data.buildings.map((b) => b.id).sort()).toEqual([1, 4]);
    expect(data.stats.measuredHeights).toBe(2);
  });

  it('builds CCW outers with CW holes for multipolygons', () => {
    const rel = data.buildings.find((b) => b.id === 4)!;
    expect(rel.height).toBe(40);
    expect(signedArea(rel.outer)).toBeGreaterThan(0);
    expect(rel.holes).toHaveLength(1);
    expect(signedArea(rel.holes[0])).toBeLessThan(0);
  });

  it('computes levels-based height', () => {
    expect(data.buildings.find((b) => b.id === 1)!.height).toBe(16);
  });

  it('collects areas and lines, skipping tunnels', () => {
    expect(data.areas.map((a) => a.kind)).toEqual(['park']);
    expect(data.lines.map((l) => l.kind).sort()).toEqual(['rail', 'road', 'waterway']);
    expect(data.lines.find((l) => l.kind === 'rail')!.layer).toBe(1);
    expect(data.lines.find((l) => l.kind === 'road')!.width).toBe(12);
  });

  it('tolerates empty or malformed input', () => {
    expect(parseOsm({}, proj, bounds).buildings).toEqual([]);
    expect(parseOsm(null, proj, bounds).lines).toEqual([]);
  });
});

describe('Overpass and Nominatim helpers', () => {
  it('builds a bbox query with out geom', () => {
    const q = buildQuery(bboxAround({ lat: 35.6595, lng: 139.7005 }, 1e6));
    expect(q).toMatch(/^\[out:json\]/);
    expect(q).toContain('way["building"](35.65');
    expect(q).toContain('out geom qt;');
  });

  it('cache keys are stable and versioned', () => {
    const b = bboxAround({ lat: 1, lng: 2 }, 1e6);
    expect(cacheKey(b)).toBe(cacheKey({ ...b }));
    expect(cacheKey(b)).toMatch(/^overpass:v\d+:/);
  });

  it('parses Nominatim results', () => {
    const [p] = parseNominatim([
      {
        place_id: 1,
        osm_type: 'relation',
        osm_id: 9,
        lat: '17.71',
        lon: '83.32',
        name: 'Ramakrishna Beach',
        display_name: 'Ramakrishna Beach, Visakhapatnam, Andhra Pradesh, India',
        boundingbox: ['17.70', '17.72', '83.31', '83.33'],
      },
    ]);
    expect(p).toMatchObject({ id: 'relation/9', name: 'Ramakrishna Beach', lat: 17.71, lng: 83.32 });
    expect(p.detail).toBe('Visakhapatnam, Andhra Pradesh, India');
    expect(p.bbox).toEqual({ south: 17.7, north: 17.72, west: 83.31, east: 83.33 });
    expect(parseNominatim('nope')).toEqual([]);
  });
});
