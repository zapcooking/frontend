import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isCrawler,
  matchRecipeOgRoute,
  renderRecipeOgForCrawler,
  matchNoteOgRoute,
  renderNoteOgForCrawler,
  matchReadsOgRoute,
  renderReadsOgForCrawler,
  matchProfileOgRoute,
  renderProfileOgForCrawler
} from '$lib/recipeOgHtml.server';

/**
 * Log the real server-side error (with stack) instead of letting SvelteKit
 * silently mask it as the generic { message: "Internal Error" } sent to the
 * client. Without this, a render/load throw on any route is invisible in the
 * Cloudflare/Vercel function logs beyond a bare 500. The returned object is
 * what the client receives, so keep it generic — the detail stays server-side.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const err = error as Error | undefined;
  console.error('[handleError]', {
    method: event.request.method,
    path: event.url.pathname,
    status,
    message,
    name: err?.name,
    error: err?.message ?? String(error),
    stack: err?.stack
  });

  return { message: 'Internal Error' };
};

const ENABLE_CORS_ALL = env.ENABLE_CORS_ALL?.toLowerCase() === 'true';
const ALLOW_METHODS = 'GET, POST, PATCH, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, Nostr-Authorization';

const TRUSTED_ORIGINS = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [
      'https://zap.cooking',
      'https://www.zap.cooking',
      'http://localhost:5173',
      'http://localhost:5174',
      'capacitor://localhost'
    ];

function isTrustedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (process.env.NODE_ENV === 'development') return true;
  return TRUSTED_ORIGINS.includes('*') || TRUSTED_ORIGINS.includes(origin);
}

function hasAuthIntent(request: Request): boolean {
  if (request.headers.has('authorization') || request.headers.has('nostr-authorization')) {
    return true;
  }

  const requestedHeaders = request.headers.get('access-control-request-headers');
  if (!requestedHeaders) return false;

  const normalized = requestedHeaders.toLowerCase();
  return normalized.includes('authorization') || normalized.includes('nostr-authorization');
}

function applyVaryOrigin(headers: Headers): void {
  const existingVary = headers.get('Vary');
  if (!existingVary) {
    headers.set('Vary', 'Origin');
    return;
  }

  const varyValues = existingVary.split(',').map((value) => value.trim().toLowerCase());

  if (!varyValues.includes('origin')) {
    headers.set('Vary', `${existingVary}, Origin`);
  }
}

function buildCorsHeaders(origin: string | null, useWildcard: boolean): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Origin': useWildcard ? '*' : (origin ?? ''),
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400'
  });

  if (!useWildcard && origin) {
    applyVaryOrigin(headers);
  }

  return headers;
}

/**
 * Bot-only OG injection. Social crawlers don't run JS, so the client-fetched
 * recipe event never populates the OG tags for them — they'd only ever see the
 * static placeholders. For a crawler UA on a recipe route we resolve the recipe
 * SERVER-SIDE (raw WebSocket, no NDK) and return a minimal standalone document.
 *
 * This deliberately does NOT use a `+page.server.ts` / server `data` dependency:
 * that is what made #454 request `__data.json` against an OOM'd worker and 500.
 * Crawlers issue a single document GET and never request `__data.json`, so this
 * path cannot reintroduce that. Returns null (→ normal SPA resolve) for humans,
 * non-matching routes, or ANY error — it must never throw or 500.
 */
async function maybeRenderBotOg(event: Parameters<Handle>[0]['event']): Promise<Response | null> {
  try {
    if (event.request.method !== 'GET') return null;
    if (!isCrawler(event.request.headers.get('user-agent'))) return null;

    const path = event.url.pathname;
    const recipe = matchRecipeOgRoute(path);
    const note = recipe ? null : matchNoteOgRoute(path);
    const reads = recipe || note ? null : matchReadsOgRoute(path);
    const profile = recipe || note || reads ? null : matchProfileOgRoute(path);
    if (!recipe && !note && !reads && !profile) return null;

    const html = recipe
      ? await renderRecipeOgForCrawler(recipe.prefix, recipe.slug, event.url.origin)
      : note
        ? await renderNoteOgForCrawler(note.slug, event.url.origin)
        : reads
          ? await renderReadsOgForCrawler(reads.slug, event.url.origin)
          : await renderProfileOgForCrawler(profile!.slug, event.url.origin, path);
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // CRITICAL: never let this UA-specific document into a shared cache.
        // Cloudflare's edge cache keys on URL and does NOT honour
        // `Vary: User-Agent`, so a `public` bot document could be replayed to a
        // real browser (serving humans the SPA-less crawler shell) or vice
        // versa. `no-store` keeps the bot path fully separate from the human
        // SPA path. Crawlers re-fetch on each scrape anyway; the fetch is fast.
        'cache-control': 'no-store',
        vary: 'User-Agent'
      }
    });
  } catch (e) {
    console.error('[bot OG] falling through to SPA', e);
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const botOg = await maybeRenderBotOg(event);
  if (botOg) return botOg;

  const isApiRoute = event.url.pathname.startsWith('/api/');
  const origin = event.request.headers.get('origin');
  const trustedOrigin = isTrustedOrigin(origin);
  const authIntent = hasAuthIntent(event.request);
  const useWildcard = !authIntent || process.env.NODE_ENV === 'development';

  // Apply CORS to API routes and all browser-originating requests.
  const shouldApplyCors = ENABLE_CORS_ALL || isApiRoute || Boolean(origin);

  if (event.request.method === 'OPTIONS' && shouldApplyCors) {
    if (authIntent && origin && !trustedOrigin) {
      return new Response(null, { status: 403 });
    }

    const corsHeaders = buildCorsHeaders(origin, useWildcard || !origin);

    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  const response = await resolve(event);

  if (!shouldApplyCors) {
    return response;
  }

  if (authIntent && origin && !trustedOrigin) {
    return response;
  }

  const corsHeaders = buildCorsHeaders(origin, useWildcard || !origin);
  corsHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  if (!useWildcard && origin) {
    applyVaryOrigin(response.headers);
  }

  return response;
};
