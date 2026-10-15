import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, type Texture, TextureLoader } from 'three';
import { type TileId, tileKey } from '../geo/tiles';

/** Tile URL template. Override with VITE_TILE_URL to use your own or a commercial tile server. */
export const TILE_URL: string = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** The OSM tile usage policy asks clients to keep concurrent requests low. */
const MAX_CONCURRENT = 4;
const MAX_TEXTURES = 260;
export const BASE_ZOOM = 3;

interface Entry {
  tex: Texture | null;
  loading: boolean;
  failed: boolean;
  lastUsed: number;
  loadedAt: number;
}

/**
 * LRU cache of tile textures with a small download queue. Newest requests win: when the
 * camera moves on, stale queued tiles are dropped before they are fetched.
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();
  private queue: TileId[] = [];
  private active = 0;
  private readonly loader = new TextureLoader().setCrossOrigin('anonymous');
  onLoad: () => void = () => undefined;

  get(t: TileId, now: number): Entry | undefined {
    const e = this.entries.get(tileKey(t));
    if (e) e.lastUsed = now;
    return e;
  }

  /** Mark the tiles wanted this frame (in priority order) and start downloads. */
  request(tiles: TileId[], now: number): void {
    const wanted: TileId[] = [];
    for (const t of tiles) {
      const k = tileKey(t);
      let e = this.entries.get(k);
      if (!e) {
        e = { tex: null, loading: false, failed: false, lastUsed: now, loadedAt: 0 };
        this.entries.set(k, e);
      }
      e.lastUsed = now;
      if (!e.tex && !e.loading && !e.failed) wanted.push(t);
    }
    this.queue = wanted;
    this.pump();
    this.evict();
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length) {
      const t = this.queue.shift()!;
      const e = this.entries.get(tileKey(t));
      if (!e || e.loading || e.tex) continue;
      e.loading = true;
      this.active++;
      const url = TILE_URL.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
      this.loader.load(
        url,
        (tex) => {
          // Keep raw sRGB values: the shader classifies OSM carto colours (water, parks) directly.
          tex.colorSpace = NoColorSpace;
          tex.minFilter = LinearMipmapLinearFilter;
          tex.magFilter = LinearFilter;
          tex.anisotropy = 4;
          e.tex = tex;
          e.loading = false;
          e.loadedAt = performance.now();
          this.active--;
          this.onLoad();
          this.pump();
        },
        undefined,
        () => {
          e.loading = false;
          e.failed = true;
          this.active--;
          this.pump();
        },
      );
    }
  }

  private evict(): void {
    if (this.entries.size <= MAX_TEXTURES) return;
    const sorted = [...this.entries.entries()].filter(([, e]) => !e.loading).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k, e] of sorted.slice(0, this.entries.size - MAX_TEXTURES)) {
      if (Number(k.split('/')[0]) <= BASE_ZOOM) continue; // keep the always-visible base layer
      e.tex?.dispose();
      this.entries.delete(k);
    }
  }
}
