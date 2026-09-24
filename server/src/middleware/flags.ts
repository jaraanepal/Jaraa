import type { Store } from "../db/store";

// Feature flags are read from the feature_flags table (seeded OFF for the
// medical modules). Simple in-process cache (30s) to avoid a DB hit per request.
const cache = new Map<string, { value: boolean; at: number }>();
const TTL_MS = 30_000;

export async function featureEnabled(store: Store, key: string): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const flags = await store.listFeatureFlags();
  const f = flags.find((x) => x.key === key);
  const value = !!f?.is_enabled;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export function invalidateFlagCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
