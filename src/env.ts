export type Env = {
  CACHE_KV: KVNamespace;
  LOG_DB: D1Database;
  RATE_LIMITER: {
    limit: (opts: { key: string }) => Promise<{ success: boolean }>;
  };
  ADMIN_TOKEN: string;
  LOG_HASH_SALT?: string;
};
