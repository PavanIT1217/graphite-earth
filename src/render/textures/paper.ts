import { DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';

const SIZE = 512;

/** Tileable paper grain: multi-octave value noise plus faint fibres. Stored in the red channel. */
export function createPaperTexture(seed = 3): DataTexture {
  const data = new Uint8Array(SIZE * SIZE);
  const field = new Float32Array(SIZE * SIZE);
  let s = seed >>> 0;
  const rand = () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39;
    s ^= s >>> 12;
    return (s >>> 0) / 4294967296;
  };

  for (const [cells, amp] of [
    [8, 0.35],
    [32, 0.3],
    [128, 0.2],
    [256, 0.15],
  ] as const) {
    const grid = new Float32Array(cells * cells).map(() => rand());
    const step = SIZE / cells;
    for (let y = 0; y < SIZE; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      const ty = smooth(gy - Math.floor(gy));
      for (let x = 0; x < SIZE; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        const tx = smooth(gx - Math.floor(gx));
        const a = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * tx;
        const b = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * tx;
        field[y * SIZE + x] += (a + (b - a) * ty) * amp;
      }
    }
  }
  // Fibres: short faint streaks.
  for (let f = 0; f < 900; f++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    const ang = rand() * Math.PI;
    const len = 6 + rand() * 18;
    const k = (rand() - 0.5) * 0.25;
    for (let t = 0; t < len; t++) {
      x += Math.cos(ang);
      y += Math.sin(ang);
      const i = ((Math.floor(y) + SIZE) % SIZE) * SIZE + ((Math.floor(x) + SIZE) % SIZE);
      field[i] += k;
    }
  }
  for (let i = 0; i < field.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(field[i] * 255)));
  const tex = new DataTexture(data, SIZE, SIZE, RedFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
