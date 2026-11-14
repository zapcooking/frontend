/**
 * The attached recipe of a Go live session, resolved from its address
 * through the app's NDK pool and cached for the page's lifetime. Shared by
 * the Live directory (title and photo on the card) and the stream page's
 * recipe panel (the whole event).
 */
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { fetchEventWithRelayHints } from '$lib/eventFetch';
import type { RecipeCard } from './goLive';
import { isHiddenRecipeCoordinate, isHiddenRecipeEvent } from '$lib/consts';

const RECIPE_ADDRESS = /^(30023|35000):([0-9a-f]{64}):(.{1,200})$/;
const TIMEOUT_MS = 8000;

const cache = new Map<string, Promise<NDKEvent | null>>();

export function parseRecipeAddress(
  a: string | null | undefined
): { kind: number; pubkey: string; d: string } | null {
  const m = RECIPE_ADDRESS.exec(a ?? '');
  return m ? { kind: Number(m[1]), pubkey: m[2], d: m[3] } : null;
}

/**
 * The recipe event for an address, or null. Never throws. A hidden recipe
 * (the app's permanent hidden list, as on the recipe page) is never fetched
 * or returned, cached or not.
 */
export function fetchRecipeEvent(ndk: NDK, a: string | null | undefined): Promise<NDKEvent | null> {
  const parsed = parseRecipeAddress(a);
  if (!parsed) return Promise.resolve(null);
  if (isHiddenRecipeCoordinate(parsed.kind, parsed.pubkey, parsed.d)) return Promise.resolve(null);
  const key = `${parsed.kind}:${parsed.pubkey}:${parsed.d}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchEventWithRelayHints(
      ndk,
      { kinds: [parsed.kind], authors: [parsed.pubkey], '#d': [parsed.d] },
      { timeoutMs: TIMEOUT_MS }
    )
      .then((e) => (e && !isHiddenRecipeEvent(e) ? e : null))
      .catch(() => null);
    cache.set(key, pending);
    // A miss is not remembered: the next look tries again.
    pending.then((e) => {
      if (!e) cache.delete(key);
    });
  }
  return pending;
}

/** Waits between attempts: relays are often still connecting at page load. */
export const RECIPE_RETRY_MS = [0, 3000, 8000] as const;

/**
 * `fetchRecipeEvent`, tried again while it finds nothing. A visitor who
 * opens a shared stream link fetches the recipe before the app's relay
 * connections are up, and the first look usually misses. `getNdk` is read
 * on every attempt because the app's NDK instance can be replaced while
 * it starts. `stillWanted` lets the caller cancel (for example, after
 * navigating to another stream).
 */
export async function fetchRecipeEventWithRetry(
  getNdk: () => NDK,
  a: string | null | undefined,
  stillWanted: () => boolean = () => true,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<NDKEvent | null> {
  if (!parseRecipeAddress(a)) return null;
  for (const ms of RECIPE_RETRY_MS) {
    if (ms) await wait(ms);
    if (!stillWanted()) return null;
    const found = await fetchRecipeEvent(getNdk(), a);
    if (found) return found;
  }
  return null;
}

/** Title and photo from a recipe event's tags. */
export function recipeCardOf(event: Pick<NDKEvent, 'tags'> | null): RecipeCard | null {
  if (!event) return null;
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? null;
  const title = tag('title') || tag('d');
  if (!title) return null;
  const image = tag('image');
  return { title, image: image && /^https:\/\//.test(image) ? image : null };
}
