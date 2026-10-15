import { describe, expect, it } from 'vitest';
import { LocalProjection, bboxArea, bboxAround, clampBBox, haversine } from '../src/geo/projection';
import { type Ring, assembleRings, cleanRing, clipRingToRect, orient, pointInRing, signedArea, simplifyRing } from '../src/geo/polygon';

describe('LocalProjection', () => {
  const origin = { lat: 40.7075, lng: -74.0113 };
  const proj = new LocalProjection(origin);

  it('maps the origin to (0, 0)', () => {
    expect(proj.project(origin.lat, origin.lng)).toEqual([0, 0]);
  });

  it('agrees with great-circle distances to within 0.1 % over 1 km', () => {
    for (const [dLat, dLng] of [[0.009, 0], [0, 0.012], [0.006, -0.008], [-0.007, 0.007]]) {
      const p = { lat: origin.lat + dLat, lng: origin.lng + dLng };
      const [x, y] = proj.project(p.lat, p.lng);
      const d = haversine(origin, p);
      expect(Math.abs(Math.hypot(x, y) - d) / d).toBeLessThan(1e-3);
    }
  });

  it('puts east at +x and north at +y', () => {
    expect(proj.project(origin.lat, origin.lng + 0.001)[0]).toBeGreaterThan(0);
    expect(proj.project(origin.lat + 0.001, origin.lng)[1]).toBeGreaterThan(0);
  });

  it('round-trips through unproject', () => {
    const [x, y] = proj.project(40.71, -74.0);
    const ll = proj.unproject(x, y);
    expect(ll.lat).toBeCloseTo(40.71, 9);
    expect(ll.lng).toBeCloseTo(-74.0, 9);
  });

  it('handles the antimeridian', () => {
    const fiji = new LocalProjection({ lat: -17, lng: 179.999 });
    const [x] = fiji.project(-17, -179.999);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(300);
  });
});

describe('bounding boxes', () => {
  it('bboxAround produces the requested area', () => {
    for (const lat of [0, 35.66, 48.85, 64]) {
      const b = bboxAround({ lat, lng: 10 }, 1_500_000);
      expect(bboxArea(b) / 1_500_000).toBeCloseTo(1, 2);
    }
  });

  it('clampBBox caps large boxes but keeps the centre', () => {
    const big = { south: 48.8, west: 2.25, north: 48.9, east: 2.45 };
    const c = clampBBox(big, 1_500_000);
    expect(bboxArea(c)).toBeLessThanOrEqual(1_500_001);
    expect((c.south + c.north) / 2).toBeCloseTo(48.85, 9);
    expect((c.west + c.east) / 2).toBeCloseTo(2.35, 9);
    const small = bboxAround({ lat: 1, lng: 1 }, 10_000);
    expect(clampBBox(small, 1_500_000)).toBe(small);
  });
});

describe('polygon utilities', () => {
  const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('computes signed area and orientation', () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea([...square].reverse())).toBe(-100);
    expect(signedArea(orient([...square].reverse(), true))).toBe(100);
    expect(signedArea(orient(square, false))).toBe(-100);
  });

  it('cleans closing and duplicate vertices', () => {
    expect(cleanRing([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it('assembles multipolygon fragments into closed rings', () => {
    const parts: Ring[] = [
      [[0, 0], [5, 0], [10, 0]],
      [[10, 10], [10, 0]], // reversed fragment
      [[10, 10], [0, 10], [0, 0]],
    ];
    const rings = assembleRings(parts);
    expect(rings).toHaveLength(1);
    expect(Math.abs(signedArea(cleanRing(rings[0])))).toBe(100);
  });

  it('drops fragments that cannot be closed', () => {
    expect(assembleRings([[[0, 0], [1, 0]], [[5, 5], [6, 6]]])).toEqual([]);
  });

  it('simplifies nearly collinear points but keeps corners', () => {
    const noisy: Ring = [[0, 0], [5, 0.05], [10, 0], [10, 5], [10.04, 10], [5, 10], [0, 10], [0, 5]];
    const s = simplifyRing(noisy, 0.5);
    expect(s.length).toBe(4);
    expect(Math.abs(signedArea(s))).toBeCloseTo(100, 0);
  });

  it('clips rings to a rectangle (Sutherland–Hodgman)', () => {
    const clipped = clipRingToRect(square, { minX: 5, minY: -5, maxX: 20, maxY: 5 });
    expect(Math.abs(signedArea(clipped))).toBeCloseTo(25, 9);
    expect(clipRingToRect(square, { minX: 20, minY: 20, maxX: 30, maxY: 30 })).toEqual([]);
  });

  it('point in polygon', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
  });
});
