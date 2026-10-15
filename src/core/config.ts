/** Identifies the app to OSM services (sent as User-Agent where the platform allows it). */
export const APP_NAME = 'GraphiteEarth';
export const APP_VERSION = '1.0.0';
export const APP_URL = 'https://github.com/PavanIT1217/graphite-earth';
export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${APP_URL})`;

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Tried in order; the first is the main public instance. */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Nominatim usage policy: at most 1 request per second. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;
/** Be gentle with Overpass: one query at a time, spaced out. */
export const OVERPASS_MIN_INTERVAL_MS = 2000;
export const SEARCH_DEBOUNCE_MS = 650;

/** Maximum area loaded at once, square metres. */
export const MAX_AREA_M2 = 1_500_000;
export const DEFAULT_AREA_M2 = 1_000_000;
export const MIN_AREA_M2 = 250_000;

export const CACHE_DB = 'graphite-earth';
export const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
export const QUERY_VERSION = 3;

export const METRES_PER_LEVEL = 3.2;

export interface Preset {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Initial camera azimuth (degrees, 0 = looking north). */
  heading: number;
}

export const PRESETS: Preset[] = [
  { id: 'manhattan', name: 'Lower Manhattan', lat: 40.7075, lng: -74.0113, heading: 30 },
  { id: 'paris', name: 'Paris · Île de la Cité', lat: 48.8547, lng: 2.3477, heading: 300 },
  { id: 'shibuya', name: 'Tokyo · Shibuya', lat: 35.6595, lng: 139.7005, heading: 200 },
  { id: 'vizag', name: 'Visakhapatnam · RK Beach', lat: 17.7142, lng: 83.3236, heading: 250 },
];
