/**
 * GET /api/pow/head — the cheap poll for /pow: pow:head as JSON,
 * { latestId, updatedAt, etag }.
 *
 * The ETag is pow:head.etag, the DATA version (it changes when the summary
 * is recomputed). Poll this and compare etags; when it changes, fetch
 * /api/pow?v=<etag without quotes> for the new summary. The /api/pow
 * response's own ETag is for HTTP caching only.
 *
 * Edge-cached for 10 s, so polling stays near-live without reaching KV on
 * every request.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { etagMatches } from '$lib/shipped/serve.server';
import { readHead } from '$lib/shipped/store.server';

export const GET: RequestHandler = async ({ request, platform }) => {
  const kv = platform?.env?.POW;
  if (!kv) {
    return json(
      { code: 'POW_UNCONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let head;
  try {
    head = await readHead(kv);
  } catch (e) {
    console.error(`[pow] head read failed: ${e instanceof Error ? e.name : 'error'}`);
    head = null;
  }
  if (!head) {
    return json(
      { code: 'POW_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const headers = { ETag: head.etag, 'Cache-Control': 'public, max-age=10' };
  if (etagMatches(request.headers.get('if-none-match'), head.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(JSON.stringify(head), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
};
