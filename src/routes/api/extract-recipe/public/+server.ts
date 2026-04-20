/**
 * POST /api/extract-recipe/public — anon-allowed URL-only recipe import.
 *
 * Powers the free AI-import hero on the landing page. Accepts a single
 * URL, runs it through the shared `parseRecipe` pipeline, and returns a
 * normalized recipe. No membership check, no pubkey required — the
 * server gate that `/api/extract-recipe` enforces for image/text is
 * deliberately absent here. See the sibling endpoint's docstring for
 * the full gating story.
 *
 * Defenses:
 *   - URL-only: rejects any non-`url` type so the public surface can't
 *     be abused for vision/text extraction.
 *   - SSRF/size cap: enforced inside `parseRecipe` (http(s) only, private
 *     IP ranges blocked, 5 MB response cap).
 *   - Per-IP rate limit: 8/hour, 30/day via `NOURISH_FLAGS` KV with the
 *     `extract-url` scope. Trivially bypassable IP rotation is accepted
 *     — this is a cost-cap, not an abuse shield.
 *
 * Request body:
 *   { url: string }
 *
 * Response:
 *   200 { success: true, recipe: NormalizedRecipe }
 *   400 { success: false, error: string }
 *   429 { error: 'rate_limited', retryAfter, scope }
 *   500 { success: false, error: string }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { parseRecipe } from '$lib/parseRecipe.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

const PER_HOUR = 8;
const PER_DAY = 30;

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  try {
    const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { url } = body ?? {};
    if (typeof url !== 'string' || url.trim().length === 0) {
      return json({ success: false, error: 'URL is required' }, { status: 400 });
    }
    if (url.length > 2048) {
      return json({ success: false, error: 'URL is too long' }, { status: 400 });
    }

    // Per-IP cap. Falls open if KV is unbound (local dev without
    // bindings) — client-side rate limit still applies there.
    let ip = '127.0.0.1';
    try {
      ip = getClientAddress();
    } catch {
      // Local dev / missing CF headers. Use loopback sentinel.
    }
    const kv = platform?.env?.NOURISH_FLAGS;
    const rl = await checkPerIpRateLimit(kv, {
      ip,
      scope: 'extract-url',
      perHour: PER_HOUR,
      perDay: PER_DAY
    });
    if (rl.limited) {
      return json(rl.body, { status: 429 });
    }

    const result = await parseRecipe(OPENAI_API_KEY, { type: 'url', url });
    if (!result.ok) {
      return json({ success: false, error: result.error }, { status: result.status });
    }

    // TODO(analytics): emit `anon_import_success` with { ipHash: rl.ipHash, urlHost }.
    console.log('[extract-recipe.public] ok', {
      ipHash: rl.ipHash.slice(0, 8),
      urlHost: safeHost(url)
    });

    return json({ success: true, recipe: result.recipe });
  } catch (err) {
    console.error('[extract-recipe.public] error:', err);
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    return json({ success: false, error: message }, { status: 500 });
  }
};

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return 'unknown';
  }
}
