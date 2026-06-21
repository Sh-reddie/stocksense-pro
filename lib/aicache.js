/**
 * StockSense Pro — AI response cache (pure core)
 * --------------------------------------------------------------------------
 * The app burns OpenRouter's free-tier quota (~50/day) re-analysing the same
 * symbols. analyseHolding already caches results in localStorage for 6h; this
 * module extracts that cache's pure logic so it can be unit-tested and reused
 * for the watchlist analyzer (analyseWatchStock), which previously re-called
 * the model on every run.
 *
 * Pure helpers (no DOM / no storage):
 *   entryKey(symbol, ns)   → localStorage key, namespaced
 *   serialize(data, now)   → string to store
 *   parseEntry(raw)        → { ts, data } | null
 *   isFresh(entry, ttl, now) → boolean
 *   readFresh(raw, ttl, now) → data | null   (parse + freshness in one call)
 *
 * Default TTL matches the app: 6 hours.
 * --------------------------------------------------------------------------
 */

export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * localStorage key for a cached symbol. ns '' keeps the legacy holding key
 * (`ss_ai_cache_<SYM>`); a namespace gives an isolated bucket
 * (`ss_<ns>_cache_<SYM>`) so watchlist and holding analyses never collide.
 */
export function entryKey(symbol, ns = '') {
  const sym = String(symbol == null ? '' : symbol);
  return ns ? `ss_${ns}_cache_${sym}` : `ss_ai_cache_${sym}`;
}

/** Serialize a cache entry. */
export function serialize(data, now = Date.now()) {
  return JSON.stringify({ ts: now, data });
}

/** Parse a stored entry. Returns { ts, data } or null if missing/corrupt. */
export function parseEntry(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || typeof o.ts !== 'number') return null;
    return { ts: o.ts, data: o.data };
  } catch (e) {
    return null;
  }
}

/** True if the entry is within ttlMs of now. */
export function isFresh(entry, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  if (!entry || typeof entry.ts !== 'number') return false;
  return now - entry.ts <= ttlMs;
}

/**
 * Parse + freshness in one step. Returns the cached data when present and
 * fresh, otherwise null (so the caller knows to re-fetch). A null return on a
 * stale entry is the signal to delete the key.
 */
export function readFresh(raw, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  const entry = parseEntry(raw);
  if (!entry) return null;
  return isFresh(entry, ttlMs, now) ? entry.data : null;
}

if (typeof window !== 'undefined') {
  window.SSAICache = { DEFAULT_TTL_MS, entryKey, serialize, parseEntry, isFresh, readFresh };
}
