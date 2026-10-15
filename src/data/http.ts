import { USER_AGENT } from '../core/config';
import { isNative } from '../platform/native';

export interface ProgressInfo {
  loaded: number;
  total: number | null;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/**
 * fetch() wrapper that streams the body to report download progress.
 *
 * Browsers do not let pages set User-Agent; there the Referer header identifies the app, as the
 * Nominatim/Overpass policies allow. In the native apps (CapacitorHttp) we send a real User-Agent.
 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  onProgress?: (p: ProgressInfo) => void,
  signal?: AbortSignal,
): Promise<string> {
  const headers = new Headers(init.headers);
  if (isNative()) headers.set('User-Agent', USER_AGENT);
  const res = await fetch(url, { ...init, headers, signal, referrerPolicy: 'strict-origin-when-cross-origin' });
  if (!res.ok) {
    const ra = res.headers.get('Retry-After');
    const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : null;
    throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`, retryAfterMs);
  }
  const total = Number(res.headers.get('Content-Length')) || null;
  if (!res.body || !onProgress) return res.text();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let loaded = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onProgress({ loaded, total });
  }
  return text + decoder.decode();
}
