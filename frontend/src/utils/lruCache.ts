/**
 * Small insertion-order LRU cache.
 *
 * `get` refreshes an entry's recency, `set` inserts/refreshes without trimming;
 * callers must call `trim()` afterwards and release any external resources
 * (blob URLs etc.) for exactly the returned, dropped entries. Keeping trimming
 * explicit lets call sites revoke object URLs instead of leaking them.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Read without refreshing recency (used by eviction scans). */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  /** Drop least-recently-used entries until at most ``maxSize`` remain. */
  trim(): Array<[K, V]> {
    const dropped: Array<[K, V]> = [];
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const key = oldest.value;
      const value = this.map.get(key) as V;
      this.map.delete(key);
      dropped.push([key, value]);
    }
    return dropped;
  }
}
