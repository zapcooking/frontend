/**
 * POST /api/shorten – create a short link for a zap.cooking recipe,
 * Nostr long-form article, or Recipe Pack.
 *
 * Body: {
 *   url: string,                           // raw naddr OR a zap.cooking
 *                                          // /r/<naddr>, /reads/<naddr>,
 *                                          // or /pack/<naddr> URL
 *   type?: 'recipe' | 'article' | 'pack',
 *   customSlug?: string,
 *   createdBy?: string
 * }
 * Returns: { success, shortCode?, shortUrl?, error? }
 *
 * Requires Cloudflare KV namespace bound as SHORTLINKS in the Pages project.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { generateShortCode, isValidShortCode, normalizeShortCode } from '$lib/shortlinks/code';
import { parseUrlOrNaddr } from '$lib/shortlinks/parse.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

const SITE_ORIGIN = 'https://zap.cooking';
/** One year. Long enough that a shared link keeps working; short enough to bound KV growth. */
const SHORTLINK_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_CUSTOM_SLUG_LENGTH = 20;
const RESERVED_CODES = new Set([
  'info',
  'api',
  's',
  'r',
  'reads',
  'pack',
  'packs',
  'create',
  'about',
  'login',
  'settings'
]);

function getShortUrl(code: string): string {
  return `${SITE_ORIGIN}/s/${code}`;
}

const NAMESPACE_RE = /^[a-z0-9-_.]{1,30}$/;
const NAMESPACE_TARGET_RE = /^\/(?:note1|nevent1|naddr1|npub1|r\/|reads\/|pack\/)[a-z0-9/?=-]*$/i;

interface NamespacedRecord {
  target: string;
  createdAt: number;
}

/**
 * Mint zap.cooking/<handle>/<code> short links (premium members' posts).
 * The handle must be the author's verified zap.cooking handle: the
 * directory (pantry members + static names) must map namespace →
 * authorPubkey. Targets are restricted to internal note/article paths —
 * this endpoint must never become an open redirector.
 */
async function mintNamespacedShortLink(
  kv: NonNullable<App.Platform['env']>['SHORTLINKS'] | undefined,
  namespace: string,
  authorPubkey: string | undefined,
  rawUrl: string
): Promise<Response> {
  if (!kv) {
    return json({ success: false, error: 'Short links are not configured' }, { status: 503 });
  }
  const handle = namespace.trim().toLowerCase();
  if (!NAMESPACE_RE.test(handle)) {
    return json({ success: false, error: 'Invalid namespace' }, { status: 400 });
  }
  if (!authorPubkey || !/^[0-9a-f]{64}$/.test(authorPubkey)) {
    return json({ success: false, error: 'Missing or invalid authorPubkey' }, { status: 400 });
  }

  // Resolve the target path from a zap.cooking URL (strict host check —
  // the same allowlist parseUrlOrNaddr uses).
  let target: string;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host !== 'zap.cooking' && host !== 'www.zap.cooking') {
      throw new Error('bad host');
    }
    target = u.pathname;
  } catch {
    return json({ success: false, error: 'Invalid URL: use a zap.cooking link' }, { status: 400 });
  }
  if (!NAMESPACE_TARGET_RE.test(target)) {
    return json(
      { success: false, error: 'Unsupported target: must be a note, article, recipe, or pack path' },
      { status: 400 }
    );
  }

  // Verify the handle belongs to this author via the site directory.
  const { loadHandleDirectory } = await import('$lib/handleDirectory.server');
  const names = await loadHandleDirectory();
  if (names[handle] !== authorPubkey) {
    return json(
      { success: false, error: 'This handle does not belong to that author' },
      { status: 403 }
    );
  }

  const code = normalizeShortCode(generateShortCode(6));
  const key = `ns/${handle}/${code}`;
  if (await kv.get(key, 'json')) {
    // Astronomically unlikely (62^6); surface a retryable error rather
    // than looping server-side.
    return json({ success: false, error: 'Code collision — try again' }, { status: 503 });
  }

  const record: NamespacedRecord = { target, createdAt: Date.now() };
  await kv.put(key, JSON.stringify(record), { expirationTtl: SHORTLINK_TTL_SECONDS });

  return json({
    success: true,
    shortCode: code,
    shortUrl: `${SITE_ORIGIN}/${handle}/${code}`
  });
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
  const kv = platform?.env?.SHORTLINKS;
  if (!kv) {
    return json({ success: false, error: 'Short links are not configured' }, { status: 503 });
  }

  // Unauthenticated KV write. Without a cap, anyone can mint short links in
  // a loop and grow the namespace without bound (records are also the only
  // thing standing between a scraper and every naddr we've ever shortened).
  // Caps are per-IP and generous: real users create a handful at a time.
  let ip = '127.0.0.1';
  try {
    ip = getClientAddress();
  } catch {
    // No client address (some runtimes) — fall through to the loopback
    // bucket rather than failing the request.
  }
  const rate = await checkPerIpRateLimit(platform?.env?.NOURISH_FLAGS, {
    ip,
    scope: 'shorten',
    perHour: 10,
    perDay: 50
  });
  if (rate.limited) {
    return json({ success: false, ...rate.body }, { status: 429 });
  }

  let body: {
    url?: string;
    type?: 'recipe' | 'article' | 'pack';
    customSlug?: string;
    createdBy?: string;
    /** Premium vanity minting: codes under zap.cooking/<namespace>/<code>.
     *  Requires authorPubkey, which must match the directory mapping for
     *  the namespace — otherwise anyone could mint links in anyone's
     *  handle namespace. */
    namespace?: string;
    authorPubkey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawUrl = body?.url?.trim();
  if (!rawUrl) {
    return json({ success: false, error: 'Missing or empty url' }, { status: 400 });
  }

  // Namespaced (vanity) minting: zap.cooking/<handle>/<code> redirecting
  // to a note/post URL. Runs its own validation and storage shape, then
  // returns — the legacy /s/<code> path below is untouched.
  if (body.namespace) {
    return mintNamespacedShortLink(kv, body.namespace, body.authorPubkey, rawUrl);
  }

  const parsed = parseUrlOrNaddr(rawUrl);
  if (!parsed) {
    return json(
      {
        success: false,
        error: 'Invalid URL or naddr: use a zap.cooking /r/, /reads/, or /pack/ link, or a raw naddr'
      },
      { status: 400 }
    );
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

  // TTL so an abandoned or abusive link doesn't live in KV forever.
  // A year is far longer than a share link's useful life while still
  // bounding growth. NOTE: records created before this change have no
  // expiry and will persist until swept — see the PR description.
  await kv.put(shortCode, JSON.stringify(record), { expirationTtl: SHORTLINK_TTL_SECONDS });

  return json({
    success: true,
    shortCode,
    shortUrl: getShortUrl(shortCode)
  });
};
