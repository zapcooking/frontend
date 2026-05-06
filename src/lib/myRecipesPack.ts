/**
 * "My Recipes" pack — fetch all kind:30023 recipes authored by a single
 * pubkey, validated and shaped for the SharePackModal preview.
 *
 * Used by the user-profile "Share My Recipes as Pack" action. We fetch
 * all of the author's recipes in one shot (bounded by MAX_RECIPES; user
 * authored counts are bounded in practice), validate the markdown so
 * malformed events don't enter the pack, dedupe by addressable a-tag,
 * and return them sorted newest-first.
 *
 * The shape is deliberately small — just what the modal preview + the
 * publish path need (a-tag for the pack reference, title for the
 * checkbox list, image so the pack cover can be picked from the most
 * recent recipe with one).
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { validateMarkdownTemplate } from '$lib/parser';
import { RECIPE_TAGS } from '$lib/consts';

export interface MyRecipeForPack {
  /** Addressable a-tag in `kind:pubkey:dTag` form, ready to drop into a Recipe Pack event. */
  aTag: string;
  /** Display title (from the `title` tag, falling back to the d-tag). */
  title: string;
  /** First image URL on the recipe, when present. */
  image?: string;
  /** Original event timestamp, used for newest-first sort. */
  createdAt: number;
}

const RECIPE_KIND = 30023;
/**
 * One-shot fetch upper bound. The vast majority of authors will have
 * far fewer recipes than this; a few power users could approach it.
 * The cap avoids unbounded memory if a relay returns huge result sets,
 * but isn't intended to be a load-more boundary — extending it later
 * doesn't break compatibility.
 */
const MAX_RECIPES = 500;
/** Hard cap on subscription wait so a slow relay can't pin the UI. */
const SUBSCRIPTION_TIMEOUT_MS = 10_000;

/**
 * Fetch every recipe authored by `pubkey` and return them in a shape
 * suitable for the share-pack flow. Resolves with an empty array if
 * the user hasn't authored any recipes (the caller surfaces an empty
 * state rather than treating this as an error).
 *
 * Implementation mirrors the user-profile recipes-tab pattern in
 * `routes/user/[slug]/+page.svelte`: subscribe with the standard
 * RECIPE_TAGS filter, validate content via `parseMarkdownForEditing`'s
 * looser sibling, dedupe by a-tag, sort newest-first.
 */
export async function fetchMyAuthoredRecipes(ndk: NDK, pubkey: string): Promise<MyRecipeForPack[]> {
  if (!ndk) throw new Error('NDK not initialized');
  if (!pubkey) throw new Error('Pubkey required');

  const filter: NDKFilter = {
    authors: [pubkey],
    kinds: [RECIPE_KIND],
    '#t': RECIPE_TAGS,
    limit: MAX_RECIPES
  };

  // Track by a-tag so a republished recipe (same d-tag, newer
  // created_at) keeps only the latest version. NDK delivers events as
  // they arrive — when two come in for the same address we keep
  // whichever has the higher created_at.
  const byATag = new Map<string, MyRecipeForPack>();

  await new Promise<void>((resolve) => {
    const subscription = ndk.subscribe(filter, { closeOnEose: true });

    const safetyTimeout = setTimeout(() => {
      try {
        subscription.stop();
      } catch {
        // already stopped
      }
      resolve();
    }, SUBSCRIPTION_TIMEOUT_MS);

    subscription.on('event', (event: NDKEvent) => {
      // validateMarkdownTemplate returns MarkdownTemplate | string —
      // it never returns null. A string return is an error message
      // describing what's wrong with the markdown. Filter on that
      // shape so malformed events stay out of the pack. (The wider
      // codebase uses an `!= null` check that's always true; we
      // don't fix it here to keep this PR scoped, but we use the
      // correct check for new code.)
      const validation = validateMarkdownTemplate(event.content);
      if (typeof validation === 'string') return;
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!dTag) return;
      const aTag = `${RECIPE_KIND}:${pubkey}:${dTag}`;
      const existing = byATag.get(aTag);
      const createdAt = event.created_at || 0;
      if (existing && existing.createdAt >= createdAt) return;

      const title = event.tags.find((t) => t[0] === 'title')?.[1]?.trim() || dTag;
      const image = event.tags.find((t) => t[0] === 'image')?.[1] || undefined;

      byATag.set(aTag, { aTag, title, image, createdAt });
    });

    subscription.on('eose', () => {
      clearTimeout(safetyTimeout);
      try {
        subscription.stop();
      } catch {
        // already stopped
      }
      resolve();
    });
  });

  return Array.from(byATag.values()).sort((a, b) => b.createdAt - a.createdAt);
}
