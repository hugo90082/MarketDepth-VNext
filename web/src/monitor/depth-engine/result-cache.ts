export type SharedResult<T> = { value: T; cached: boolean };

export function createSharedResultCache<T>({
  ttlMs,
  now = Date.now,
}: {
  ttlMs: number;
  now?: () => number;
}) {
  const cache = new Map<string, { value: T; expiresAt: number }>();
  const inflight = new Map<string, Promise<SharedResult<T>>>();

  const prune = () => {
    const measuredAt = now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= measuredAt) cache.delete(key);
    }
  };

  return {
    async load(
      key: string,
      work: () => Promise<T>,
      cacheKey: (value: T) => string = () => key,
    ): Promise<SharedResult<T>> {
      prune();
      const cached = cache.get(key);
      if (cached) return { value: cached.value, cached: true };
      const existing = inflight.get(key);
      if (existing) return existing;
      const task = work()
        .then((value) => {
          cache.set(cacheKey(value), { value, expiresAt: now() + ttlMs });
          return { value, cached: false };
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },
    prune,
    clear: () => {
      cache.clear();
      inflight.clear();
    },
  };
}
