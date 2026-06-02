interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface TtlCacheOptions {
  defaultTtlMs: number;
  maxEntries: number;
}

export function createTtlCache<T>(options: TtlCacheOptions) {
  const store = new Map<string, CacheEntry<T>>();

  function getOrSet(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = store.get(key);
    if (entry && entry.expiresAt > now) {
      return Promise.resolve(entry.value);
    }

    const promise = load();
    store.set(key, { value: promise as unknown as T, expiresAt: now + options.defaultTtlMs });

    promise.then(
      (value) => {
        store.set(key, { value, expiresAt: now + options.defaultTtlMs });
      },
      () => {
        store.delete(key);
      },
    );

    return promise;
  }

  return { getOrSet };
}
