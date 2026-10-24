/**
 * Shared "more from this author" rail data: one kind:30023 fetch per
 * author, split into recipes and articles so the recipe page and the
 * reads page can each show both cards (own type first) without
 * duplicating fetch/filter logic.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS, isHiddenRecipeEvent } from '$lib/consts';
import { buildPoolRelaySet } from '$lib/eventFetch';

export interface AuthorRailItem {
  naddr: string;
  title: string;
  image: string;
  href: string;
}

export interface AuthorContentSplit {
  recipes: AuthorRailItem[];
  articles: AuthorRailItem[];
}

const MAX_PER_TYPE = 5;
const FETCH_LIMIT = 40;

export async function fetchAuthorContent(
  ndk: NDK,
  pubkey: string,
  excludeEventId?: string
): Promise<AuthorContentSplit> {
  const split: AuthorContentSplit = { recipes: [], articles: [] };
  if (!ndk || !pubkey) return split;

  try {
    // Explicit relay set — author-filtered fetches on a cold pool can
    // compute an empty relay set via the outbox tracker (see eventFetch).
    const events = await ndk.fetchEvents(
      {
        kinds: [30023],
        authors: [pubkey],
        limit: FETCH_LIMIT
      },
      undefined,
      buildPoolRelaySet(ndk)
    );

    // Newest-first so each type's top-5 are the author's most recent.
    const sorted = [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    for (const ev of sorted) {
      if (excludeEventId && ev.id === excludeEventId) continue;
      if (isHiddenRecipeEvent(ev)) continue;

      const dTag = ev.tags.find((t) => t[0] === 'd')?.[1];
      if (!dTag) continue;

      let naddrEnc: string;
      try {
        naddrEnc = nip19.naddrEncode({
          identifier: dTag,
          kind: ev.kind || 30023,
          pubkey: ev.pubkey
        });
      } catch {
        continue;
      }

      const isRecipe = ev.tags.some(
        (t) => t[0] === 't' && RECIPE_TAGS.includes((t[1] || '').toLowerCase())
      );
      const bucket = isRecipe ? split.recipes : split.articles;
      if (bucket.length >= MAX_PER_TYPE) {
        if (split.recipes.length >= MAX_PER_TYPE && split.articles.length >= MAX_PER_TYPE) break;
        continue;
      }

      bucket.push({
        naddr: naddrEnc,
        title: ev.tags.find((t) => t[0] === 'title')?.[1] || dTag,
        image: ev.tags.find((t) => t[0] === 'image')?.[1] || '',
        href: isRecipe ? `/recipe/${naddrEnc}` : `/reads/${naddrEnc}`
      });
    }
  } catch (err) {
    console.error('[authorContent] Failed to load author content:', err);
  }

  return split;
}
