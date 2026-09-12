/**
 * Tiny in-process read cache for the request hot path.
 *
 * The gateway is single-process by design (spec section 41), so a Map is
 * enough. Rules for using it:
 *   - only cache reads whose staleness is bounded by the TTL;
 *   - every mutator must call invalidateCache(), otherwise an admin edit would
 *     not take effect until the TTL expires (the TTL is a safety net for
 *     out-of-band DB changes, not the mechanism for consistency).
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, CacheEntry>();

/** Read through the cache: `load` runs at most once per TTL window. */
export function cached<T>(key: string, ttlMs: number, load: () => T): T {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = load();
  entries.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Drop cached entries; call after any write that affects cached reads. */
export function invalidateCache(prefix = ""): void {
  if (!prefix) {
    entries.clear();
    return;
  }
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
