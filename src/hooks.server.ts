import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  matchRecipeOgRoute,
  resolveRecipeOgMeta,
  matchNoteOgRoute,
  resolveNoteOgMeta,
  matchReadsOgRoute,
  resolveReadsOgMeta,
  matchProfileOgRoute,
  resolveProfileOgMeta,
  buildOgTagBlock,
  createOgPageTransformer
} from '$lib/recipeOgHtml.server';
import type { RecipeOgMeta } from '$lib/recipeOgMeta';

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
 * Resolve OG meta for routes that derive their tags from a client-fetched
 * Nostr event. During SSR that event is null, so the page's own head emits
 * static placeholders; the meta resolved here (raw WebSocket, no NDK) is
 * injected into the real page for EVERY visitor — there is deliberately no
 * User-Agent gating (see the comment in `handle`).
 *
 * This deliberately does NOT use a `+page.server.ts` / server `data` dependency:
 * that is what made #454 request `__data.json` against an OOM'd worker and 500.
 * Resolution stays in this hook, on the single document GET, so this path
 * cannot reintroduce that. Returns null (→ page served with its own tags) for
 * non-matching routes, non-GET requests, or ANY error — it must never throw
 * or 500.
 */
async function resolveOgMeta(
  event: Parameters<Handle>[0]['event']
): Promise<{ meta: RecipeOgMeta; canonicalUrl: string } | null> {
  try {
    if (event.request.method !== 'GET') return null;

    const path = event.url.pathname;
    const origin = event.url.origin;

    const recipe = matchRecipeOgRoute(path);
    if (recipe) {
      return {
        meta: await resolveRecipeOgMeta(recipe.slug),
        canonicalUrl: `${origin}/${recipe.prefix}/${recipe.slug}`
      };
    }

    const note = matchNoteOgRoute(path);
    if (note) {
      return {
        meta: await resolveNoteOgMeta(note.slug),
        canonicalUrl: `${origin}/${note.slug}`
      };
    }

    const reads = matchReadsOgRoute(path);
    if (reads) {
      return {
        meta: await resolveReadsOgMeta(reads.slug),
        canonicalUrl: `${origin}/reads/${reads.slug}`
      };
    }

    const profile = matchProfileOgRoute(path);
    if (profile) {
      return {
        meta: await resolveProfileOgMeta(profile.slug),
        canonicalUrl: `${origin}${path}`
      };
    }

    return null;
  } catch (e) {
    // Must never break page delivery — fall through to the page's own tags.
    console.error('[og] resolve failed, serving page tags', e);
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  // Open Graph tags are injected into the REAL page for EVERY visitor, not
  // into a separate document for user-agents we recognize.
  //
  // This used to be gated on a crawler UA allowlist. That silently failed for
  // the audience that matters most here: Nostr clients (Amethyst, Primal,
  // Damus, …) aren't on any such list, and many link-preview fetchers send a
  // generic UA or none at all — indistinguishable from a browser. They all got
  // the SSR placeholder card ("Recipe", the logo graphic), because these pages
  // derive their OG from a client-fetched event.
  //
  // UA sniffing cannot be patched into correctness, so it's gone: one document,
  // one set of tags, everyone. That also means no `Vary: User-Agent` (which
  // Cloudflare ignores anyway) and no `no-store`, so these pages stay
  // edge-cacheable — and the crawler and human paths can no longer drift.
  //
  // This does NOT reintroduce #454: there is still no `+page.server.ts` and no
  // `__data.json` dependency. The resolution happens here in the hook exactly
  // as it did before.
  const og = await resolveOgMeta(event);
  // buildOgTagBlock probes the image over the network for width/height, so it
  // can throw for reasons that have nothing to do with this page (host down,
  // DNS, a runtime that blocks the fetch). Unguarded, that would take the
  // whole request down with it — a 500 on a page that renders perfectly well
  // without dimension tags. Degrade to the page's own tags instead.
  let ogTagBlock: string | null = null;
  if (og) {
    try {
      ogTagBlock = await buildOgTagBlock(og.meta, og.canonicalUrl);
    } catch (e) {
      console.error('[og] tag build failed, serving page tags', e);
    }
  }

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

  const response = ogTagBlock
    ? await resolve(event, { transformPageChunk: createOgPageTransformer(ogTagBlock) })
    : await resolve(event);

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
