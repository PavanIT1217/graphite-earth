import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ResponseCache } from '../src/data/cache';
import { RateLimiter, debounce } from '../src/data/rateLimiter';

describe('RateLimiter', () => {
  it('spaces task starts by the minimum interval and runs them in order', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter(1000, () => clock, async (ms) => {
      sleeps.push(ms);
      clock += ms;
    });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map((i) => limiter.schedule(async () => starts.push(clock) && i)));
    expect(starts).toEqual([0, 1000, 2000]);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('keeps going after a task fails', async () => {
    const limiter = new RateLimiter(0);
    await expect(limiter.schedule(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.schedule(async () => 42)).resolves.toBe(42);
  });
});

describe('debounce', () => {
  it('only fires once after the quiet period', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d('a');
    d('b');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    d('c');
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('c');
    d('d');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('ResponseCache (IndexedDB)', () => {
  it('stores, returns and expires entries', async () => {
    const cache = new ResponseCache(1000, 'test-db');
    await cache.set('k', 'value', 0);
    expect(await cache.get('k', 500)).toBe('value');
    expect(await cache.get('k', 1500)).toBeNull();
    expect(await cache.get('missing')).toBeNull();
    await cache.clear();
    expect(await cache.get('k', 500)).toBeNull();
  });

  it('fails soft without IndexedDB', async () => {
    const cache = new ResponseCache(1000, 'x', null);
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBeNull();
  });
});
