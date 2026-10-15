import { CACHE_DB, CACHE_TTL_MS } from '../core/config';

const STORE = 'responses';

interface Entry {
  key: string;
  value: string;
  savedAt: number;
}

/**
 * Tiny IndexedDB key/value cache for API responses. Every method fails soft: if IndexedDB is
 * unavailable (private mode, quota) the app simply refetches.
 */
export class ResponseCache {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly ttlMs = CACHE_TTL_MS,
    private readonly dbName = CACHE_DB,
    private readonly idb: IDBFactory | null = globalThis.indexedDB ?? null,
  ) {}

  private db(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        if (!this.idb) return resolve(null);
        try {
          const req = this.idb.open(this.dbName, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async get(key: string, now = Date.now()): Promise<string | null> {
    const db = await this.db();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => {
          const e = req.result as Entry | undefined;
          resolve(e && now - e.savedAt < this.ttlMs ? e.value : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async set(key: string, value: string, now = Date.now()): Promise<void> {
    const db = await this.db();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, value, savedAt: now } satisfies Entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.db();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
