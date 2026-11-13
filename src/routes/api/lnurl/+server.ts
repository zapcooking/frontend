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
 * SSRF guard: fetchWithSsrfGuard validates the initial URL and every
 * redirect hop (https enforced at each hop; loopback/private/metadata —
 * including private IPv6 literals — refused).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { SsrfGuardError, fetchWithSsrfGuard } from '$lib/urlGuard.server';

const FORWARD_TIMEOUT_MS = 20000;

export const GET: RequestHandler = async ({ url }) => {
  const target = url.searchParams.get('url');
  if (!target) {
    return json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const { response: upstream, finalUrl } = await fetchWithSsrfGuard(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'zap-cooking/1.0' },
      signal: controller.signal,
      redirect: 'manual'
    });
    const body = await upstream.text();
    console.log(`[lnurl-proxy] ${upstream.status} ${finalUrl.slice(0, 140)}`);
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  } catch (e) {
    if (e instanceof SsrfGuardError) {
      return json({ error: `Refused: ${e.message}` }, { status: 403 });
    }
    const aborted = e instanceof Error && e.name === 'AbortError';
    return json(
      { error: aborted ? 'Upstream timeout' : 'Upstream request failed' },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
};
