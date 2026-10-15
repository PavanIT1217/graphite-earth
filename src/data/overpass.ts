import { OVERPASS_MIN_INTERVAL_MS, OVERPASS_URLS, QUERY_VERSION } from '../core/config';
import type { BBox } from '../geo/projection';
import type { ResponseCache } from './cache';
import { HttpError, type ProgressInfo, fetchText } from './http';
import { RateLimiter } from './rateLimiter';

const limiter = new RateLimiter(OVERPASS_MIN_INTERVAL_MS);

const r5 = (v: number) => v.toFixed(5);

/** Overpass QL for everything we draw inside a bbox. `out geom` inlines coordinates. */
export function buildQuery(b: BBox): string {
  const bb = `${r5(b.south)},${r5(b.west)},${r5(b.north)},${r5(b.east)}`;
  return `[out:json][timeout:90][maxsize:268435456];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["highway"](${bb});
  way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"]["tunnel"!~"yes"](${bb});
  way["natural"~"^(water|wood|scrub|grassland|heath|beach|sand|coastline|bay)$"](${bb});
  relation["natural"~"^(water|wood|beach|bay)$"](${bb});
  way["waterway"~"^(river|canal|stream|riverbank|dock)$"](${bb});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|reservoir|basin)$"](${bb});
  relation["landuse"~"^(grass|forest|reservoir|basin)$"](${bb});
  way["leisure"~"^(park|garden|pitch|playground|golf_course|nature_reserve|common|dog_park)$"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});
);
out geom qt;`;
}

export function cacheKey(b: BBox): string {
  return `overpass:v${QUERY_VERSION}:${r5(b.south)},${r5(b.west)},${r5(b.north)},${r5(b.east)}`;
}

/**
 * Fetch OSM data for a bbox: IndexedDB cache first, then the Overpass mirrors in order.
 * Retries once per mirror on 429/504 using Retry-After when given.
 */
export async function fetchOsm(
  b: BBox,
  cache: ResponseCache,
  onProgress?: (p: ProgressInfo & { stage: 'cache' | 'network'; host?: string }) => void,
  signal?: AbortSignal,
): Promise<{ json: unknown; fromCache: boolean }> {
  const key = cacheKey(b);
  const cached = await cache.get(key);
  if (cached) {
    onProgress?.({ stage: 'cache', loaded: cached.length, total: cached.length });
    return { json: JSON.parse(cached), fromCache: true };
  }
  const body = new URLSearchParams({ data: buildQuery(b) });
  let lastErr: unknown = null;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await limiter.schedule(() =>
          fetchText(
            url,
            { method: 'POST', body, headers: { Accept: 'application/json' } },
            (p) => onProgress?.({ ...p, stage: 'network', host: new URL(url).host }),
            signal,
          ),
        );
        const json = JSON.parse(text) as { remark?: string };
        if (json.remark && /runtime error|out of memory|timed out/i.test(json.remark)) {
          throw new Error(`Overpass: ${json.remark}`);
        }
        await cache.set(key, text);
        return { json, fromCache: false };
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        lastErr = err;
        const retryable = err instanceof HttpError && (err.status === 429 || err.status === 504);
        if (!retryable || attempt === 1) break;
        await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 5000, 15000)));
      }
    }
  }
  throw lastErr ?? new Error('Overpass request failed');
}
