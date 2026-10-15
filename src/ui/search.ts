import { SEARCH_DEBOUNCE_MS } from '../core/config';
import type { ResponseCache } from '../data/cache';
import { type Place, searchPlaces } from '../data/nominatim';
import { debounce } from '../data/rateLimiter';
import { byId } from './dom';

/**
 * Accessible combobox for Nominatim search. Typing is debounced (and the client is rate-limited
 * to one request per second), and only the latest query's results are shown.
 */
export function initSearch(cache: ResponseCache, onPick: (p: Place) => void): void {
  const form = byId<HTMLFormElement>('search-form');
  const input = byId<HTMLInputElement>('q');
  const list = byId<HTMLUListElement>('results');
  let places: Place[] = [];
  let active = -1;
  let controller: AbortController | null = null;
  let seq = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const render = (message?: string) => {
    list.replaceChildren();
    if (message) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = message;
      list.append(li);
    }
    places.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `result-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = p.detail;
      li.append(name, detail);
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? `result-${active}` : '');
  };

  const pick = (i: number) => {
    const p = places[i];
    if (!p) return;
    input.value = p.name;
    close();
    input.blur();
    onPick(p);
  };

  const run = async (q: string) => {
    const mySeq = ++seq;
    controller?.abort();
    controller = new AbortController();
    if (q.trim().length < 3) {
      close();
      return;
    }
    try {
      const res = await searchPlaces(q, cache, controller.signal);
      if (mySeq !== seq) return;
      places = res;
      active = res.length ? 0 : -1;
      render(res.length ? undefined : 'No places found');
    } catch (err) {
      if ((err as Error).name === 'AbortError' || mySeq !== seq) return;
      places = [];
      render('Search is unavailable right now — try again shortly.');
    }
  };
  const debounced = debounce(run, SEARCH_DEBOUNCE_MS);

  input.addEventListener('input', () => debounced(input.value));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !places.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : places.length - 1)) % places.length;
      render();
    } else if (e.key === 'Escape') {
      close();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!list.hidden && active >= 0) pick(active);
    else {
      debounced.cancel();
      void run(input.value);
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
