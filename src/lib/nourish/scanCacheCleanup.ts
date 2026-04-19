/**
 * One-shot cleanup for legacy Nourish scan cache entries.
 *
 * PR 3 commit 6 dropped scan caching (privacy + staleness). Existing
 * browsers may still have `nourish_scan_*` localStorage entries from
 * the old caching implementation. This runs once per browser (gated
 * by a sentinel flag), via requestIdleCallback so it doesn't block
 * initial render. If localStorage is unavailable or the sentinel
 * write fails, the next page load retries.
 */

import { browser } from '$app/environment';

const SENTINEL_KEY = 'nourish_scan_cleanup_done_v1';
const LEGACY_KEY_PREFIX = 'nourish_scan_';

type IdleScheduler = (cb: () => void) => void;

function getScheduler(): IdleScheduler {
  if (browser && typeof (window as any).requestIdleCallback === 'function') {
    return (cb) => (window as any).requestIdleCallback(cb);
  }
  // Fallback for browsers without requestIdleCallback (Safari pre-16).
  // setTimeout with a minimal delay still gets us off the critical
  // rendering path for initial paint.
  return (cb) => setTimeout(cb, 1);
}

export function cleanupLegacyScanCache(): void {
  if (!browser) return;

  try {
    if (localStorage.getItem(SENTINEL_KEY) === '1') return;
  } catch {
    return; // localStorage unavailable — nothing to clean
  }

  const schedule = getScheduler();
  schedule(() => {
    try {
      const toDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LEGACY_KEY_PREFIX)) {
          toDelete.push(key);
        }
      }
      for (const key of toDelete) {
        localStorage.removeItem(key);
      }
      localStorage.setItem(SENTINEL_KEY, '1');
    } catch {
      // Quota exhausted or permission denied — try again next boot.
    }
  });
}
