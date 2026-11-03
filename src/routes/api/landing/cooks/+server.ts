import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLandingData } from '$lib/landing/landingData.server';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';
import { LANDING_CACHE_CONTROL } from '$lib/landing/route';

/**
 * The /explore cooks (the org's `feed-foodies` list, with their profiles,
 * rotated daily) for the /feed discovery column's "Cooks to follow".
 *
 * The same cached landing build /explore renders from, read with the same
 * dependencies as its loader — the moderation lists included, so a rebuild
 * started here caches exactly what /explore would.
 */
export const GET: RequestHandler = async ({ platform }) => {
  const kv = (platform?.env?.GATED_CONTENT ?? null) as Parameters<
    typeof loadReadsModerationLists
  >[0];
  const cache =
    typeof caches !== 'undefined'
      ? ((caches as unknown as { default?: Cache }).default ?? null)
      : null;
  const ctx = platform?.ctx;
  const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
  const moderation = await loadReadsModerationLists(kv).catch(() => null);
  const landing = await getLandingData({ cache, waitUntil, moderation });
  return json({ cooks: landing.cooks }, { headers: { 'cache-control': LANDING_CACHE_CONTROL } });
};
