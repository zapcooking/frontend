/**
 * Server-side hooks for SvelteKit
 * Handles CORS headers for API endpoints and optionally all responses
 * 
 * Environment Variables:
 * - ENABLE_CORS_ALL: Set to 'true' to enable CORS on all routes (default: false, only API routes)
 * - CORS_ORIGIN: Comma-separated list of allowed origins (default: * in dev, empty in prod)
 * 
 * For security, CORS is only enabled on API routes by default.
 * To enable CORS on all routes (including HTML pages), set ENABLE_CORS_ALL=true
 */

import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Check if CORS should be enabled for all routes
const ENABLE_CORS_ALL = env.ENABLE_CORS_ALL?.toLowerCase() === 'true';

// Parse allowed origins from environment or use defaults
const ALLOWED_ORIGINS = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [
      'https://zap.cooking',
      'https://www.zap.cooking',
      'http://localhost:5173',
      'http://localhost:5174',
      'capacitor://localhost',
    ];

/**
 * Get CORS headers based on origin
 * Uses wildcard (*) in development, specific origins in production
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
  // In development, allow all origins for easier testing
  if (process.env.NODE_ENV === 'development') {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400', // 24 hours
    };
  }

  // In production, check if origin is allowed
  const isAllowed = origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'));
  
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin || '*' : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Check if CORS should be applied to this route
 */
function shouldApplyCors(pathname: string): boolean {
  // Always apply CORS to API routes
  if (pathname.startsWith('/api/')) {
    return true;
  }

  // Apply to all routes if ENABLE_CORS_ALL is set
  if (ENABLE_CORS_ALL) {
    return true;
  }

  return false;
}

export const handle: Handle = async ({ event, resolve }) => {
  const shouldApply = shouldApplyCors(event.url.pathname);
  const origin = event.request.headers.get('origin');

  // Handle preflight OPTIONS requests
  if (event.request.method === 'OPTIONS' && shouldApply) {
    const corsHeaders = getCorsHeaders(origin);

    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Process the request normally
  const response = await resolve(event);

  // Add CORS headers to responses that need them
  if (shouldApply) {
    const corsHeaders = getCorsHeaders(origin);

    // Merge CORS headers with existing response headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      if (value) {
        response.headers.set(key, value);
      }
    });
  }

  return response;
};
