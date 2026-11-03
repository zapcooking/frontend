/**
 * Plated — "I made this" photo comments on a recipe.
 *
 * A plated post is an ordinary NIP-22 recipe comment (kind 1111) carrying
 * one extra marker tag, `["t", "cooked"]`. Every other client sees a normal
 * photo comment; this module only decides which of the recipe's already
 * fetched comments count toward the "Plated by" row.
 *
 * The marker stays "cooked" whatever the feature is called (copy lives in
 * ./copy.ts), so renaming the feature never changes data.
 *
 * Pure and environment-agnostic — unit-tested in plated.test.ts.
 */
import { extractImageUrls } from '$lib/imageUrls';
import { isEventMutedBy, type MuteList } from '$lib/muteFilter';
import { imetaAltByUrl } from '$lib/feed/imeta';

/**
 * Kill switch for the Plated row and the "Plate it" prompt. Flip to false
 * to hide both without reverting; already-published posts stay ordinary
 * comments in the thread.
 */
export const PLATED_ENABLED = true;

export const PLATED_MARKER = 'cooked';

/** The tag a plated post adds to the comment's NIP-22 tags. */
export const PLATED_MARKER_TAG: readonly string[] = ['t', PLATED_MARKER];

/** Most recent cooks shown as thumbnails; the count covers all of them. */
export const PLATED_MAX_THUMBNAILS = 5;

/** The parts of an event these checks read (NDKEvent and raw events both fit). */
export interface PlatedEventLike {
  id?: string;
  pubkey?: string;
  kind?: number;
  content?: string;
  created_at?: number;
  tags?: string[][];
}

/** The recipe being plated: its NIP-01 address and author. */
export interface PlatedRecipe {
  /** `kind:pubkey:d-tag` */
  address: string;
  authorPubkey: string;
}

export interface PlatedItem {
  id: string;
  pubkey: string;
  image: string;
  /** imeta `alt` for the image, when the cook wrote one. */
  alt: string | null;
  createdAt: number;
}

export interface PlatedSummary {
  /** One per cook (their newest plate), newest first. */
  plates: PlatedItem[];
  /** Unique cooks — equals plates.length. */
  cookCount: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

function validTags(tags: unknown): string[][] {
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (t): t is string[] => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string'
  );
}

/** True when the event carries the marker tag (value matched case-insensitively). */
export function hasPlatedMarker(event: PlatedEventLike): boolean {
  return validTags(event.tags).some(
    (t) => t[0] === 't' && t[1].trim().toLowerCase() === PLATED_MARKER
  );
}

/** The first https image URL in the content, or null. */
export function platedImage(event: PlatedEventLike): string | null {
  const url = extractImageUrls(event.content ?? '').find((u) => u.startsWith('https://'));
  return url ?? null;
}

/**
 * Is this a plated post on `recipe`? Kind 1111, the marker tag, a
 * top-level comment on this recipe (lowercase `a` is the recipe; replies
 * point their parent scope at a comment instead), no NIP-36 content
 * warning, and a usable https image.
 */
export function isPlatedPost(event: PlatedEventLike, recipe: PlatedRecipe): boolean {
  if (event.kind !== 1111) return false;
  if (!event.id || !event.pubkey || !HEX64.test(event.pubkey)) return false;
  const tags = validTags(event.tags);
  if (!hasPlatedMarker(event)) return false;
  if (!tags.some((t) => t[0] === 'A' && t[1] === recipe.address)) return false;
  if (!tags.some((t) => t[0] === 'a' && t[1] === recipe.address)) return false;
  if (tags.some((t) => t[0] === 'k' && t[1] === '1111')) return false;
  if ((event.tags ?? []).some((t) => Array.isArray(t) && t[0] === 'content-warning')) return false;
  return platedImage(event) !== null;
}

export interface SummarizeOptions {
  /** The reader's mute list; null (signed out / not loaded) mutes nothing. */
  muteList?: MuteList | null;
  /** Event ids hidden locally, e.g. reported this session. */
  hiddenIds?: ReadonlySet<string>;
  /**
   * Site moderation (the Reads lists): true when an admin has blocked this
   * event id or author. Applies to every visitor.
   */
  isBlocked?: (pointer: { eventId: string; pubkey: string }) => boolean;
}

/**
 * The "Plated by" row's data from a recipe's fetched comments: valid plated
 * posts, minus the recipe's own author, moderation-blocked events and
 * authors, muted events and locally hidden ids, de-duplicated by event id
 * and then by author (newest plate wins).
 */
export function summarizePlated(
  events: readonly PlatedEventLike[],
  recipe: PlatedRecipe,
  options: SummarizeOptions = {}
): PlatedSummary {
  const byAuthor = new Map<string, PlatedItem>();
  const seen = new Set<string>();

  for (const ev of events) {
    if (!ev.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    if (!isPlatedPost(ev, recipe)) continue;
    if (ev.pubkey === recipe.authorPubkey) continue;
    if (options.hiddenIds?.has(ev.id)) continue;
    if (options.isBlocked?.({ eventId: ev.id, pubkey: ev.pubkey! })) continue;
    if (isEventMutedBy(options.muteList, ev)) continue;

    const image = platedImage(ev)!;
    const item: PlatedItem = {
      id: ev.id,
      pubkey: ev.pubkey!,
      image,
      alt: imetaAltByUrl({ tags: validTags(ev.tags) }).get(image)?.trim() || null,
      createdAt: ev.created_at ?? 0
    };
    const prev = byAuthor.get(item.pubkey);
    if (!prev || newerFirst(item, prev) < 0) byAuthor.set(item.pubkey, item);
  }

  const plates = [...byAuthor.values()].sort(newerFirst);
  return { plates, cookCount: plates.length };
}

/** Newest first; ties broken by id so the order is stable across relays. */
function newerFirst(a: PlatedItem, b: PlatedItem): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A recipe's NIP-01 address, or null when it isn't addressable. */
export function recipeAddress(event: {
  kind?: number;
  pubkey?: string;
  tags?: string[][];
}): string | null {
  const d = event.tags?.find((t) => t[0] === 'd')?.[1];
  if (event.kind == null || !event.pubkey || d == null) return null;
  return `${event.kind}:${event.pubkey}:${d}`;
}
