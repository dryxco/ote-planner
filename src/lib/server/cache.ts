// Tiny in-memory TTL cache (per server process) to avoid hammering calendar providers.
import { shared } from "./shared";

interface Entry<T> {
  at: number;
  value: Promise<T>;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const entries = shared("cache.entries", () => new Map<string, Entry<unknown>>());

/**
 * Return a cached value for `key` (fresh for 60s) or compute it. Concurrent callers share
 * one in-flight request. Rejections are cached too, so a broken account is not retried
 * on every poll; reconnecting an account clears its entries.
 */
export function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = compute();
  entries.set(key, { at: now, value });
  if (entries.size > MAX_ENTRIES) {
    for (const [k, e] of entries) {
      if (now - e.at >= TTL_MS || entries.size > MAX_ENTRIES) entries.delete(k);
      if (entries.size <= MAX_ENTRIES / 2) break;
    }
  }
  return value;
}

/** Drop every entry whose key starts with `prefix` (e.g. `google:<accountId>:`). */
export function invalidate(prefix: string): void {
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}
