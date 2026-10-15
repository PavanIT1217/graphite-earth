import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

const SIZE = 256;

interface LayerSpec {
  count: number;
  angle: number;
  width: number;
  alpha: number;
}

/**
 * Four tileable pencil-stroke layers packed into one RGBA texture:
 *   R: sparse diagonal strokes · G: denser parallel strokes
 *   B: cross strokes (other diagonal) · A: dense near-horizontal cross strokes
 * The composite shader blends them by tone (more layers = darker), giving tonal art maps
 * with cross-hatching in the darkest/shadowed areas.
 */
export function createHatchTexture(seed = 7): DataTexture {
  const layers: LayerSpec[] = [
    { count: 55, angle: -0.95, width: 1.1, alpha: 0.7 },
    { count: 95, angle: -0.85, width: 1.1, alpha: 0.75 },
    { count: 95, angle: 0.75, width: 1.1, alpha: 0.8 },
    { count: 150, angle: 0.15, width: 1.2, alpha: 0.85 },
  ];
  const data = new Uint8Array(SIZE * SIZE * 4);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  layers.forEach((spec, channel) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.lineCap = 'round';
    for (let i = 0; i < spec.count; i++) {
      const len = 50 + rand() * 120;
      const ang = spec.angle + (rand() - 0.5) * 0.12;
      const cx = rand() * SIZE;
      const cy = rand() * SIZE;
      const dx = Math.cos(ang) * len * 0.5;
      const dy = Math.sin(ang) * len * 0.5;
      const bend = (rand() - 0.5) * 6;
      ctx.lineWidth = spec.width * (0.7 + rand() * 0.6);
      ctx.strokeStyle = `rgba(0,0,0,${spec.alpha * (0.55 + rand() * 0.45)})`;
      // Draw wrapped copies so the texture tiles seamlessly.
      for (const ox of [-SIZE, 0, SIZE]) {
        for (const oy of [-SIZE, 0, SIZE]) {
          ctx.beginPath();
          ctx.moveTo(cx - dx + ox, cy - dy + oy);
          ctx.quadraticCurveTo(cx + ox - dy * 0.05 * bend, cy + oy + dx * 0.05 * bend, cx + dx + ox, cy + dy + oy);
          ctx.stroke();
        }
      }
    }
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    for (let i = 0; i < SIZE * SIZE; i++) data[i * 4 + channel] = px[i * 4 + 3];
  });

  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
