export function cachedFn<T>(fn: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let cached: T;
  let populated = false;
  let expiresAt = 0;

  return async () => {
    const now = Date.now();
    if (populated && now < expiresAt) return cached;
    cached = await fn();
    populated = true;
    expiresAt = now + ttlMs;
    return cached;
  };
}
