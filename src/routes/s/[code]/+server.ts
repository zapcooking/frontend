/**
 * GET /s/:code – redirect short link to full recipe or article URL.
 * Looks up code in KV, increments click count, returns 302 to /r/:naddr or /reads/:naddr.
 */

import { redirect, type RequestHandler } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { normalizeShortCode } from '$lib/shortlinks/code';
import { redirectPath } from '$lib/shortlinks/parse.server';

export const GET: RequestHandler = async ({ params, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  if (!kv) {
    return new Response('Short links are not configured', { status: 503 });
  }

  const code = params?.code?.trim();
  if (!code) {
    throw redirect(302, '/recent');
  }

  const key = normalizeShortCode(code);
  const record = await kv.get(key, 'json') as ShortenedURL | null;
  if (!record) {
    throw redirect(302, '/recent');
  }

  // Increment click count (best-effort; don't block redirect on write failure)
  const updated: ShortenedURL = {
    ...record,
    clicks: (record.clicks ?? 0) + 1
  };
  kv.put(key, JSON.stringify(updated)).catch(() => {});

  const path = redirectPath(record.naddr, record.type);
  throw redirect(302, path);
};
