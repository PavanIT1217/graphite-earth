import { BufferAttribute, BufferGeometry } from 'three';

/** Per-vertex fade (1 = fully drawn, 0 = blank paper) as a function of world x/z. */
export type FadeFn = (x: number, z: number) => number;

/**
 * Growable non-indexed triangle buffer with per-vertex normals and an optional fade colour
 * (stored as vertex colour (1, 1, fade); the scene pass multiplies it into the blue channel).
 * World frame: x = east, y = up, z = south (so north is −z), from 2D map coords (east, north).
 * Triangles are always emitted counter-clockwise as seen from the side their normal points to,
 * so FrontSide rendering and shadow casting behave.
 */
export class GeometryWriter {
  private pos: Float32Array;
  private nor: Float32Array;
  private n = 0;
  fade: FadeFn | null = null;

  constructor(initialTriangles = 1024) {
    this.pos = new Float32Array(initialTriangles * 9);
    this.nor = new Float32Array(initialTriangles * 9);
  }

  get vertexCount(): number {
    return this.n / 3;
  }

  private reserve(floats: number): void {
    if (this.n + floats <= this.pos.length) return;
    let size = this.pos.length * 2;
    while (size < this.n + floats) size *= 2;
    const p = new Float32Array(size);
    p.set(this.pos.subarray(0, this.n));
    this.pos = p;
    const q = new Float32Array(size);
    q.set(this.nor.subarray(0, this.n));
    this.nor = q;
  }

  /** Add a triangle (3D points) facing along (nx, ny, nz); winding is fixed up as needed. */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
  ): void {
    // Face normal from winding; swap B and C if it disagrees with the requested normal.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    if (fx * nx + fy * ny + fz * nz < 0) {
      let t = bx; bx = cx; cx = t;
      t = by; by = cy; cy = t;
      t = bz; bz = cz; cz = t;
    }
    this.reserve(9);
    const p = this.pos;
    const q = this.nor;
    let i = this.n;
    p[i] = ax; p[i + 1] = ay; p[i + 2] = az;
    p[i + 3] = bx; p[i + 4] = by; p[i + 5] = bz;
    p[i + 6] = cx; p[i + 7] = cy; p[i + 8] = cz;
    for (let k = 0; k < 3; k++, i += 3) {
      q[i] = nx; q[i + 1] = ny; q[i + 2] = nz;
    }
    this.n += 9;
  }

  /** Quad a-b-c-d (in order around its perimeter). */
  quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    nx: number, ny: number, nz: number,
  ): void {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], nx, ny, nz);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], nx, ny, nz);
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.slice(0, this.n), 3));
    g.setAttribute('normal', new BufferAttribute(this.nor.slice(0, this.n), 3));
    if (this.fade) {
      const col = new Float32Array(this.n);
      for (let i = 0; i < this.n; i += 3) {
        col[i] = 1;
        col[i + 1] = 1;
        col[i + 2] = this.fade(this.pos[i], this.pos[i + 2]);
      }
      g.setAttribute('color', new BufferAttribute(col, 3));
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
