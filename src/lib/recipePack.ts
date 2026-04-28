/**
 * Recipe Packs — shareable curated lists of recipes published as
 * NIP-51 curation sets (kind 30004).
 *
 * A pack references existing recipes by `a` tags (addressable events,
 * kind 30023 / 35000) and never duplicates recipe content. Zaps on the
 * pack event flow to the creator (the event author) via the standard
 * NIP-57 path.
 */

import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { ndk, userPublickey, GARDEN_RELAY_URL } from '$lib/nostr';
import { addClientTagToEvent } from '$lib/nip89';
import { RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
import { offlineStorage } from '$lib/offlineStorage';
import { get } from 'svelte/store';

export const RECIPE_PACK_KIND: NDKKind = 30004 as NDKKind;
export const COOKBOOK_PACK_DTAG = 'zapcooking-cookbook';
export const COLLECTION_PACK_DTAG_PREFIX = 'zapcooking-pack-';
export const MY_RECIPES_PACK_DTAG = 'zapcooking-my-recipes';
export const RECIPE_PACK_TAG = 'recipe-pack';
export const ZAP_COOKING_TAG = 'zap-cooking';
export const MY_RECIPES_TAG = 'my-recipes';

export type RecipePackSource =
  | { type: 'cookbook' }
  | { type: 'collection'; collectionDTag: string }
  // Pack of recipes the current user has personally authored
  // (kind 30023 events with `authors: [pubkey]`). Replaceable per
  // pubkey via the fixed d-tag, so re-publishing updates a single
  // canonical "My Recipes" pack rather than spawning new ones.
  | { type: 'my-recipes' };

export interface BuildPackInput {
  source: RecipePackSource;
  title: string;
  description?: string;
  image?: string;
  /** Recipe references in `a`-tag form: `${kind}:${pubkey}:${dTag}`. */
  recipeATags: string[];
}

export interface PublishedPack {
  event: NDKEvent;
  naddr: string;
  url: string;
}

/** Compute the d-tag for a pack source. Replaceable per source. */
export function packDTag(source: RecipePackSource): string {
  if (source.type === 'cookbook') return COOKBOOK_PACK_DTAG;
  if (source.type === 'my-recipes') return MY_RECIPES_PACK_DTAG;
  return `${COLLECTION_PACK_DTAG_PREFIX}${source.collectionDTag}`;
}

/** Build the social-post style content body for the pack event. */
export function buildPackContent(opts: {
  title: string;
  description?: string;
  recipeCount: number;
  url: string;
}): string {
  const lines: string[] = [];
  lines.push(`I made a Recipe Pack on Zap Cooking: ${opts.title}`);
  if (opts.description && opts.description.trim()) {
    lines.push('');
    lines.push(opts.description.trim());
  }
  lines.push('');
  const noun = opts.recipeCount === 1 ? 'recipe' : 'recipes';
  lines.push(`Includes ${opts.recipeCount} ${noun}. Open it on Zap Cooking:`);
  lines.push(opts.url);
  return lines.join('\n');
}

/** Build a /pack/<naddr> URL on the canonical Zap Cooking origin. */
export function buildPackUrl(naddr: string, origin?: string): string {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://zap.cooking');
  return `${base}/pack/${naddr}`;
}

/**
 * Resolve a usable cover image for a pack by looking through the
 * referenced recipes. Cache-first so it returns instantly when the
 * recipes are already cached (and never blocks if offline). Falls
 * back to network. Returns the first non-empty `image` tag found.
 */
export async function resolveFirstRecipeImage(aTags: string[]): Promise<string | undefined> {
  if (!aTags.length) return undefined;

  // 1) Cache lookup — same order as aTags
  try {
    const cached = await offlineStorage.getRecipes(aTags);
    const cachedById = new Map(cached.map((c) => [c.id, c]));
    for (const aTag of aTags) {
      const c = cachedById.get(aTag);
      if (c?.image) return c.image;
    }
  } catch {
    // empty cache is fine
  }

  // 2) Network — query in order, return on first hit
  const ndkInstance = get(ndk);
  if (!ndkInstance) return undefined;
  for (const aTag of aTags) {
    const parts = aTag.split(':');
    if (parts.length !== 3) continue;
    const [kind, pubkey, identifier] = parts;
    try {
      const e = await ndkInstance.fetchEvent({
        kinds: [Number(kind)],
        authors: [pubkey],
        '#d': [identifier]
      });
      const img = e?.tags?.find((t) => t[0] === 'image')?.[1];
      if (img) {
        // Opportunistically cache so future opens are instant.
        try {
          if (e) await offlineStorage.saveRecipeFromEvent(e);
        } catch {}
        return img;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Validate a recipe a-tag (kind:pubkey:dTag). */
function isValidATag(aTag: string): boolean {
  const parts = aTag.split(':');
  if (parts.length !== 3) return false;
  const [kind, pubkey, dTag] = parts;
  if (!kind || !/^\d+$/.test(kind)) return false;
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
  if (!dTag) return false;
  return true;
}

/**
 * Build (but do not sign/publish) a Recipe Pack event.
 * Caller is responsible for `addClientTagToEvent` + `publish` if using
 * directly. The exported `publishRecipePack` does both.
 */
export function buildRecipePackEvent(input: BuildPackInput): NDKEvent {
  const ndkInstance = get(ndk);
  if (!ndkInstance) throw new Error('NDK not initialized');

  const dedupedATags = Array.from(new Set(input.recipeATags.filter(isValidATag)));
  if (dedupedATags.length === 0) {
    throw new Error('Cannot publish a Recipe Pack with no recipes.');
  }

  const event = new NDKEvent(ndkInstance);
  event.kind = RECIPE_PACK_KIND as number;

  const tags: string[][] = [];
  tags.push(['d', packDTag(input.source)]);
  tags.push(['title', input.title]);
  if (input.description && input.description.trim()) {
    tags.push(['description', input.description.trim()]);
  }
  if (input.image && input.image.trim()) {
    tags.push(['image', input.image.trim()]);
  }
  tags.push(['t', RECIPE_PACK_TAG]);
  tags.push(['t', ZAP_COOKING_TAG]);
  tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
  // Per-source discriminator tag — lets feed clients filter for "my
  // recipes" packs specifically without scanning d-tags. Cookbook and
  // collection packs don't get an extra discriminator; they're already
  // visually distinct via title/description on the pack page.
  if (input.source.type === 'my-recipes') {
    tags.push(['t', MY_RECIPES_TAG]);
  }

  for (const aTag of dedupedATags) {
    tags.push(['a', aTag, GARDEN_RELAY_URL]);
  }

  event.tags = tags;
  return event;
}

/**
 * Build content for an optional kind:1 announcement that fans the
 * pack out to feed-only clients. The body links back to the pack via
 * a `nostr:` reference; clients that don't render kind 30004 can still
 * surface the announcement.
 */
export function buildAnnouncementContent(opts: {
  title: string;
  description?: string;
  recipeCount: number;
  naddr: string;
}): string {
  const lines: string[] = [];
  lines.push(`I just shared a Recipe Pack on Zap Cooking: ${opts.title}`);
  if (opts.description && opts.description.trim()) {
    lines.push('');
    lines.push(opts.description.trim());
  }
  lines.push('');
  const noun = opts.recipeCount === 1 ? 'recipe' : 'recipes';
  lines.push(`Includes ${opts.recipeCount} ${noun}.`);
  lines.push('');
  lines.push(`nostr:${opts.naddr}`);
  return lines.join('\n');
}

/**
 * Publish a NIP-09 deletion request (kind:5) for a Recipe Pack the
 * caller authored. Anyone hitting the pack page after relays honor
 * the deletion will see "pack not found" instead of the cached event.
 *
 * Important: NIP-09 is a *request*. Compliant relays drop the event;
 * non-compliant relays don't. Compliant clients hide it on render;
 * non-compliant clients still display it. We can't actually erase
 * the event from the network — only the strongest possible signal
 * that the author wants it gone.
 *
 * Tags follow NIP-09 latest:
 *   - e: specific event id (current addressable revision)
 *   - a: addressable form `${kind}:${pubkey}:${dTag}` so future
 *       republishes at the same address are also covered
 *   - k: kind number, helps relays index deletion requests
 *
 * Publishes via publishQueue's "all" mode so the deletion request
 * lands on garden + the explicit pool, matching where the original
 * pack was published. Caller is responsible for ensuring the user
 * actually authored the pack (we re-check pubkey here as a guard).
 */
export async function publishPackDeletion(packEvent: NDKEvent): Promise<NDKEvent> {
  const ndkInstance = get(ndk);
  const pubkey = get(userPublickey);
  if (!ndkInstance) throw new Error('NDK not initialized');
  if (!pubkey) throw new Error('Sign in required to delete a Recipe Pack.');
  if (packEvent.pubkey !== pubkey) {
    throw new Error('Only the author can delete this Recipe Pack.');
  }

  const dTag = packEvent.tags.find((t) => t[0] === 'd')?.[1];
  if (!dTag) throw new Error('Pack event missing d-tag — cannot reference for deletion.');

  const deletion = new NDKEvent(ndkInstance);
  deletion.kind = 5;
  deletion.content = 'Deleted by author';
  deletion.tags = [
    ['e', packEvent.id],
    ['a', `${RECIPE_PACK_KIND}:${pubkey}:${dTag}`],
    ['k', String(RECIPE_PACK_KIND)]
  ];
  addClientTagToEvent(deletion);

  // Use the resilient queue + 'all' mode so the deletion lands on
  // garden + the standard pool, same write surface as the original
  // pack publish.
  const { publishQueue } = await import('$lib/publishQueue');
  const result = await publishQueue.publishWithRetry(deletion, 'all');
  if (!result.success && !result.queued) {
    throw new Error(result.error || 'Failed to publish deletion request.');
  }
  return deletion;
}

/**
 * Publish a kind:1 announcement that references a Recipe Pack.
 * Caller passes the published pack so we can derive `a`-tag and naddr.
 */
export async function publishPackAnnouncement(pack: PublishedPack, input: {
  title: string;
  description?: string;
  recipeCount: number;
}): Promise<NDKEvent> {
  const ndkInstance = get(ndk);
  const pubkey = get(userPublickey);
  if (!ndkInstance) throw new Error('NDK not initialized');
  if (!pubkey) throw new Error('Sign in required to publish announcement.');

  const dTag = pack.event.tags.find((t) => t[0] === 'd')?.[1];
  if (!dTag) throw new Error('Pack event missing d-tag');

  const announcement = new NDKEvent(ndkInstance);
  announcement.kind = 1;
  announcement.content = buildAnnouncementContent({
    title: input.title,
    description: input.description,
    recipeCount: input.recipeCount,
    naddr: pack.naddr
  });
  announcement.tags = [
    ['a', `${RECIPE_PACK_KIND}:${pubkey}:${dTag}`, GARDEN_RELAY_URL],
    ['t', RECIPE_PACK_TAG],
    ['t', ZAP_COOKING_TAG],
    ['t', RECIPE_TAG_PREFIX_NEW]
  ];
  addClientTagToEvent(announcement);
  await announcement.publish();
  return announcement;
}

/**
 * Build, sign, and publish a Recipe Pack event. Returns the published
 * event along with its naddr and a Zap Cooking pack URL.
 *
 * Throws if there are no recipes, the user isn't signed in, or the
 * publish call fails.
 */
export async function publishRecipePack(input: BuildPackInput): Promise<PublishedPack> {
  const ndkInstance = get(ndk);
  const pubkey = get(userPublickey);
  if (!ndkInstance) throw new Error('NDK not initialized');
  if (!pubkey) throw new Error('Sign in required to publish a Recipe Pack.');

  const event = buildRecipePackEvent(input);
  const dTag = packDTag(input.source);

  // Build content. We need the URL to embed inside content, which
  // requires the naddr — which requires the d-tag and author pubkey
  // (both known here).
  const naddr = nip19.naddrEncode({
    identifier: dTag,
    kind: RECIPE_PACK_KIND as number,
    pubkey
  });
  const url = buildPackUrl(naddr);
  const recipeCount = event.tags.filter((t) => t[0] === 'a').length;

  event.content = buildPackContent({
    title: input.title,
    description: input.description,
    recipeCount,
    url
  });

  addClientTagToEvent(event);

  await event.publish();

  return { event, naddr, url };
}
