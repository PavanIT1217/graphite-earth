/**
 * Serialises calls and enforces a minimum gap between the *start* of consecutive calls.
 * Used to honour the Nominatim (1 req/s) and Overpass usage policies.
 */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private last = -Infinity;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      return task();
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

/** Classic trailing-edge debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...args: A) => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, ms);
  };
  d.cancel = () => {
    if (t !== undefined) clearTimeout(t);
    t = undefined;
  };
  return d;
}
