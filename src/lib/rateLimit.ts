/**
 * Client-side per-bucket rate limiter backed by localStorage.
 *
 * First-line UX guard for anon-accessible actions (e.g. the landing-page
 * AI import hero). Trivially bypassable — a user can clear site data or
 * open incognito to reset — so the server-side per-IP cap in
 * `$lib/ipRateLimit.server.ts` is the real enforcement. This helper
 * exists to give honest callers a clear "try again later" signal
 * without round-tripping to the server, and to slow casual abuse.
 *
 * Stored shape per bucket:
 *   rate-limit:<bucket> → JSON { hits: number[], version: 1 }
 * where `hits` is a list of epoch-ms timestamps trimmed to the window.
 */

import { browser } from '$app/environment';

const STORAGE_PREFIX = 'rate-limit:';
const STORAGE_VERSION = 1;

export interface RateLimitOptions {
  /** Logical bucket name (e.g. `anon-url-import`). */
  bucket: string;
  /** Max hits allowed within the rolling window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  /**
   * Remaining hits currently available in the window. `checkRateLimit`
   * is non-destructive, so this is the capacity *before* the caller
   * records the next hit — a subsequent `recordHit` will consume one.
   */
  remaining: number;
  /** Epoch-ms at which the bucket next frees up a slot. 0 if allowed. */
  retryAt: number;
}

interface StoredBucket {
  version: number;
  hits: number[];
}

function loadBucket(key: string): StoredBucket {
  if (!browser) return { version: STORAGE_VERSION, hits: [] };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { version: STORAGE_VERSION, hits: [] };
    const parsed = JSON.parse(raw) as StoredBucket;
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.hits)) {
      return { version: STORAGE_VERSION, hits: [] };
    }
    return parsed;
  } catch {
    return { version: STORAGE_VERSION, hits: [] };
  }
}

function saveBucket(key: string, bucket: StoredBucket): void {
  if (!browser) return;
  try {
    localStorage.setItem(key, JSON.stringify(bucket));
  } catch {
    // Quota or access errors — silently drop. Rate-limit is best-effort.
  }
}

/**
 * Non-destructive check: returns whether the next hit would be allowed,
 * without recording it. Pair with `recordHit` after a successful action.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitCheck {
  const now = Date.now();
  const key = STORAGE_PREFIX + opts.bucket;
  const bucket = loadBucket(key);
  const cutoff = now - opts.windowMs;
  const windowHits = bucket.hits.filter((t) => t > cutoff);
  const remaining = Math.max(0, opts.limit - windowHits.length);
  if (windowHits.length < opts.limit) {
    return { allowed: true, remaining, retryAt: 0 };
  }
  // Bucket full — retry when the oldest in-window hit ages out.
  const oldest = Math.min(...windowHits);
  return {
    allowed: false,
    remaining: 0,
    retryAt: oldest + opts.windowMs
  };
}

/**
 * Record a hit against the bucket. Call AFTER the action succeeds so
 * users aren't penalized for network errors or server-side rejections.
 */
export function recordHit(opts: RateLimitOptions): void {
  const now = Date.now();
  const key = STORAGE_PREFIX + opts.bucket;
  const bucket = loadBucket(key);
  const cutoff = now - opts.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  bucket.hits.push(now);
  saveBucket(key, bucket);
}
