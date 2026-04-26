/**
 * Parse zap.cooking URLs or raw naddr into { naddr, type } for shortlinks.
 * Server-only (uses no browser APIs).
 */

import type { ShortLinkType } from './types';

/**
 * Strict allowlist for the hostname we accept URLs from.
 * Substring matches (e.g. `origin.includes('zap.cooking')`) would also
 * accept `zap.cooking.evil.com` or `api.zap.cooking.attacker.tld`.
 */
function isZapCookingHost(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  return host === 'zap.cooking' || host === 'www.zap.cooking';
}

/**
 * Extract naddr and type from a zap.cooking URL or raw naddr string.
 * Returns null if invalid.
 */
export function parseUrlOrNaddr(input: string): { naddr: string; type: ShortLinkType } | null {
  const s = (input || '').trim();
  if (!s) return null;

  // Raw naddr — treat as recipe by default; could infer from kind if we decode
  if (s.startsWith('naddr1')) {
    return { naddr: s, type: 'recipe' };
  }

  try {
    const u = new URL(s);
    if (!isZapCookingHost(u)) return null;
    const path = u.pathname;

    // /r/naddr1... → recipe
    const rMatch = path.match(/^\/r\/(naddr1[a-zA-Z0-9]+)/);
    if (rMatch) return { naddr: rMatch[1], type: 'recipe' };

    // /reads/naddr1... → article
    const readsMatch = path.match(/^\/reads\/(naddr1[a-zA-Z0-9]+)/);
    if (readsMatch) return { naddr: readsMatch[1], type: 'article' };

    // /pack/naddr1... → recipe pack
    const packMatch = path.match(/^\/pack\/(naddr1[a-zA-Z0-9]+)/);
    if (packMatch) return { naddr: packMatch[1], type: 'pack' };
  } catch {
    // not a valid URL
  }

  return null;
}

/**
 * Build redirect path from stored naddr and type.
 */
export function redirectPath(naddr: string, type: ShortLinkType): string {
  if (type === 'article') return `/reads/${naddr}`;
  if (type === 'pack') return `/pack/${naddr}`;
  return `/r/${naddr}`;
}
