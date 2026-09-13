/**
 * Tag construction for kind-30001 recipe lists.
 *
 * Extracted from `routes/list/[slug]/fork/+page.svelte` so the tag set a
 * republished list carries can be asserted in a test. That page is not a
 * "fork" in the member's sense — `list/create/+page.svelte:52` redirects
 * to it right after a list is created, and it is the only screen that
 * adds recipes to a list, so its output overwrites the list the member
 * just made at the same `d` address. Anything it drops is destroyed.
 */

import { nip19 } from 'nostr-tools';
import { RECIPE_TAG_PREFIX_NEW } from '$lib/consts';

/** The `d` identifier a list gets from its title. */
export function listIdentifier(title: string): string {
  return title.toLowerCase().replaceAll(' ', '-');
}

/** The reserved `d` value for a member's bookmarks list. */
export const BOOKMARKS_IDENTIFIER = 'nostrcooking-bookmarks';

export type ListItem = { naddr: string };

export type ListTagsInput = {
  /** Tags of the list event being republished, used only to detect the bookmarks list. */
  sourceTags: string[][];
  title: string;
  summary: string;
  /** Cover image URLs from the picker; the picker is capped at one. */
  images: string[];
  items: ListItem[];
};

/**
 * Build the full tag set for the republished list event.
 *
 * Every tag the member can still see on the form has to be re-emitted
 * here: a kind-30001 lands at the same `d` address and replaces the
 * previous event wholesale, so an omitted tag is not "unchanged", it is
 * deleted.
 */
export function buildListTags(input: ListTagsInput): string[][] {
  const { sourceTags, title, summary, images, items } = input;
  const tags: string[][] = [];

  if (!sourceTags.find((t) => t[0] == 'd' && t[1] == BOOKMARKS_IDENTIFIER)) {
    tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
    tags.push(['d', listIdentifier(title)]);
  } else {
    tags.push(['d', BOOKMARKS_IDENTIFIER]);
  }
  tags.push(['title', title]);
  if (summary !== '') {
    tags.push(['summary', summary]);
  }
  if (images.length === 1) {
    tags.push(['image', images[0]]);
  }
  items.forEach((e) => {
    const decoded = nip19.decode(e.naddr);
    if (decoded.type === 'naddr') {
      const data = decoded.data;
      tags.push(['a', `${data.kind}:${data.pubkey}:${data.identifier}`]);
    }
  });

  return tags;
}
