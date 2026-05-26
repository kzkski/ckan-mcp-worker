const MAX_KEY_LENGTH = 200;

export function truncateCacheKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) {
    return key;
  }
  return key.slice(0, MAX_KEY_LENGTH);
}

export type CacheResult<T> = { value: T; cacheHit: boolean };

export async function withCache<T>(
  kv: KVNamespace,
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  const cacheKey = truncateCacheKey(key);
  const cached = await kv.get(cacheKey);

  if (cached !== null) {
    return { value: JSON.parse(cached) as T, cacheHit: true };
  }

  const value = await fetcher();
  await kv.put(cacheKey, JSON.stringify(value), { expirationTtl: ttl });
  return { value, cacheHit: false };
}

export const CACHE_TTL = {
  DATASET_SEARCH: 3600,
  RECORD_SEARCH: 1800,
  DATASET_DETAIL: 3600,
  ORGANIZATIONS: 3600,
} as const;
