/**
 * Parse zap.cooking URLs or raw naddr into { naddr, type } for shortlinks.
 * Server-only (uses no browser APIs).
 */

import type { ShortLinkType } from './types';

const ZAP_COOKING_ORIGIN = 'https://zap.cooking';
const ZAP_ORIGIN_ALT = /^https?:\/\/(www\.)?zap\.cooking/i;

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
    const origin = u.origin.toLowerCase();
    const path = u.pathname;

    // /r/naddr1... → recipe
    const rMatch = path.match(/^\/r\/(naddr1[a-zA-Z0-9]+)/);
    if (rMatch && (origin.includes('zap.cooking') || ZAP_ORIGIN_ALT.test(u.href))) {
      return { naddr: rMatch[1], type: 'recipe' };
    }

    // /reads/naddr1... → article
    const readsMatch = path.match(/^\/reads\/(naddr1[a-zA-Z0-9]+)/);
    if (readsMatch && (origin.includes('zap.cooking') || ZAP_ORIGIN_ALT.test(u.href))) {
      return { naddr: readsMatch[1], type: 'article' };
    }
  } catch {
    // not a valid URL
  }

  return null;
}

/**
 * Build redirect path from stored naddr and type.
 */
export function redirectPath(naddr: string, type: ShortLinkType): string {
  return type === 'article' ? `/reads/${naddr}` : `/r/${naddr}`;
}
