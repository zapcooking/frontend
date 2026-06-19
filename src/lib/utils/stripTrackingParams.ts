import { browser } from '$app/environment';
import { goto } from '$app/navigation';

// Common analytics/referral params that should never be part of a canonical
// URL. Kept in sync with the list the deleted +page.server.ts loads used.
const TRACKING_PARAMS = [
  'fbclid',
  'gclid',
  'msclkid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'source'
];

/**
 * Strip tracking query params (utm_*, fbclid, gclid, ...) from the current URL.
 *
 * Restores the canonicalization the removed OG-only server loads used to do via
 * a 301 redirect. Runs only in the browser and uses `replaceState` so the clean
 * URL does not add a history entry. No-op when there are no tracking params.
 */
export function stripTrackingParams(currentUrl: URL): void {
  if (!browser) return;

  const url = new URL(currentUrl);
  let changed = false;
  for (const param of TRACKING_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }

  if (changed) {
    goto(url.pathname + url.search + url.hash, {
      replaceState: true,
      keepFocus: true,
      noScroll: true
    });
  }
}
