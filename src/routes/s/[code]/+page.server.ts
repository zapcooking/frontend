/**
 * GET /s/:code – redirect short link to full recipe or article URL.
 * This handles browser navigation (QR code scans, link clicks).
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { normalizeShortCode } from '$lib/shortlinks/code';
import { redirectPath } from '$lib/shortlinks/parse.server';

export const load: PageServerLoad = async ({ params, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  
  console.log('[ShortLink] Redirect request for code:', params?.code);
  console.log('[ShortLink] KV available:', !!kv);
  
  if (!kv) {
    // KV not configured - redirect to home
    console.log('[ShortLink] KV not configured, redirecting to /');
    throw redirect(302, '/');
  }

  const code = params?.code?.trim();
  if (!code) {
    console.log('[ShortLink] No code provided, redirecting to /recent');
    throw redirect(302, '/recent');
  }

  const key = normalizeShortCode(code);
  console.log('[ShortLink] Looking up key:', key);
  
  const record = await kv.get(key, 'json') as ShortenedURL | null;
  console.log('[ShortLink] Record found:', !!record, record ? `naddr: ${record.naddr?.slice(0, 20)}...` : 'null');
  
  if (!record) {
    // Short link not found - redirect to recent recipes
    console.log('[ShortLink] Record not found, redirecting to /recent');
    throw redirect(302, '/recent');
  }

  // Increment click count (best-effort; don't block redirect on write failure)
  const updated: ShortenedURL = {
    ...record,
    clicks: (record.clicks ?? 0) + 1
  };
  kv.put(key, JSON.stringify(updated)).catch(() => {});

  // Redirect to the actual recipe or article
  const path = redirectPath(record.naddr, record.type);
  throw redirect(302, path);
};
