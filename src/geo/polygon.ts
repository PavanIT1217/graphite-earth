export type Ring = [number, number][];

/** Signed area (shoelace). Positive = counter-clockwise in a y-up frame. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

/** Drop the duplicated closing vertex and consecutive duplicates. */
export function cleanRing(ring: Ring, eps = 1e-6): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop();
  }
  return out;
}

/** Return the ring in counter-clockwise order (outer rings) or clockwise (`ccw = false`, holes). */
export function orient(ring: Ring, ccw = true): Ring {
  const isCcw = signedArea(ring) > 0;
  return isCcw === ccw ? ring : [...ring].reverse();
}

/** Ramer–Douglas–Peucker simplification for closed rings. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  // Split at the vertex farthest from the first so the closed ring has two open halves.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = ring[a];
    const pb = ring[b % ring.length];
    let idx = -1;
    let maxD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(ring[i], pa, pb);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring;
}

function segDist2(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/**
 * Join open way fragments (as in OSM multipolygon relations) into closed rings by matching endpoints.
 * Fragments that can't be closed are dropped.
 */
export function assembleRings(parts: Ring[], eps = 1e-7): Ring[] {
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
  const pool = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: Ring[] = [];
  while (pool.length) {
    let ring = pool.pop()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Even–odd point-in-polygon test. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Axis-aligned rectangle in projected metres. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Sutherland–Hodgman clip of a ring against a rectangle (works for concave rings too). */
export function clipRingToRect(ring: Ring, r: Rect): Ring {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= r.minX, (a, b) => lerpX(a, b, r.minX)],
    [(p) => p[0] <= r.maxX, (a, b) => lerpX(a, b, r.maxX)],
    [(p) => p[1] >= r.minY, (a, b) => lerpY(a, b, r.minY)],
    [(p) => p[1] <= r.maxY, (a, b) => lerpY(a, b, r.maxY)],
  ];
  let out = ring;
  for (const [inside, cross] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
  }
  return out;
}

function lerpX(a: [number, number], b: [number, number], x: number): [number, number] {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
function lerpY(a: [number, number], b: [number, number], y: number): [number, number] {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}
