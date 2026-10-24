/**
 * Display values for a recipe collection (kind 30001), derived from the
 * list event.
 *
 * Extracted from `routes/my-kitchen/[naddr]/+page@.svelte` for two
 * reasons, and the second is the one that matters:
 *
 *  1. They are pure, so they can be unit-tested — this repo has no
 *     component-render harness.
 *  2. **Every input is a required parameter.** In the component these
 *     were zero-argument closures over `event` and `coverImage`, and
 *     `$: listTitle = getListTitle();` therefore had NO reactive
 *     dependencies: Svelte reads dependencies from the identifiers
 *     written inside the statement, and the only one there was the
 *     function's own name. The statement ran once at init — before
 *     `loadData()` had fetched anything — so the page rendered the
 *     `'Collection'` fallback and no cover, permanently, on a
 *     collection that had both.
 *
 * Taking the inputs as parameters is what makes the dependency visible
 * to the compiler. Do not add an overload that reads module or
 * component state instead: the signature IS the fix.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { DEFAULT_LIST_ID, DEFAULT_LIST_TITLE } from '$lib/stores/cookbookStore';

/** Shown when the event is absent or carries no title tag. */
export const COLLECTION_FALLBACK_TITLE = 'Collection';

export function getCollectionTitle(event: NDKEvent | null): string {
  if (!event) return COLLECTION_FALLBACK_TITLE;
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  if (dTag === DEFAULT_LIST_ID) return DEFAULT_LIST_TITLE;
  return event.tags.find((t) => t[0] === 'title')?.[1] || COLLECTION_FALLBACK_TITLE;
}

export function getCollectionSummary(event: NDKEvent | null): string | undefined {
  return event?.tags.find((t) => t[0] === 'summary')?.[1];
}

/**
 * The resolved cover: the loaded cover image when there is one, else the
 * legacy `image` tag. `coverImage` is required rather than optional so a
 * caller cannot silently drop the dependency that made this stale.
 */
export function getCollectionImage(
  event: NDKEvent | null,
  coverImage: string | undefined
): string | undefined {
  return coverImage || event?.tags.find((t) => t[0] === 'image')?.[1];
}
