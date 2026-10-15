import { NOMINATIM_MIN_INTERVAL_MS, NOMINATIM_URL } from '../core/config';
import type { BBox } from '../geo/projection';
import type { ResponseCache } from './cache';
import { fetchText } from './http';
import { RateLimiter } from './rateLimiter';

export interface Place {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
  bbox: BBox | null;
}

interface NominatimResult {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  boundingbox?: [string, string, string, string];
}

const limiter = new RateLimiter(NOMINATIM_MIN_INTERVAL_MS);

export function parseNominatim(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  return (json as NominatimResult[]).map((r) => {
    const [first, ...rest] = r.display_name.split(', ');
    const bb = r.boundingbox?.map(Number);
    return {
      id: `${r.osm_type}/${r.osm_id}`,
      name: r.name || first,
      detail: (r.name && r.name !== first ? [first, ...rest] : rest).slice(0, 3).join(', '),
      lat: Number(r.lat),
      lng: Number(r.lon),
      bbox: bb && bb.every(Number.isFinite) ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null,
    };
  });
}

/** Free-text place search. Results are cached; requests are rate-limited to 1/s. */
export async function searchPlaces(query: string, cache: ResponseCache, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '0' });
  params.set('accept-language', navigator.language || 'en');
  const url = `${NOMINATIM_URL}?${params}`;
  const key = `nominatim:${params}`;
  const cached = await cache.get(key);
  if (cached) return parseNominatim(JSON.parse(cached));
  const text = await limiter.schedule(() => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return fetchText(url, { headers: { Accept: 'application/json' } }, undefined, signal);
  });
  await cache.set(key, text);
  return parseNominatim(JSON.parse(text));
}
