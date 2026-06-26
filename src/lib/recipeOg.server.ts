/**
 * Server-only resolver for recipe Open Graph metadata used by the crawler
 * branch of the `handle` hook.
 *
 * Reuses the proven, NDK-free raw-WebSocket relay race from
 * `recipePackOg.server.ts` (the same code path that serves `/pack/[naddr]` OG
 * in production today). No NDK on the server — that keeps the worker bundle
 * small, which is the whole point: a bloated bundle OOM'd at build time and was
 * the root cause of the #454 500s.
 *
 * The slug may be an `naddr1…` (decode → identifier/pubkey/kind) or a raw hex
 * event id, mirroring `recipe/[slug]/+page.svelte`'s `loadData()`.
 */

import { nip19 } from 'nostr-tools';
import { raceRelays } from './recipePackOg.server';
import { GATED_RECIPE_KIND } from './consts';
import type { OgEventLike } from './recipeOgMeta';

/** Hard ceiling on the whole resolve so a wedged relay can never delay the
 * crawler response indefinitely. raceRelays already times out each socket at
 * 3.5s; this is belt-and-suspenders so the hook always settles fast. */
const RESOLVE_TIMEOUT_MS = 4000;

function toOgEvent(evt: unknown): OgEventLike | null {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as Record<string, unknown>;
  if (!Array.isArray(e.tags)) return null;
  return {
    tags: e.tags as string[][],
    content: typeof e.content === 'string' ? e.content : '',
    pubkey: typeof e.pubkey === 'string' ? e.pubkey : undefined,
    created_at: typeof e.created_at === 'number' ? e.created_at : undefined,
    kind: typeof e.kind === 'number' ? e.kind : undefined
  };
}

async function resolveEvent(slug: string): Promise<OgEventLike | null> {
  if (slug.startsWith('naddr1')) {
    let decoded;
    try {
      decoded = nip19.decode(slug);
    } catch {
      return null;
    }
    if (decoded.type !== 'naddr') return null;
    const pointer = decoded.data as nip19.AddressPointer;
    if (!pointer.identifier || !pointer.pubkey) return null;

    // Support both regular recipes (30023) and premium recipes (GATED_RECIPE_KIND).
    const recipeKind = pointer.kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;
    const evt = await raceRelays({
      kinds: [recipeKind],
      authors: [pointer.pubkey],
      '#d': [pointer.identifier]
    });
    return toOgEvent(evt);
  }

  // Raw hex event id.
  if (!/^[0-9a-f]{64}$/i.test(slug)) return null;
  const evt = await raceRelays({ ids: [slug] });
  return toOgEvent(evt);
}

/**
 * Resolve a recipe event for OG rendering. Never throws and never hangs past
 * RESOLVE_TIMEOUT_MS — returns null on decode failure, timeout, or not-found,
 * letting the caller emit safe fallback meta.
 */
export async function fetchRecipeEventForOg(slug: string): Promise<OgEventLike | null> {
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS)
    );
    return await Promise.race([resolveEvent(slug), timeout]);
  } catch {
    return null;
  }
}
