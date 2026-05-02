import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const ENABLE_CORS_ALL = env.ENABLE_CORS_ALL?.toLowerCase() === 'true';
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, Nostr-Authorization';

const TRUSTED_ORIGINS = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [
      'https://zap.cooking',
      'https://www.zap.cooking',
      'http://localhost:5173',
      'http://localhost:5174',
      'capacitor://localhost',
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

  const varyValues = existingVary
    .split(',')
    .map(value => value.trim().toLowerCase());

  if (!varyValues.includes('origin')) {
    headers.set('Vary', `${existingVary}, Origin`);
  }
}

function buildCorsHeaders(origin: string | null, useWildcard: boolean): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Origin': useWildcard ? '*' : (origin ?? ''),
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
  });

  if (!useWildcard && origin) {
    applyVaryOrigin(headers);
  }

  return headers;
}

export const handle: Handle = async ({ event, resolve }) => {
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
