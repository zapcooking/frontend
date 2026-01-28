/**
 * GET /api/stats/:code – return analytics for a short link.
 * Returns: { shortCode, naddr, type, createdAt, clicks, createdBy? } or 404.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { normalizeShortCode } from '$lib/shortlinks/code';

export const GET: RequestHandler = async ({ params, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  if (!kv) {
    return json({ error: 'Short links are not configured' }, { status: 503 });
  }

  const code = params?.code?.trim();
  if (!code) {
    return json({ error: 'Missing code' }, { status: 400 });
  }

  const key = normalizeShortCode(code);
  const record = await kv.get(key, 'json') as ShortenedURL | null;
  if (!record) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  return json({
    shortCode: record.shortCode,
    naddr: record.naddr,
    type: record.type,
    createdAt: record.createdAt,
    clicks: record.clicks ?? 0,
    createdBy: record.createdBy
  });
};
