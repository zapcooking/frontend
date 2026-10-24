import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

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

/**
 * Per-IP caps on requests that reach the upstream (one shared bucket for
 * search + suggest). Repeat queries are answered by the edge cache before
 * this code runs, so only misses count. Typing is debounced (350 ms) and a
 * query pages at most 9 times, so these sit far above real use while
 * keeping a third party from burning the shared key's upstream limits.
 */
export const GIF_PER_HOUR = 300;
export const GIF_PER_DAY = 1500;

type RateLimitKV = Parameters<typeof checkPerIpRateLimit>[0];

export interface GifProxyContext {
  /** The caller's IP (SvelteKit getClientAddress). */
  ip: string;
  /** KV namespace for the per-IP counters; missing = unmetered (logged). */
  kv: RateLimitKV;
}

export async function proxyGifRequest(
  endpoint: 'search' | 'suggest',
  params: URLSearchParams,
  ctx: GifProxyContext
): Promise<Response> {
  const key = env.GIFS_NOSTR_BUILD_API_KEY;
  if (!key) throw error(503, 'GIF search is not configured');

  const q = (params.get('q') || '').trim().slice(0, QUERY_MAX);
  if (!q) throw error(400, 'Missing search term');

  if (!ctx.kv) console.warn('[gif-proxy] rate-limit KV not bound — GIF search is unmetered');
  const rl = await checkPerIpRateLimit(ctx.kv, {
    ip: ctx.ip,
    scope: 'gif-search',
    perHour: GIF_PER_HOUR,
    perDay: GIF_PER_DAY
  });
  if (rl.limited) {
    // The picker maps 429 to "Too many searches. Try again in a minute."
    return new Response(JSON.stringify(rl.body), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(rl.body.retryAfter)
      }
    });
  }

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
