/**
 * POST /api/shorten – create a short link for a zap.cooking recipe or Nostr long-form article.
 * Body: { url: string (naddr or zap.cooking URL), type?: 'recipe' | 'article', customSlug?: string, createdBy?: string }
 * Returns: { success, shortCode?, shortUrl?, error? }
 *
 * Requires Cloudflare KV namespace bound as SHORTLINKS in the Pages project.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { generateShortCode, isValidShortCode, normalizeShortCode } from '$lib/shortlinks/code';
import { parseUrlOrNaddr } from '$lib/shortlinks/parse.server';

const SITE_ORIGIN = 'https://zap.cooking';
const MAX_CUSTOM_SLUG_LENGTH = 20;
const RESERVED_CODES = new Set(['info', 'api', 's', 'r', 'reads', 'create', 'about', 'login', 'settings']);

function getShortUrl(code: string): string {
  return `${SITE_ORIGIN}/s/${code}`;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  if (!kv) {
    return json({ success: false, error: 'Short links are not configured' }, { status: 503 });
  }

  let body: { url?: string; type?: 'recipe' | 'article'; customSlug?: string; createdBy?: string };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return json({ success: false, error: 'Missing or empty url' }, { status: 400 });
  }

  const parsed = parseUrlOrNaddr(rawUrl);
  if (!parsed) {
    return json({ success: false, error: 'Invalid URL or naddr: use a zap.cooking /r/ or /reads/ link, or a raw naddr' }, { status: 400 });
  }

  const { naddr, type } = parsed;
  const createdBy = body.createdBy?.trim() || undefined;

  let shortCode: string;

  if (body.customSlug?.trim()) {
    const slug = body.customSlug.trim().toLowerCase();
    if (slug.length > MAX_CUSTOM_SLUG_LENGTH) {
      return json({ success: false, error: `Custom slug must be at most ${MAX_CUSTOM_SLUG_LENGTH} characters` }, { status: 400 });
    }
    if (!isValidShortCode(slug)) {
      return json({ success: false, error: 'Custom slug must be 4–12 alphanumeric characters' }, { status: 400 });
    }
    if (RESERVED_CODES.has(slug)) {
      return json({ success: false, error: 'That slug is reserved' }, { status: 400 });
    }
    shortCode = normalizeShortCode(slug);
    const existing = await kv.get(shortCode, 'json') as ShortenedURL | null;
    if (existing) {
      return json({ success: false, error: 'This custom slug is already in use' }, { status: 409 });
    }
  } else {
    shortCode = normalizeShortCode(generateShortCode(6));
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      const existing = await kv.get(shortCode, 'json') as ShortenedURL | null;
      if (!existing) break;
      shortCode = normalizeShortCode(generateShortCode(6));
      attempts++;
    }
    if (attempts >= maxAttempts) {
      return json({ success: false, error: 'Could not generate a unique short code; try again' }, { status: 503 });
    }
  }

  const record: ShortenedURL = {
    shortCode,
    naddr,
    createdAt: Date.now(),
    createdBy,
    clicks: 0,
    type
  };

  await kv.put(shortCode, JSON.stringify(record));

  return json({
    success: true,
    shortCode,
    shortUrl: getShortUrl(shortCode)
  });
};
