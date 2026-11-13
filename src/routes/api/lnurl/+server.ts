/**
 * Same-origin LNURL proxy.
 *
 * LNURL-pay providers are fetched cross-origin from the browser, and some
 * sit behind nginx rules that 403 those requests for a given visitor
 * (cookie or fingerprint based) — the invoice then never loads even though
 * the provider works fine from a server. Fetching server-side sidesteps
 * the visitor's browser session entirely; the provider sees a clean
 * request from our origin.
 *
 * SSRF guard: https only, and hostnames that look like loopback, private,
 * or cloud-metadata targets are refused.
 */
import { json, type RequestHandler } from '@sveltejs/kit';

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i
];

const FORWARD_TIMEOUT_MS = 20000;

export const GET: RequestHandler = async ({ url }) => {
  const target = url.searchParams.get('url');
  if (!target) {
    return json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: 'Invalid url' }, { status: 400 });
  }

  if (parsed.protocol !== 'https:') {
    return json({ error: 'Only https urls are proxied' }, { status: 400 });
  }
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(parsed.hostname))) {
    return json({ error: 'Refused' }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'follow'
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return json(
      { error: aborted ? 'Upstream timeout' : 'Upstream request failed' },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
};
