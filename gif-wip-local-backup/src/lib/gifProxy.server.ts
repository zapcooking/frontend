import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Server-side proxy for gifs.nostr.build's GIF search API (`/search` and
 * `/suggest`), serving `/api/gif-search` and `/api/gif-suggest`.
 *
 * The zap cooking API key stays here on the server: gifs.nostr.build's
 * integration guide reserves Authorization headers for server and native
 * clients — a web app is identified by its Origin, and a key shipped in the
 * browser bundle is public. (Sidecar, the reference implementation, sends the
 * key from the client because extension origins are per-install random.)
 */

const GIFS_API_BASE = 'https://gifs.nostr.build/api/v1';
const QUERY_MAX = 500;
const LIMIT_MAX = 50;
// The API rejects an offset past 199 (a query's list is at most 200 long).
const OFFSET_MAX = 199;
const SUGGEST_LIMIT = 6;
const UPSTREAM_TIMEOUT_MS = 8000;

export async function proxyGifRequest(
  endpoint: 'search' | 'suggest',
  params: URLSearchParams
): Promise<Response> {
  const key = env.GIFS_NOSTR_BUILD_API_KEY;
  if (!key) throw error(503, 'GIF search is not configured');

  const q = (params.get('q') || '').trim().slice(0, QUERY_MAX);
  if (!q) throw error(400, 'Missing search term');

  const upstream = new URLSearchParams({ q, safe: '1' });
  if (endpoint === 'search') {
    const limit = Math.min(Math.max(Math.floor(Number(params.get('limit'))) || 24, 1), LIMIT_MAX);
    const offset = Math.min(Math.max(Math.floor(Number(params.get('offset'))) || 0, 0), OFFSET_MAX);
    upstream.set('limit', String(limit));
    upstream.set('offset', String(offset));
  } else {
    upstream.set('limit', String(SUGGEST_LIMIT));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GIFS_API_BASE}/${endpoint}?${upstream}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal
    });
  } catch {
    throw error(502, 'GIF search is unavailable');
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();
  if (!res.ok) {
    // Pass the upstream status and body through: the picker maps 401/403
    // (refused key), 429 (rate limit) and everything else to its own
    // messages, so those must not be flattened into a 502 here.
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
  // Chip queries repeat heavily; a short edge cache keeps the upstream
  // rate limits for the interesting cases.
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
    }
  });
}
