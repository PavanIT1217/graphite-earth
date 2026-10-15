// Generates an Overpass-API-shaped response (out geom) for a fictional city block grid.
// Used by scripts/screenshots.mjs as a fallback when the public Overpass servers are unavailable,
// and handy for offline development: node scripts/synthetic-city.mjs 40.7 -74 > city.json
export function syntheticCity(lat, lng, size = 1000, seed = 1) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const mLat = 1 / 111_195;
  const mLng = 1 / (111_195 * Math.cos((lat * Math.PI) / 180));
  const pt = (x, y) => ({ lat: lat + y * mLat, lon: lng + x * mLng });
  const ring = (pts) => [...pts.map(([x, y]) => pt(x, y)), pt(...pts[0])];
  const elements = [];
  let id = 1;
  const half = size / 2;
  const block = 110;
  const street = 18;
  const riverY = -half * 0.45;

  // River and its banks.
  elements.push({ type: 'way', id: id++, tags: { natural: 'water' }, geometry: ring([[-half - 50, riverY - 45], [half + 50, riverY - 60], [half + 50, riverY + 20], [-half - 50, riverY + 35]]) });
  // Park.
  elements.push({ type: 'way', id: id++, tags: { leisure: 'park' }, geometry: ring([[block * 0.5, block * 0.6], [block * 2.3, block * 0.6], [block * 2.3, block * 2.2], [block * 0.5, block * 2.2]]) });

  for (let gx = -half; gx < half; gx += block) {
    elements.push({ type: 'way', id: id++, tags: { highway: Math.abs(gx) < block ? 'primary' : 'residential' }, geometry: [pt(gx, riverY + 40), pt(gx, half)] });
  }
  for (let gy = riverY + 40; gy < half; gy += block) {
    elements.push({ type: 'way', id: id++, tags: { highway: 'secondary' }, geometry: [pt(-half, gy), pt(half, gy)] });
  }
  elements.push({ type: 'way', id: id++, tags: { highway: 'primary', bridge: 'yes' }, geometry: [pt(block * 0.05, riverY - 70), pt(block * 0.05, riverY + 45)] });

  for (let bx = -half; bx < half - block; bx += block) {
    for (let by = riverY + 40; by < half - block; by += block) {
      const cx = bx + street;
      const cy = by + street;
      const inner = block - street * 1.4;
      if (cx > block * 0.4 && cx < block * 2.4 && cy > block * 0.5 && cy < block * 2.3) continue; // park
      const n = 1 + Math.floor(rand() * 3);
      const w = inner / n;
      const tall = Math.hypot(bx, by) < 260;
      for (let i = 0; i < n; i++) {
        const x0 = cx + i * w + 2;
        const x1 = cx + (i + 1) * w - 2;
        const y0 = cy + 2;
        const y1 = cy + inner * (0.55 + rand() * 0.45);
        const levels = tall ? 8 + Math.floor(rand() * 40) : 3 + Math.floor(rand() * 7);
        const pts = rand() < 0.25 ? [[x0, y0], [x1, y0], [x1, y1], [x0 + (x1 - x0) * 0.5, y1], [x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.6], [x0, y0 + (y1 - y0) * 0.6]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        elements.push({ type: 'way', id: id++, tags: { building: 'yes', 'building:levels': String(levels) }, geometry: ring(pts) });
      }
    }
  }
  return { version: 0.6, generator: 'synthetic-city', elements };
}

if (process.argv[1] && process.argv[1].endsWith('synthetic-city.mjs')) {
  const [lat = 40.7075, lng = -74.0113] = process.argv.slice(2).map(Number);
  process.stdout.write(JSON.stringify(syntheticCity(lat, lng)));
}
